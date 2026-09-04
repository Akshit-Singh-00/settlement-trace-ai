import type {
  BankRecord,
  ConfidenceFactor,
  EvidenceGroup,
  GatewayRecord,
  InvestigationResult,
  InvestigationStatus,
  LedgerRecord,
  PipelineStage,
  SettlementDataset,
  SettlementRecord,
  StageStatus,
  TimelineStage,
  ValidationIssue,
  ValidationIssueCode,
} from './settlement-types';

const BANK_SLA_MINUTES = 180;
const LEDGER_SLA_MINUTES = 30;

const CONFIDENCE_DEDUCTIONS: Record<ValidationIssueCode, number> = {
  missing_gateway: 70,
  missing_settlement: 16,
  missing_bank: 12,
  missing_ledger: 14,
  missing_timestamp: 30,
  transaction_id_mismatch: 25,
  settlement_id_mismatch: 28,
  gateway_reference_mismatch: 22,
  utr_mismatch: 22,
  merchant_mismatch: 20,
  amount_mismatch: 20,
  currency_mismatch: 24,
  duplicate_records: 25,
  chronology_mismatch: 35,
  conflicting_evidence: 50,
  ambiguous_evidence: 8,
};

function timestamp(value?: string) {
  if (!value) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Returns a signed duration. Negative values are evidence and must never be clamped. */
export function minutesBetween(earlier?: string, later?: string | Date): number | undefined {
  const start = timestamp(earlier);
  const end = later instanceof Date ? later.getTime() : timestamp(later);
  if (start === undefined || end === undefined || Number.isNaN(end)) return undefined;
  return Math.round((end - start) / 60_000);
}

function formatDuration(minutes?: number) {
  if (minutes === undefined) return 'time unavailable';
  const prefix = minutes < 0 ? '-' : '';
  const absolute = Math.abs(minutes);
  if (absolute < 60) return `${prefix}${absolute} min`;
  const hours = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  return remainder ? `${prefix}${hours}h ${remainder}m` : `${prefix}${hours}h`;
}

function buildEvidence(
  gateway: GatewayRecord | undefined,
  settlements: SettlementRecord[],
  bank: BankRecord[],
  ledger: LedgerRecord[],
): EvidenceGroup[] {
  return [
    { source: 'Payment gateway', records: gateway ? [gateway as unknown as Record<string, string | number | undefined>] : [] },
    { source: 'Settlement system', records: settlements as unknown as EvidenceGroup['records'] },
    { source: 'Bank', records: bank as unknown as EvidenceGroup['records'] },
    { source: 'Merchant ledger', records: ledger as unknown as EvidenceGroup['records'] },
  ];
}

function issue(
  code: ValidationIssueCode,
  message: string,
  detail: string,
  stage: PipelineStage,
  severity: ValidationIssue['severity'] = 'high',
  fields?: string[],
): ValidationIssue {
  return { code, message, detail, stage, severity, fields };
}

function uniqueIssues(issues: ValidationIssue[]) {
  return issues.filter((candidate, index) => issues.findIndex((value) =>
    value.code === candidate.code && value.stage === candidate.stage && value.detail === candidate.detail) === index);
}

export function calculateConfidence(issues: ValidationIssue[]) {
  const seen = new Set<string>();
  const confidenceBreakdown: ConfidenceFactor[] = [];

  for (const current of issues) {
    const key = `${current.code}:${current.stage}`;
    if (seen.has(key)) continue;
    seen.add(key);
    confidenceBreakdown.push({
      reason: current.message,
      deduction: CONFIDENCE_DEDUCTIONS[current.code],
      stage: current.stage,
    });
  }

  const confidence = Math.max(5, 99 - confidenceBreakdown.reduce((total, factor) => total + factor.deduction, 0));
  return { confidence, confidenceBreakdown };
}

function findRelatedRecords(transactionId: string, gateway: GatewayRecord | undefined, dataset: SettlementDataset) {
  const settlements = dataset.settlements.filter((record) =>
    record.transactionId === transactionId || Boolean(gateway && record.gatewayReference === gateway.gatewayReference));
  const settlementIds = new Set(settlements.map((record) => record.settlementId));
  const bank = dataset.bank.filter((record) =>
    record.transactionId === transactionId || settlementIds.has(record.settlementId));
  const bankReferences = new Set(bank.map((record) => record.bankReference));
  const utrs = new Set(bank.map((record) => record.utr).filter(Boolean));
  const ledger = dataset.ledger.filter((record) =>
    record.transactionId === transactionId || settlementIds.has(record.settlementId)
      || Boolean(record.bankReference && bankReferences.has(record.bankReference))
      || Boolean(record.utr && utrs.has(record.utr)));
  return { settlements, bank, ledger };
}

function validateChronology(
  gateway: GatewayRecord,
  settlement: SettlementRecord | undefined,
  bank: BankRecord | undefined,
  ledger: LedgerRecord | undefined,
) {
  const issues: ValidationIssue[] = [];
  const addIfNegative = (
    earlier: string | undefined,
    later: string | undefined,
    stage: PipelineStage,
    detail: string,
    fields: string[],
  ) => {
    const duration = minutesBetween(earlier, later);
    if (duration !== undefined && duration < 0) {
      issues.push(issue('chronology_mismatch', 'Chronology mismatch', `${detail} (${duration} min).`, stage, 'high', fields));
    }
  };

  addIfNegative(gateway.capturedAt, settlement?.createdAt, 'settlement', 'Settlement was created before payment capture', ['capturedAt', 'createdAt']);
  addIfNegative(settlement?.createdAt, settlement?.processedAt, 'settlement', 'Settlement was processed before it was created', ['createdAt', 'processedAt']);
  addIfNegative(settlement?.processedAt, bank?.creditedAt, 'bank', 'Bank credit occurred before settlement processing', ['processedAt', 'creditedAt']);
  addIfNegative(bank?.creditedAt, ledger?.postedAt, 'ledger', 'Ledger posting occurred before bank credit', ['creditedAt', 'postedAt']);
  return issues;
}

function validateReferences(
  gateway: GatewayRecord,
  settlements: SettlementRecord[],
  bankRecords: BankRecord[],
  ledgerRecords: LedgerRecord[],
) {
  const issues: ValidationIssue[] = [];
  const settlement = settlements[0];
  const bank = bankRecords[0];
  const ledger = ledgerRecords[0];

  if (settlements.length > 1) issues.push(issue('duplicate_records', 'Conflicting settlement records', `${settlements.length} settlement records link to one gateway payment.`, 'settlement'));
  if (bankRecords.length > 1) issues.push(issue('duplicate_records', 'Multiple bank matches found', `${bankRecords.length} bank records link to one settlement.`, 'bank'));
  if (ledgerRecords.length > 1) issues.push(issue('duplicate_records', 'Multiple ledger matches found', `${ledgerRecords.length} ledger postings were found for one transaction.`, 'ledger'));

  if (settlement) {
    if (settlement.transactionId !== gateway.transactionId) issues.push(issue('transaction_id_mismatch', 'Transaction ID mismatch', `Settlement ${settlement.settlementId} points to ${settlement.transactionId}, not ${gateway.transactionId}.`, 'settlement', 'high', ['transactionId']));
    if (settlement.gatewayReference !== gateway.gatewayReference) issues.push(issue('gateway_reference_mismatch', 'Settlement reference inconsistent', `Settlement gateway reference ${settlement.gatewayReference} does not match ${gateway.gatewayReference}.`, 'settlement', 'high', ['gatewayReference']));
    if (settlement.amount !== gateway.amount) issues.push(issue('amount_mismatch', 'Amount mismatch detected', `Gateway amount ${gateway.amount} paise does not match settlement amount ${settlement.amount} paise.`, 'settlement', 'high', ['amount']));
    if (settlement.merchantId && settlement.merchantId !== gateway.merchantId) issues.push(issue('merchant_mismatch', 'Merchant mismatch detected', `Settlement merchant ${settlement.merchantId} does not match gateway merchant ${gateway.merchantId}.`, 'settlement', 'high', ['merchantId']));
    if (settlement.currency && settlement.currency !== gateway.currency) issues.push(issue('currency_mismatch', 'Currency mismatch detected', `Settlement currency ${settlement.currency} does not match gateway currency ${gateway.currency}.`, 'settlement', 'high', ['currency']));
  }

  if (bank && settlement) {
    if (bank.transactionId !== gateway.transactionId) issues.push(issue('transaction_id_mismatch', 'Transaction ID mismatch', `Bank record points to ${bank.transactionId}, not ${gateway.transactionId}.`, 'bank', 'high', ['transactionId']));
    if (bank.settlementId !== settlement.settlementId) issues.push(issue('settlement_id_mismatch', 'Settlement ID mismatch', `Bank settlement ${bank.settlementId} does not match ${settlement.settlementId}.`, 'bank', 'high', ['settlementId']));
    if (bank.amount !== settlement.amount) issues.push(issue('amount_mismatch', 'Amount mismatch detected', `Bank amount ${bank.amount} paise does not match settlement amount ${settlement.amount} paise.`, 'bank', 'high', ['amount']));
    if (bank.merchantId && bank.merchantId !== gateway.merchantId) issues.push(issue('merchant_mismatch', 'Merchant mismatch detected', `Bank merchant ${bank.merchantId} does not match gateway merchant ${gateway.merchantId}.`, 'bank', 'high', ['merchantId']));
    if (bank.currency && bank.currency !== gateway.currency) issues.push(issue('currency_mismatch', 'Currency mismatch detected', `Bank currency ${bank.currency} does not match gateway currency ${gateway.currency}.`, 'bank', 'high', ['currency']));
    if (settlement.utr && bank.utr !== settlement.utr) issues.push(issue('utr_mismatch', 'Settlement reference inconsistent', `Bank UTR ${bank.utr ?? 'missing'} does not match settlement UTR ${settlement.utr}.`, 'bank', 'high', ['utr']));
  }

  if (ledger && settlement) {
    if (ledger.transactionId !== gateway.transactionId) issues.push(issue('transaction_id_mismatch', 'Transaction ID mismatch', `Ledger record points to ${ledger.transactionId}, not ${gateway.transactionId}.`, 'ledger', 'high', ['transactionId']));
    if (ledger.settlementId !== settlement.settlementId) issues.push(issue('settlement_id_mismatch', 'Settlement ID mismatch', `Ledger settlement ${ledger.settlementId} does not match ${settlement.settlementId}.`, 'ledger', 'high', ['settlementId']));
    if (ledger.merchantId && ledger.merchantId !== gateway.merchantId) issues.push(issue('merchant_mismatch', 'Merchant mismatch detected', `Ledger merchant ${ledger.merchantId} does not match gateway merchant ${gateway.merchantId}.`, 'ledger', 'high', ['merchantId']));
    if (ledger.currency && ledger.currency !== gateway.currency) issues.push(issue('currency_mismatch', 'Currency mismatch detected', `Ledger currency ${ledger.currency} does not match gateway currency ${gateway.currency}.`, 'ledger', 'high', ['currency']));
    const expectedAmount = bank?.amount ?? settlement.amount;
    if (ledger.amount !== expectedAmount) issues.push(issue('amount_mismatch', 'Amount mismatch detected', `Ledger amount ${ledger.amount} paise does not match upstream amount ${expectedAmount} paise.`, 'ledger', 'high', ['amount']));
    if (ledger.bankReference && bank && ledger.bankReference !== bank.bankReference) issues.push(issue('utr_mismatch', 'Bank reference mismatch', `Ledger bank reference ${ledger.bankReference} does not match ${bank.bankReference}.`, 'ledger', 'high', ['bankReference']));
    if (ledger.utr && bank?.utr && ledger.utr !== bank.utr) issues.push(issue('utr_mismatch', 'Settlement reference inconsistent', `Ledger UTR ${ledger.utr} does not match bank UTR ${bank.utr}.`, 'ledger', 'high', ['utr']));
  }

  return uniqueIssues(issues);
}

interface Outcome {
  status: InvestigationStatus;
  stage: PipelineStage;
  rootCause: string;
  recommendedAction: string;
  slaMinutesRemaining?: number;
}

function explain(outcome: Outcome, context: {
  gateway?: GatewayRecord;
  settlement?: SettlementRecord;
  ledgerCount: number;
  bankElapsed?: number;
}) {
  const amount = context.gateway
    ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: context.gateway.currency, maximumFractionDigits: 0 }).format(context.gateway.amount / 100)
    : 'the payment';
  const settlement = context.settlement?.settlementId;

  if (outcome.rootCause.startsWith('Chronology mismatch')) {
    return `The source timestamps conflict, so the observed stage order cannot be trusted. ${outcome.rootCause}`;
  }
  switch (outcome.status) {
    case 'successful':
      return `${amount} was captured, processed in ${settlement}, credited by the bank, and posted once to the merchant ledger. Every reference and amount reconciles.`;
    case 'pending':
      if (outcome.stage === 'settlement') return `Payment capture is confirmed. ${settlement ?? 'The settlement batch'} is still processing inside its expected service window.`;
      if (outcome.stage === 'ledger') return `Bank credit is confirmed and the merchant ledger is still inside its normal update window.`;
      return `${settlement} was processed ${formatDuration(context.bankElapsed)} ago. Bank credit has not completed, but the transfer remains inside the expected three-hour window.`;
    case 'delayed':
      if (outcome.stage === 'settlement') return `The gateway captured ${amount}, but no complete settlement record was available before the expected cutoff.`;
      if (outcome.stage === 'ledger') return `The bank credited ${settlement}, but the merchant ledger has no matching posting after its expected update window.`;
      return `${settlement} was processed, but no confirmed bank credit was found after the expected three-hour window.`;
    case 'failed':
      return `${settlement ?? 'The transaction'} cannot progress because a ${outcome.stage} record is marked failed. Downstream records should not be treated as complete.`;
    case 'mismatch':
      return `The records cannot be reconciled safely: ${outcome.rootCause.toLowerCase()} Review the highlighted evidence before taking action.`;
    default:
      return `The available records are contradictory or incomplete, so the settlement stage cannot be determined with high confidence.`;
  }
}

function makeStage(
  stage: PipelineStage,
  label: string,
  status: StageStatus,
  source: string,
  evidence: string,
  referenceId?: string,
  timestampValue?: string,
  latencyMinutes?: number,
  anomalies: string[] = [],
): TimelineStage {
  return { stage, label, status, source, evidence, referenceId, timestamp: timestampValue, latencyMinutes, anomalies };
}

export function reconcileTransaction(
  rawTransactionId: string,
  dataset: SettlementDataset,
  reference = new Date(),
  sla: { bankMinutes?: number; ledgerMinutes?: number; gatewayMinutes?: number } = {},
): InvestigationResult {
  const bankSlaMinutes = Number.isFinite(sla.bankMinutes) && (sla.bankMinutes ?? 0) > 0 ? sla.bankMinutes! : BANK_SLA_MINUTES;
  const ledgerSlaMinutes = Number.isFinite(sla.ledgerMinutes) && (sla.ledgerMinutes ?? 0) > 0 ? sla.ledgerMinutes! : LEDGER_SLA_MINUTES;
  const transactionId = rawTransactionId.trim().toUpperCase();
  const gateway = dataset.gateway.find((record) => record.transactionId === transactionId);
  const related = findRelatedRecords(transactionId, gateway, dataset);
  const evidence = buildEvidence(gateway, related.settlements, related.bank, related.ledger);

  if (!gateway) {
    const validationIssues = [
      issue('missing_gateway', 'Gateway record unavailable', 'No matching payment gateway evidence was found.', 'gateway'),
      issue('ambiguous_evidence', 'Unable to establish settlement journey', 'The start of the settlement journey is unknown.', 'gateway', 'medium'),
    ];
    const confidence = calculateConfidence(validationIssues);
    const outcome: Outcome = {
      status: 'uncertain', stage: 'gateway', rootCause: 'No payment gateway record found',
      recommendedAction: 'Verify the transaction ID or import the gateway record before escalating.',
    };
    return {
      transactionId, ...outcome, ...confidence,
      explanation: explain(outcome, { ledgerCount: related.ledger.length }),
      timeline: [makeStage('gateway', 'Payment captured', 'missing', 'Payment gateway', 'No matching gateway evidence', undefined, undefined, undefined, validationIssues.map((value) => value.message))],
      evidence,
      exceptions: validationIssues.map((value) => value.message),
      validationIssues,
    };
  }

  const settlement = related.settlements[0];
  const gatewaySlaMinutes = Number.isFinite(sla.gatewayMinutes) && (sla.gatewayMinutes ?? 0) > 0 ? sla.gatewayMinutes! : gateway.expectedSettlementMinutes;
  const bank = related.bank[0];
  const ledger = related.ledger[0];
  const captureElapsed = minutesBetween(gateway.capturedAt, reference);
  const capturedTimestamp = timestamp(gateway.capturedAt);
  const expectedSettlementTime = capturedTimestamp !== undefined
    ? new Date(capturedTimestamp + gatewaySlaMinutes * 60_000).toISOString()
    : undefined;
  let validationIssues = [
    ...validateReferences(gateway, related.settlements, related.bank, related.ledger),
    ...validateChronology(gateway, settlement, bank, ledger),
  ];
  let outcome: Outcome;

  const chronology = validationIssues.find((value) => value.code === 'chronology_mismatch');
  const conflicting = bank?.status === 'failed' && related.ledger.some((record) => record.status === 'posted');
  if (conflicting) validationIssues.push(issue('conflicting_evidence', 'Conflicting records', 'Bank reports failure while the merchant ledger reports a successful posting.', 'bank'));

  const duplicateSettlement = related.settlements.length > 1;
  const integrityIssue = validationIssues.find((value) => !['duplicate_records', 'conflicting_evidence', 'chronology_mismatch'].includes(value.code));

  if (!gateway.capturedAt || capturedTimestamp === undefined) {
    validationIssues.push(issue('missing_timestamp', 'Capture timestamp unavailable', 'SLA and stage ordering cannot be calculated.', 'gateway'));
    validationIssues.push(issue('ambiguous_evidence', 'SLA cannot be calculated', 'The investigation has no reliable time origin.', 'gateway', 'medium'));
    outcome = { status: 'uncertain', stage: 'gateway', rootCause: 'Capture timestamp is missing', recommendedAction: 'Request the original gateway event before calculating SLA or settlement status.' };
  } else if (chronology) {
    outcome = { status: 'mismatch', stage: chronology.stage, rootCause: `Chronology mismatch: ${chronology.detail}`, recommendedAction: 'Pause automatic resolution and correct the conflicting source timestamps before tracing the transaction.' };
  } else if (conflicting) {
    outcome = { status: 'uncertain', stage: 'bank', rootCause: 'Bank reports failure while the ledger reports a successful posting', recommendedAction: 'Freeze automated messaging and request manual bank-ledger reconciliation.' };
  } else if (duplicateSettlement) {
    outcome = { status: 'uncertain', stage: 'settlement', rootCause: 'Multiple settlement batches reference one transaction', recommendedAction: 'Pause merchant communication and reconcile duplicate settlement references.' };
  } else if (integrityIssue) {
    outcome = { status: 'mismatch', stage: integrityIssue.stage, rootCause: integrityIssue.detail, recommendedAction: 'Block automatic resolution and reconcile the highlighted cross-source fields.' };
  } else if (gateway.status === 'failed') {
    outcome = { status: 'failed', stage: 'gateway', rootCause: 'Payment capture failed', recommendedAction: 'Return the gateway failure reason to the merchant; do not trace settlement.' };
  } else if (!settlement) {
    validationIssues.push(issue('missing_settlement', 'Settlement record unavailable', 'Captured payment has no linked settlement record.', 'settlement', captureElapsed !== undefined && captureElapsed > gatewaySlaMinutes ? 'high' : 'medium'));
    const overdue = captureElapsed !== undefined && captureElapsed > gatewaySlaMinutes;
    outcome = overdue
      ? { status: 'delayed', stage: 'settlement', rootCause: 'Captured payment is missing from a settlement batch', recommendedAction: 'Escalate to settlement operations with the gateway reference.' }
      : { status: 'pending', stage: 'settlement', rootCause: 'Settlement batch has not been created yet', recommendedAction: 'Monitor until the payment reaches its expected settlement cutoff.', slaMinutesRemaining: Math.max(0, gatewaySlaMinutes - (captureElapsed ?? 0)) };
  } else if (settlement.status === 'failed') {
    outcome = { status: 'failed', stage: 'settlement', rootCause: 'Settlement batch failed', recommendedAction: 'Escalate the failed settlement ID to payment operations and notify the merchant.' };
  } else if (settlement.status === 'created' || !settlement.processedAt) {
    if (settlement.status === 'processed' && !settlement.processedAt) validationIssues.push(issue('missing_timestamp', 'Settlement processing timestamp unavailable', 'The settlement is marked processed without a processedAt value.', 'settlement'));
    const elapsed = minutesBetween(settlement.createdAt, reference);
    const remaining = Math.max(0, gatewaySlaMinutes - (elapsed ?? gatewaySlaMinutes));
    outcome = elapsed !== undefined && elapsed <= gatewaySlaMinutes
      ? { status: 'pending', stage: 'settlement', rootCause: 'Settlement batch is still processing', recommendedAction: 'Continue monitoring; no escalation is needed inside the processing window.', slaMinutesRemaining: remaining }
      : { status: 'delayed', stage: 'settlement', rootCause: 'Settlement processing exceeded its service window', recommendedAction: 'Escalate the delayed batch to settlement operations.' };
  } else if (!bank) {
    validationIssues.push(issue('missing_bank', 'Bank record unavailable', 'Processed settlement has no linked bank record.', 'bank', 'medium'));
    const elapsed = minutesBetween(settlement.processedAt, reference);
    outcome = elapsed !== undefined && elapsed <= bankSlaMinutes
      ? { status: 'pending', stage: 'bank', rootCause: 'Bank credit is awaiting confirmation', recommendedAction: 'Monitor until the configured bank window expires.', slaMinutesRemaining: bankSlaMinutes - elapsed }
      : { status: 'delayed', stage: 'bank', rootCause: 'No bank credit found after the expected window', recommendedAction: 'Escalate with the settlement ID and UTR.' };
  } else if (bank.status === 'failed') {
    outcome = { status: 'failed', stage: 'bank', rootCause: 'Bank transfer failed', recommendedAction: 'Escalate the failed transfer using the bank reference and settlement UTR.' };
  } else if (bank.status === 'pending') {
    const elapsed = minutesBetween(settlement.processedAt, reference);
    outcome = elapsed !== undefined && elapsed <= bankSlaMinutes
      ? { status: 'pending', stage: 'bank', rootCause: 'Bank credit is pending inside SLA', recommendedAction: 'Continue monitoring until the bank SLA expires.', slaMinutesRemaining: bankSlaMinutes - elapsed }
      : { status: 'delayed', stage: 'bank', rootCause: 'Bank credit exceeded the expected window', recommendedAction: 'Escalate to the banking partner with the UTR.' };
  } else if (!bank.creditedAt || timestamp(bank.creditedAt) === undefined) {
    validationIssues.push(issue('missing_timestamp', 'Bank credit timestamp unavailable', 'The bank is marked credited without a valid creditedAt value.', 'bank'));
    outcome = { status: 'uncertain', stage: 'bank', rootCause: 'Bank credit timestamp is missing', recommendedAction: 'Request the bank confirmation timestamp before closing the case.' };
  } else if (related.ledger.length === 0) {
    validationIssues.push(issue('missing_ledger', 'Merchant ledger record unavailable', 'Bank credit has no linked merchant ledger entry.', 'ledger', 'medium'));
    const elapsed = minutesBetween(bank.creditedAt, reference);
    outcome = elapsed !== undefined && elapsed <= ledgerSlaMinutes
      ? { status: 'pending', stage: 'ledger', rootCause: 'Ledger posting is still inside its update window', recommendedAction: 'Wait for the ledger synchronization window to close.', slaMinutesRemaining: ledgerSlaMinutes - elapsed }
      : { status: 'delayed', stage: 'ledger', rootCause: 'Bank credit has no matching merchant ledger entry', recommendedAction: 'Escalate to merchant ledger operations with the bank reference.' };
  } else if (related.ledger.length > 1) {
    outcome = { status: 'mismatch', stage: 'ledger', rootCause: `${related.ledger.length} ledger postings were found for one transaction.`, recommendedAction: 'Flag the duplicate entries and begin ledger reversal review.' };
  } else if (!ledger.postedAt || timestamp(ledger.postedAt) === undefined) {
    validationIssues.push(issue('missing_timestamp', 'Ledger posting timestamp unavailable', 'The ledger record does not contain a valid postedAt value.', 'ledger'));
    outcome = { status: 'uncertain', stage: 'ledger', rootCause: 'Ledger posting timestamp is missing', recommendedAction: 'Request the ledger event timestamp before closing the case.' };
  } else {
    outcome = { status: 'successful', stage: 'ledger', rootCause: 'All settlement stages reconciled', recommendedAction: 'Close the case and share the bank and ledger references with the merchant.' };
  }

  validationIssues = uniqueIssues(validationIssues);
  const confidence = calculateConfidence(validationIssues);
  const issueMessages = [...new Set(validationIssues.map((value) => value.message))];
  const anomaliesFor = (stage: PipelineStage) => validationIssues.filter((value) => value.stage === stage).map((value) => value.message);
  const outcomeStageStatus: StageStatus = outcome.status === 'failed' ? 'failed'
    : outcome.status === 'delayed' ? 'delayed'
      : outcome.status === 'pending' ? 'current'
        : outcome.status === 'successful' ? 'complete' : 'mismatch';

  let gatewayStatus: StageStatus = gateway.status === 'captured' ? 'complete' : 'failed';
  let settlementCreatedStatus: StageStatus = settlement ? 'complete' : outcome.stage === 'settlement' ? 'missing' : 'pending';
  let settlementProcessedStatus: StageStatus = !settlement ? 'pending' : settlement.status === 'failed' ? 'failed' : settlement.processedAt ? 'complete' : outcome.stage === 'settlement' ? outcomeStageStatus : 'pending';
  let bankStatus: StageStatus = !bank ? outcome.stage === 'bank' ? (outcome.status === 'pending' ? 'current' : 'missing') : 'pending' : bank.status === 'failed' ? 'failed' : bank.status === 'pending' ? 'current' : 'complete';
  let ledgerStatus: StageStatus = !ledger ? outcome.stage === 'ledger' ? (outcome.status === 'pending' ? 'current' : 'missing') : 'pending' : related.ledger.length > 1 ? 'mismatch' : 'complete';
  if (outcome.stage === 'gateway') gatewayStatus = outcomeStageStatus;
  if (outcome.stage === 'settlement') settlementProcessedStatus = outcomeStageStatus;
  if (outcome.stage === 'bank') bankStatus = outcomeStageStatus;
  if (outcome.stage === 'ledger') ledgerStatus = outcomeStageStatus;
  if (anomaliesFor('settlement').length && settlement) settlementCreatedStatus = 'mismatch';

  const bankElapsed = minutesBetween(settlement?.processedAt, reference);
  const timeline: TimelineStage[] = [
    makeStage('gateway', 'Payment captured', gatewayStatus, 'Payment gateway', `${gateway.status} · ${gateway.amount} paise`, gateway.gatewayReference, gateway.capturedAt, 0, anomaliesFor('gateway')),
    makeStage('settlement', 'Settlement batch created', settlementCreatedStatus, 'Settlement system', settlement ? `${settlement.status} · ${settlement.amount} paise` : 'No matching batch', settlement?.settlementId, settlement?.createdAt, settlement ? minutesBetween(gateway.capturedAt, settlement.createdAt) : undefined, anomaliesFor('settlement')),
    makeStage('settlement', 'Settlement processed', settlementProcessedStatus, 'Settlement system', settlement?.processedAt ? `Processed · ${settlement.utr ?? 'UTR unavailable'}` : settlement ? 'Awaiting processor confirmation' : 'Blocked until a batch exists', settlement?.utr ?? settlement?.settlementId, settlement?.processedAt, minutesBetween(settlement?.createdAt, settlement?.processedAt), anomaliesFor('settlement')),
    makeStage('bank', 'Bank credit', bankStatus, 'Bank settlement system', bank ? `${bank.status} · ${bank.amount} paise` : 'No bank record', bank?.bankReference, bank?.creditedAt, minutesBetween(settlement?.processedAt, bank?.creditedAt), anomaliesFor('bank')),
    makeStage('ledger', 'Merchant ledger posting', ledgerStatus, 'Merchant ledger', related.ledger.length ? `${related.ledger.length} matching record${related.ledger.length > 1 ? 's' : ''}` : 'No ledger posting', ledger?.ledgerReference, ledger?.postedAt, minutesBetween(bank?.creditedAt, ledger?.postedAt), anomaliesFor('ledger')),
  ];

  return {
    transactionId,
    ...outcome,
    ...confidence,
    explanation: explain(outcome, { gateway, settlement, ledgerCount: related.ledger.length, bankElapsed }),
    exceptions: issueMessages,
    validationIssues,
    timeline,
    evidence,
    settlementId: settlement?.settlementId,
    amount: gateway.amount,
    currency: gateway.currency,
    merchant: gateway.merchantName,
    transactionTimestamp: gateway.capturedAt,
    expectedSettlementTime,
  };
}

export function extractTransactionId(input: string) {
  return input.toUpperCase().match(/TXN-[A-Z0-9-]{3,}/)?.[0] ?? input.trim().toUpperCase();
}

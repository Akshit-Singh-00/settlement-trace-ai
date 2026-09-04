import type {
  BankRecord,
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
} from './settlement-types';

const BANK_SLA_MINUTES = 180;
const LEDGER_SLA_MINUTES = 30;

function minutesBetween(earlier?: string, later = new Date()): number | undefined {
  if (!earlier) return undefined;
  const start = new Date(earlier).getTime();
  if (Number.isNaN(start)) return undefined;
  return Math.max(0, Math.round((later.getTime() - start) / 60_000));
}

function formatDuration(minutes?: number) {
  if (minutes === undefined) return 'time unavailable';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function recordForEvidence(record: object | undefined) {
  if (!record) return [];
  return [record as Record<string, string | number | undefined>];
}

function buildEvidence(
  gateway: GatewayRecord | undefined,
  settlements: SettlementRecord[],
  bank: BankRecord[],
  ledger: LedgerRecord[],
): EvidenceGroup[] {
  return [
    { source: 'Payment gateway', records: recordForEvidence(gateway) },
    { source: 'Settlement system', records: settlements as unknown as EvidenceGroup['records'] },
    { source: 'Bank', records: bank as unknown as EvidenceGroup['records'] },
    { source: 'Merchant ledger', records: ledger as unknown as EvidenceGroup['records'] },
  ];
}

function makeStage(
  stage: PipelineStage,
  label: string,
  status: StageStatus,
  source: string,
  evidence: string,
  referenceId?: string,
  timestamp?: string,
  latencyMinutes?: number,
): TimelineStage {
  return { stage, label, status, source, evidence, referenceId, timestamp, latencyMinutes };
}

interface Outcome {
  status: InvestigationStatus;
  stage: PipelineStage;
  rootCause: string;
  confidence: number;
  recommendedAction: string;
  exceptions?: string[];
  slaMinutesRemaining?: number;
}

function explain(outcome: Outcome, context: {
  gateway?: GatewayRecord;
  settlement?: SettlementRecord;
  bank?: BankRecord;
  ledgerCount: number;
  bankElapsed?: number;
}) {
  const amount = context.gateway
    ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(context.gateway.amount / 100)
    : 'the payment';
  const settlement = context.settlement?.settlementId;

  switch (outcome.status) {
    case 'successful':
      return `${amount} was captured, processed in ${settlement}, credited by the bank, and posted once to the merchant ledger. Every reference and amount reconciles.`;
    case 'pending':
      if (outcome.stage === 'settlement') return `Payment capture is confirmed. ${settlement ?? 'The settlement batch'} is still processing inside its expected service window.`;
      return `${settlement} was processed ${formatDuration(context.bankElapsed)} ago. Bank credit has not completed, but the transfer remains inside the expected three-hour window.`;
    case 'delayed':
      if (outcome.stage === 'settlement') return `The gateway captured ${amount}, but no settlement batch was created before the expected cutoff.`;
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

export function reconcileTransaction(
  rawTransactionId: string,
  dataset: SettlementDataset,
  reference = new Date(),
): InvestigationResult {
  const transactionId = rawTransactionId.trim().toUpperCase();
  const gateway = dataset.gateway.find((record) => record.transactionId === transactionId);
  const settlements = dataset.settlements.filter((record) => record.transactionId === transactionId);
  const bankRecords = dataset.bank.filter((record) => record.transactionId === transactionId);
  const ledgerRecords = dataset.ledger.filter((record) => record.transactionId === transactionId);
  const evidence = buildEvidence(gateway, settlements, bankRecords, ledgerRecords);

  if (!gateway) {
    const outcome: Outcome = {
      status: 'uncertain', stage: 'gateway', rootCause: 'No payment gateway record found', confidence: 18,
      recommendedAction: 'Verify the transaction ID or import the gateway record before escalating.',
      exceptions: ['Gateway record unavailable', 'Unable to establish the start of the settlement journey'],
    };
    return {
      transactionId, ...outcome, explanation: explain(outcome, { ledgerCount: ledgerRecords.length }),
      timeline: [makeStage('gateway', 'Payment captured', 'missing', 'Payment gateway', 'No matching gateway evidence')], evidence,
      exceptions: outcome.exceptions ?? [],
    };
  }

  const captureElapsed = minutesBetween(gateway.capturedAt, reference);
  const expectedSettlementTime = gateway.capturedAt
    ? new Date(new Date(gateway.capturedAt).getTime() + gateway.expectedSettlementMinutes * 60_000).toISOString()
    : undefined;
  const settlement = settlements[0];
  const bank = bankRecords[0];
  let outcome: Outcome;

  if (!gateway.capturedAt) {
    outcome = {
      status: 'uncertain', stage: 'gateway', rootCause: 'Capture timestamp is missing', confidence: 34,
      recommendedAction: 'Request the original gateway event before calculating SLA or settlement status.',
      exceptions: ['Capture timestamp unavailable', 'SLA cannot be calculated'],
    };
  } else if (gateway.status === 'failed') {
    outcome = { status: 'failed', stage: 'gateway', rootCause: 'Payment capture failed', confidence: 99, recommendedAction: 'Return the gateway failure reason to the merchant; do not trace settlement.' };
  } else if (settlements.length > 1) {
    outcome = { status: 'uncertain', stage: 'settlement', rootCause: 'Multiple settlement batches reference one transaction', confidence: 48, recommendedAction: 'Pause merchant communication and reconcile duplicate settlement references.', exceptions: ['Conflicting settlement records'] };
  } else if (!settlement) {
    const overdue = (captureElapsed ?? 0) > gateway.expectedSettlementMinutes;
    outcome = overdue
      ? { status: 'delayed', stage: 'settlement', rootCause: 'Captured payment is missing from a settlement batch', confidence: 96, recommendedAction: 'Escalate to settlement operations with the gateway reference.', exceptions: ['Settlement record unavailable'] }
      : { status: 'pending', stage: 'settlement', rootCause: 'Settlement batch has not been created yet', confidence: 88, recommendedAction: 'Monitor until the payment reaches its expected settlement cutoff.', slaMinutesRemaining: gateway.expectedSettlementMinutes - (captureElapsed ?? 0) };
  } else if (settlement.amount !== gateway.amount) {
    outcome = { status: 'mismatch', stage: 'settlement', rootCause: `Amount mismatch: gateway ${gateway.amount} paise vs settlement ${settlement.amount} paise.`, confidence: 98, recommendedAction: 'Block automatic resolution and ask settlement operations to reconcile the batch total.', exceptions: ['Amount mismatch detected'] };
  } else if (settlement.gatewayReference !== gateway.gatewayReference) {
    outcome = { status: 'mismatch', stage: 'settlement', rootCause: 'Gateway reference is inconsistent in the settlement record.', confidence: 97, recommendedAction: 'Verify the settlement mapping before continuing.', exceptions: ['Settlement reference inconsistent'] };
  } else if (settlement.status === 'failed') {
    outcome = { status: 'failed', stage: 'settlement', rootCause: 'Settlement batch failed', confidence: 99, recommendedAction: 'Escalate the failed settlement ID to payment operations and notify the merchant.' };
  } else if (settlement.status === 'created' || !settlement.processedAt) {
    const elapsed = minutesBetween(settlement.createdAt, reference) ?? 0;
    const remaining = Math.max(0, gateway.expectedSettlementMinutes - elapsed);
    outcome = elapsed <= gateway.expectedSettlementMinutes
      ? { status: 'pending', stage: 'settlement', rootCause: 'Settlement batch is still processing', confidence: 94, recommendedAction: 'Continue monitoring; no escalation is needed inside the processing window.', slaMinutesRemaining: remaining }
      : { status: 'delayed', stage: 'settlement', rootCause: 'Settlement processing exceeded its service window', confidence: 96, recommendedAction: 'Escalate the delayed batch to settlement operations.' };
  } else if (!bank) {
    const elapsed = minutesBetween(settlement.processedAt, reference) ?? 0;
    outcome = elapsed <= BANK_SLA_MINUTES
      ? { status: 'pending', stage: 'bank', rootCause: 'Bank credit is awaiting confirmation', confidence: 90, recommendedAction: 'Monitor until the three-hour bank window expires.', slaMinutesRemaining: BANK_SLA_MINUTES - elapsed }
      : { status: 'delayed', stage: 'bank', rootCause: 'No bank credit found after the expected window', confidence: 95, recommendedAction: 'Escalate with the settlement ID and UTR.', exceptions: ['Bank record unavailable'] };
  } else if (bank.amount !== settlement.amount) {
    outcome = { status: 'mismatch', stage: 'bank', rootCause: `Bank amount ${bank.amount} paise does not match settlement amount ${settlement.amount} paise.`, confidence: 98, recommendedAction: 'Hold resolution and reconcile the bank credit amount.', exceptions: ['Amount mismatch detected'] };
  } else if (settlement.utr && bank.utr !== settlement.utr) {
    outcome = { status: 'mismatch', stage: 'bank', rootCause: 'Bank UTR does not match the processed settlement UTR.', confidence: 98, recommendedAction: 'Trace both UTR references with the banking partner.', exceptions: ['Settlement reference inconsistent'] };
  } else if (bank.status === 'failed') {
    if (ledgerRecords.some((record) => record.status === 'posted')) {
      outcome = { status: 'uncertain', stage: 'bank', rootCause: 'Bank reports failure while the ledger reports a successful posting', confidence: 42, recommendedAction: 'Freeze automated messaging and request manual bank-ledger reconciliation.', exceptions: ['Conflicting records', 'Unable to determine settlement stage confidently'] };
    } else {
      outcome = { status: 'failed', stage: 'bank', rootCause: 'Bank transfer failed', confidence: 99, recommendedAction: 'Escalate the failed transfer using the bank reference and settlement UTR.' };
    }
  } else if (bank.status === 'pending') {
    const elapsed = minutesBetween(settlement.processedAt, reference) ?? 0;
    outcome = elapsed <= BANK_SLA_MINUTES
      ? { status: 'pending', stage: 'bank', rootCause: 'Bank credit is pending inside SLA', confidence: 95, recommendedAction: 'Continue monitoring until the bank SLA expires.', slaMinutesRemaining: BANK_SLA_MINUTES - elapsed }
      : { status: 'delayed', stage: 'bank', rootCause: 'Bank credit exceeded the expected window', confidence: 97, recommendedAction: 'Escalate to the banking partner with the UTR.' };
  } else if (ledgerRecords.length === 0) {
    const elapsed = minutesBetween(bank.creditedAt, reference) ?? 0;
    outcome = elapsed <= LEDGER_SLA_MINUTES
      ? { status: 'pending', stage: 'ledger', rootCause: 'Ledger posting is still inside its update window', confidence: 90, recommendedAction: 'Wait for the ledger synchronization window to close.', slaMinutesRemaining: LEDGER_SLA_MINUTES - elapsed }
      : { status: 'delayed', stage: 'ledger', rootCause: 'Bank credit has no matching merchant ledger entry', confidence: 97, recommendedAction: 'Escalate to merchant ledger operations with the bank reference.', exceptions: ['Merchant ledger record unavailable'] };
  } else if (ledgerRecords.length > 1) {
    outcome = { status: 'mismatch', stage: 'ledger', rootCause: `${ledgerRecords.length} ledger postings were found for one transaction.`, confidence: 99, recommendedAction: 'Flag the duplicate entries and begin ledger reversal review.', exceptions: ['Multiple ledger matches found'] };
  } else if (ledgerRecords[0].amount !== bank.amount) {
    outcome = { status: 'mismatch', stage: 'ledger', rootCause: 'Ledger amount does not match the credited bank amount.', confidence: 98, recommendedAction: 'Reconcile the ledger posting before closing the case.', exceptions: ['Amount mismatch detected'] };
  } else {
    outcome = { status: 'successful', stage: 'ledger', rootCause: 'All settlement stages reconciled', confidence: 99, recommendedAction: 'Close the case and share the bank and ledger references with the merchant.' };
  }

  const bankElapsed = minutesBetween(settlement?.processedAt, reference);
  const outcomeStageStatus = ({
    successful: 'complete',
    failed: 'failed',
    mismatch: 'mismatch',
    delayed: 'delayed',
    pending: 'current',
    uncertain: 'mismatch',
  } satisfies Record<InvestigationStatus, StageStatus>)[outcome.status];
  const settlementCreatedStatus: StageStatus = !settlement
    ? outcome.stage === 'settlement' ? 'missing' : 'pending'
    : outcome.stage === 'settlement' && (settlements.length > 1 || outcome.status === 'mismatch')
      ? 'mismatch'
      : 'complete';
  const settlementProcessedStatus: StageStatus = !settlement
    ? 'pending'
    : settlement.status === 'failed'
      ? 'failed'
      : !settlement.processedAt
        ? outcome.stage === 'settlement' ? outcomeStageStatus : 'pending'
        : outcome.stage === 'settlement' ? outcomeStageStatus : 'complete';
  const timeline: TimelineStage[] = [
    makeStage('gateway', 'Payment captured', gateway.status === 'captured' ? 'complete' : 'failed', 'Payment gateway', `${gateway.status} · ${gateway.amount} paise`, gateway.gatewayReference, gateway.capturedAt, 0),
    makeStage('settlement', 'Settlement batch created', settlementCreatedStatus, 'Settlement system', settlement ? `${settlement.status} · ${settlement.amount} paise` : 'No matching batch', settlement?.settlementId, settlement?.createdAt, settlement ? minutesBetween(gateway.capturedAt, new Date(settlement.createdAt)) : undefined),
    makeStage('settlement', 'Settlement processed', settlementProcessedStatus, 'Settlement system', settlement?.processedAt ? `Processed · ${settlement.utr ?? 'UTR unavailable'}` : settlement ? 'Awaiting processor confirmation' : 'Blocked until a batch exists', settlement?.utr ?? settlement?.settlementId, settlement?.processedAt, settlement?.processedAt ? minutesBetween(settlement.createdAt, new Date(settlement.processedAt)) : undefined),
    makeStage('bank', 'Bank credit', !bank ? (outcome.stage === 'bank' ? (outcome.status === 'pending' ? 'current' : 'missing') : 'pending') : outcome.stage === 'bank' ? ({ successful: 'complete', failed: 'failed', mismatch: 'mismatch', delayed: 'delayed', pending: 'current', uncertain: 'mismatch' }[outcome.status] as StageStatus) : 'complete', 'Bank settlement system', bank ? `${bank.status} · ${bank.amount} paise` : 'No bank record', bank?.bankReference, bank?.creditedAt, bankElapsed),
    makeStage('ledger', 'Merchant ledger posting', ledgerRecords.length === 0 ? (outcome.stage === 'ledger' ? 'missing' : 'pending') : outcome.stage === 'ledger' ? (outcome.status === 'successful' ? 'complete' : outcome.status === 'mismatch' ? 'mismatch' : outcome.status === 'delayed' ? 'delayed' : 'current') : 'complete', 'Merchant ledger', ledgerRecords.length ? `${ledgerRecords.length} matching record${ledgerRecords.length > 1 ? 's' : ''}` : 'No ledger posting', ledgerRecords[0]?.ledgerReference, ledgerRecords[0]?.postedAt, minutesBetween(bank?.creditedAt, ledgerRecords[0]?.postedAt ? new Date(ledgerRecords[0].postedAt) : reference)),
  ];

  return {
    transactionId,
    ...outcome,
    explanation: explain(outcome, { gateway, settlement, bank, ledgerCount: ledgerRecords.length, bankElapsed }),
    exceptions: outcome.exceptions ?? [],
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
  return input.toUpperCase().match(/TXN-\d{4,}/)?.[0] ?? input.trim().toUpperCase();
}

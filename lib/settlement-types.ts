export type PipelineStage = 'gateway' | 'settlement' | 'bank' | 'ledger';

export type InvestigationStatus =
  | 'successful'
  | 'pending'
  | 'delayed'
  | 'failed'
  | 'mismatch'
  | 'uncertain';

export type StageStatus =
  | 'complete'
  | 'current'
  | 'pending'
  | 'delayed'
  | 'failed'
  | 'missing'
  | 'mismatch';

export interface GatewayRecord {
  transactionId: string;
  merchantId: string;
  merchantName: string;
  amount: number;
  currency: string;
  status: 'captured' | 'failed';
  gatewayReference: string;
  capturedAt: string;
  expectedSettlementMinutes: number;
}

export interface SettlementRecord {
  settlementId: string;
  transactionId: string;
  amount: number;
  merchantId?: string;
  currency?: string;
  status: 'created' | 'processed' | 'failed';
  gatewayReference: string;
  utr?: string;
  createdAt: string;
  processedAt?: string;
}

export interface BankRecord {
  bankReference: string;
  settlementId: string;
  transactionId: string;
  amount: number;
  merchantId?: string;
  currency?: string;
  status: 'pending' | 'credited' | 'failed';
  utr?: string;
  creditedAt?: string;
}

export interface LedgerRecord {
  ledgerReference: string;
  settlementId: string;
  transactionId: string;
  amount: number;
  merchantId?: string;
  currency?: string;
  bankReference?: string;
  utr?: string;
  status: 'posted' | 'reversed';
  postedAt: string;
}

export interface SettlementDataset {
  gateway: GatewayRecord[];
  settlements: SettlementRecord[];
  bank: BankRecord[];
  ledger: LedgerRecord[];
}

export interface TimelineStage {
  stage: PipelineStage;
  label: string;
  status: StageStatus;
  timestamp?: string;
  source: string;
  referenceId?: string;
  evidence: string;
  latencyMinutes?: number;
  anomalies?: string[];
}

export type ValidationIssueCode =
  | 'missing_gateway'
  | 'missing_settlement'
  | 'missing_bank'
  | 'missing_ledger'
  | 'missing_timestamp'
  | 'transaction_id_mismatch'
  | 'settlement_id_mismatch'
  | 'gateway_reference_mismatch'
  | 'utr_mismatch'
  | 'merchant_mismatch'
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'duplicate_records'
  | 'chronology_mismatch'
  | 'conflicting_evidence'
  | 'ambiguous_evidence';

export interface ValidationIssue {
  code: ValidationIssueCode;
  message: string;
  detail: string;
  stage: PipelineStage;
  severity: 'low' | 'medium' | 'high';
  fields?: string[];
}

export interface ConfidenceFactor {
  reason: string;
  deduction: number;
  stage: PipelineStage;
}

export interface EvidenceGroup {
  source: 'Payment gateway' | 'Settlement system' | 'Bank' | 'Merchant ledger';
  records: Array<Record<string, string | number | undefined>>;
}

export interface InvestigationResult {
  transactionId: string;
  status: InvestigationStatus;
  stage: PipelineStage;
  rootCause: string;
  confidence: number;
  explanation: string;
  recommendedAction: string;
  exceptions: string[];
  validationIssues: ValidationIssue[];
  confidenceBreakdown: ConfidenceFactor[];
  timeline: TimelineStage[];
  evidence: EvidenceGroup[];
  settlementId?: string;
  amount?: number;
  currency?: string;
  merchant?: string;
  transactionTimestamp?: string;
  expectedSettlementTime?: string;
  slaMinutesRemaining?: number;
}

export interface DemoCase {
  transactionId: string;
  label: string;
  category: InvestigationStatus;
  summary: string;
}

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
  currency: 'INR';
  status: 'captured' | 'failed';
  gatewayReference: string;
  capturedAt: string;
  expectedSettlementMinutes: number;
}

export interface SettlementRecord {
  settlementId: string;
  transactionId: string;
  amount: number;
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
  status: 'pending' | 'credited' | 'failed';
  utr?: string;
  creditedAt?: string;
}

export interface LedgerRecord {
  ledgerReference: string;
  settlementId: string;
  transactionId: string;
  amount: number;
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

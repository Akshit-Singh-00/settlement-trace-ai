import type {
  InvestigationResult,
  InvestigationStatus,
} from './settlement-types';

export type WorkspaceRole = 'viewer' | 'investigator' | 'admin';
export type CaseStatus = 'todo' | 'in_progress' | 'resolved';
export type WorkspaceView =
  | 'overview'
  | 'exceptions'
  | 'investigation'
  | 'imports'
  | 'profile'
  | 'admin';
export interface WorkspaceMember {
  id: string;
  auth_user_id: string | null;
  email: string;
  display_name: string;
  avatar_url: string;
  role: WorkspaceRole;
  active: boolean;
  theme: 'light' | 'dark' | 'system';
  timezone: string;
  default_view: 'overview' | 'exceptions';
  last_login_at: string | null;
  trace_count: number;
  created_at: string;
}
export interface WorkspaceSettings {
  bank_sla_minutes: number;
  ledger_sla_minutes: number;
  gateway_sla_minutes: number;
  alert_after_minutes: number;
  alerts_enabled: boolean;
}
export interface WorkspaceCase {
  transaction_id: string;
  status: CaseStatus;
  assignee_id: string | null;
  updated_at: string;
  updated_by: string;
}
export interface CaseNote {
  id: string;
  transaction_id: string;
  author_id: string;
  body: string;
  reference_url: string;
  created_at: string;
}
export interface AuditEntry {
  id: string;
  actor_id: string | null;
  action: string;
  transaction_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}
export interface ScanSummary {
  id: string;
  created_at: string;
  transaction_count: number;
  exception_count: number;
  counts: Record<InvestigationStatus, number>;
}
export type TransactionSummary = Pick<
  InvestigationResult,
  | 'transactionId'
  | 'status'
  | 'stage'
  | 'rootCause'
  | 'confidence'
  | 'amount'
  | 'currency'
  | 'merchant'
  | 'transactionTimestamp'
  | 'slaMinutesRemaining'
> & { issueCodes: string[]; caseStatus: CaseStatus; assigneeId: string | null };
export const defaultWorkspaceSettings: WorkspaceSettings = {
  bank_sla_minutes: 180,
  ledger_sla_minutes: 30,
  gateway_sla_minutes: 120,
  alert_after_minutes: 2880,
  alerts_enabled: false,
};
export const rolePermissions = {
  viewer: ['read'],
  investigator: [
    'read',
    'trace',
    'import',
    'report',
    'comment',
    'scan',
    'extract',
  ],
  admin: [
    'read',
    'trace',
    'import',
    'report',
    'comment',
    'scan',
    'extract',
    'admin',
  ],
} as const;
export type WorkspacePermission = (typeof rolePermissions.admin)[number];
export function canAccess(
  role: WorkspaceRole,
  permission: WorkspacePermission,
) {
  return (rolePermissions[role] as readonly string[]).includes(permission);
}

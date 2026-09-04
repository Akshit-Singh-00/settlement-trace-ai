import { reconcileTransaction } from '@/lib/reconciliation';
import {
  defaultWorkspaceSettings,
  type WorkspaceSettings,
  type WorkspaceCase,
  type TransactionSummary,
} from '@/lib/workspace-types';
import type {
  InvestigationResult,
  InvestigationStatus,
  SettlementDataset,
} from '@/lib/settlement-types';
import { WorkspaceError, serviceDatabase } from './workspace-auth';

export type WorkspaceDatabase = ReturnType<typeof serviceDatabase>;
export function databaseCheck(error: { message: string } | null) {
  if (error)
    throw new WorkspaceError(
      503,
      'The workspace could not save or load this change. Please retry.',
    );
}
export async function audit(
  db: WorkspaceDatabase,
  actorId: string | null,
  action: string,
  transactionId: string | null = null,
  detail: Record<string, unknown> = {},
) {
  const { error } = await db.from('workspace_audit').insert({
    actor_id: actorId,
    action,
    transaction_id: transactionId,
    detail,
  });
  databaseCheck(error);
}
export async function loadSettings(
  db: WorkspaceDatabase,
): Promise<WorkspaceSettings> {
  const { data, error } = await db
    .from('workspace_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  databaseCheck(error);
  return data ?? defaultWorkspaceSettings;
}
export async function loadDataset(
  db: WorkspaceDatabase,
): Promise<SettlementDataset> {
  const dataset: SettlementDataset = {
    gateway: [],
    settlements: [],
    bank: [],
    ledger: [],
  };
  for (let offset = 0; offset <= 10000; offset += 1000) {
    const { data, error } = await db
      .from('workspace_records')
      .select('source,payload')
      .order('id')
      .range(offset, offset + 999);
    databaseCheck(error);
    if (offset === 10000 && data?.length)
      throw new WorkspaceError(
        422,
        'This workspace exceeds the supported scan size.',
      );
    for (const row of data ?? []) {
      const key =
        row.source === 'settlement'
          ? 'settlements'
          : (row.source as keyof SettlementDataset);
      if (!(key in dataset))
        throw new WorkspaceError(
          503,
          'An invalid source record needs administrator review.',
        );
      dataset[key].push(row.payload);
    }
    if (!data || data.length < 1000) break;
  }
  return dataset;
}
export function computeResults(
  dataset: SettlementDataset,
  settings: WorkspaceSettings,
  now = new Date(),
) {
  const ids = new Set(
    [
      ...dataset.gateway,
      ...dataset.settlements,
      ...dataset.bank,
      ...dataset.ledger,
    ].map((r) => r.transactionId),
  );
  return [...ids].map((id) =>
    reconcileTransaction(id, dataset, now, {
      bankMinutes: settings.bank_sla_minutes,
      ledgerMinutes: settings.ledger_sla_minutes,
      gatewayMinutes: settings.gateway_sla_minutes,
    }),
  );
}
export function statusCounts(results: InvestigationResult[]) {
  const counts: Record<InvestigationStatus, number> = {
    successful: 0,
    pending: 0,
    delayed: 0,
    failed: 0,
    mismatch: 0,
    uncertain: 0,
  };
  for (const result of results) counts[result.status]++;
  return counts;
}
export function summary(
  result: InvestigationResult,
  cases: WorkspaceCase[],
): TransactionSummary {
  const current = cases.find((c) => c.transaction_id === result.transactionId);
  const {
    transactionId,
    status,
    stage,
    rootCause,
    confidence,
    amount,
    currency,
    merchant,
    transactionTimestamp,
    slaMinutesRemaining,
  } = result;
  return {
    transactionId,
    status,
    stage,
    rootCause,
    confidence,
    amount,
    currency,
    merchant,
    transactionTimestamp,
    slaMinutesRemaining,
    issueCodes: result.validationIssues.map((i) => i.code),
    caseStatus: current?.status ?? 'todo',
    assigneeId: current?.assignee_id ?? null,
  };
}
export async function runExceptionScan(
  db: WorkspaceDatabase,
  actorId: string | null,
) {
  const [dataset, settings] = await Promise.all([
    loadDataset(db),
    loadSettings(db),
  ]);
  const results = computeResults(dataset, settings);
  const exceptions = results.filter(
    (r) => !['successful', 'pending'].includes(r.status),
  );
  if (exceptions.length) {
    const { error } = await db.from('workspace_cases').upsert(
      exceptions.map((r) => ({
        transaction_id: r.transactionId,
        status: 'todo',
        updated_by: actorId,
      })),
      { onConflict: 'transaction_id', ignoreDuplicates: true },
    );
    databaseCheck(error);
  }
  const { data, error } = await db
    .from('workspace_scans')
    .insert({
      actor_id: actorId,
      transaction_count: results.length,
      exception_count: exceptions.length,
      counts: statusCounts(results),
    })
    .select()
    .single();
  databaseCheck(error);
  if (settings.alerts_enabled) {
    const alerts = exceptions
      .filter((r) => r.status === 'delayed')
      .filter((r) => {
        const start =
          r.stage === 'bank'
            ? r.timeline.find((t) => t.label === 'Settlement processed')
                ?.timestamp
            : r.stage === 'ledger'
              ? r.timeline.find((t) => t.stage === 'bank')?.timestamp
              : r.transactionTimestamp;
        return (
          start &&
          (Date.now() - Date.parse(start)) / 60000 >=
            settings.alert_after_minutes
        );
      });
    if (alerts.length) {
      const queued = await db.from('workspace_alerts').upsert(
        alerts.map((r) => ({
          transaction_id: r.transactionId,
          fingerprint: `${r.transactionId}:${r.stage}:${r.rootCause}`,
          payload: {
            transactionId: r.transactionId,
            stage: r.stage,
            rootCause: r.rootCause,
            status: r.status,
          },
        })),
        { onConflict: 'fingerprint', ignoreDuplicates: true },
      );
      databaseCheck(queued.error);
    }
  }
  await audit(db, actorId, 'exception_scan', null, {
    transactions: results.length,
    exceptions: exceptions.length,
  });
  return data;
}

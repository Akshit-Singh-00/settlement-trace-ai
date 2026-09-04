import { z } from 'zod';
import {
  authContext,
  checkOrigin,
  consumeLimit,
  googleAuthEnabled,
  readJson,
  requireMember,
  workspaceConfigured,
  WorkspaceError,
} from '@/lib/server/workspace-auth';
import {
  audit,
  computeResults,
  databaseCheck,
  loadDataset,
  loadSettings,
  runExceptionScan,
  statusCounts,
  summary,
} from '@/lib/server/workspace-data';
import {
  bulkCaseSchema,
  caseSchema,
  importSchema,
  memberSchema,
  memberUpdateSchema,
  noteSchema,
  profileSchema,
  settingsSchema,
  traceSchema,
} from '@/lib/workspace-validation';
import { parseSyntheticCsv, CsvValidationError } from '@/lib/csv-import';
import { generateGroundedExplanation } from '@/lib/ai-explanation';
import { reconcileTransaction } from '@/lib/reconciliation';
import type { WorkspacePermission, WorkspaceCase } from '@/lib/workspace-types';
import { importStripeSandbox } from '@/lib/server/stripe-connector';
import { extractDocument } from '@/lib/server/document-extraction';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
function permission(path: string, method: string): WorkspacePermission {
  if (path.startsWith('admin')) return 'admin';
  if (path === 'trace') return 'trace';
  if (path === 'imports' || path === 'stripe') return 'import';
  if (path === 'extract') return 'extract';
  if (path === 'scan') return 'scan';
  if (path.startsWith('report')) return 'report';
  if ((path.startsWith('case/') || path === 'cases/bulk') && method !== 'GET')
    return 'comment';
  return 'read';
}
async function handle(request: Request, context: Context) {
  let auth: ReturnType<typeof authContext> | undefined;
  const json = (value: unknown, status = 200) =>
    Response.json(value, {
      status,
      headers: auth?.headers ?? {
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie',
      },
    });
  try {
    const segments = (await context.params).path;
    const path = segments.join('/');
    const method = request.method;
    if (path === 'session' && method === 'GET' && !workspaceConfigured())
      return json({ configured: false, member: null });
    if (path === 'session' && method === 'GET' && !(await googleAuthEnabled()))
      return json({ configured: true, authReady: false, member: null });
    auth = authContext(request);
    if (method !== 'GET') checkOrigin(request);
    if (path === 'logout' && method === 'POST') {
      await auth.client.auth.signOut();
      return json({ ok: true });
    }
    if (path === 'session' && method === 'GET') {
      try {
        const { member } = await requireMember(auth);
        return json({ configured: true, authReady: true, member });
      } catch (error) {
        if (error instanceof WorkspaceError && error.status === 401)
          return json({ configured: true, authReady: true, member: null });
        throw error;
      }
    }
    const { db, member } = await requireMember(auth, permission(path, method));
    if (method !== 'GET') await consumeLimit(db, `write:${member.id}`);
    if (path === 'profile' && method === 'PATCH') {
      const input = profileSchema.parse(await readJson(request, 5000));
      const { data, error } = await db
        .from('workspace_members')
        .update(input)
        .eq('id', member.id)
        .select('*')
        .single();
      databaseCheck(error);
      await audit(db, member.id, 'profile_updated');
      return json({ member: data });
    }
    if (path === 'overview' && method === 'GET') {
      const [dataset, settings, caseResponse, scanResponse, people] =
        await Promise.all([
          loadDataset(db),
          loadSettings(db),
          db.from('workspace_cases').select('*').limit(10000),
          db
            .from('workspace_scans')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          db
            .from('workspace_members')
            .select('id,display_name,email,role')
            .eq('active', true)
            .limit(1000),
        ]);
      databaseCheck(caseResponse.error);
      databaseCheck(scanResponse.error);
      databaseCheck(people.error);
      const results = computeResults(dataset, settings);
      return json({
        counts: statusCounts(results),
        transactions: results.map((r) =>
          summary(r, caseResponse.data as WorkspaceCase[]),
        ),
        settings,
        lastScan: scanResponse.data,
        members: people.data,
      });
    }
    if (
      (path === 'trace' && method === 'POST') ||
      ((segments[0] === 'result' || segments[0] === 'report') &&
        method === 'GET')
    ) {
      const id =
        path === 'trace'
          ? traceSchema.parse(await readJson(request, 5000)).transactionId
          : traceSchema.parse({ transactionId: segments[1] }).transactionId;
      const [dataset, settings] = await Promise.all([
        loadDataset(db),
        loadSettings(db),
      ]);
      if (
        ![
          ...dataset.gateway,
          ...dataset.settlements,
          ...dataset.bank,
          ...dataset.ledger,
        ].some((r) => r.transactionId === id.toUpperCase())
      )
        throw new WorkspaceError(
          404,
          'No imported records match this transaction.',
        );
      const result = reconcileTransaction(id, dataset, new Date(), {
        bankMinutes: settings.bank_sla_minutes,
        ledgerMinutes: settings.ledger_sla_minutes,
        gatewayMinutes: settings.gateway_sla_minutes,
      });
      if (path === 'trace') {
        const { error } = await db.rpc('workspace_record_trace', {
          p_actor: member.id,
          p_transaction: result.transactionId,
        });
        databaseCheck(error);
      }
      if (segments[0] === 'report') {
        await audit(db, member.id, 'report_exported', result.transactionId);
        auth.headers.set(
          'Content-Disposition',
          `attachment; filename="${result.transactionId}-report.json"`,
        );
      }
      const explanation = await generateGroundedExplanation(
        result,
        path === 'trace'
          ? {
              apiKey: process.env.GEMINI_API_KEY,
              model: process.env.GEMINI_MODEL,
            }
          : {},
      );
      return json({
        result,
        explanation,
        generatedAt: new Date().toISOString(),
      });
    }
    if (path === 'imports' && method === 'POST') {
      const { source, csv } = importSchema.parse(await readJson(request));
      const records = parseSyntheticCsv(source, csv);
      if (records.length > 1000)
        throw new WorkspaceError(422, 'Import up to 1,000 rows per file.');
      const { data, error } = await db.rpc('workspace_import', {
        p_actor: member.id,
        p_source: source,
        p_records: records,
        p_provenance: 'csv',
      });
      databaseCheck(error);
      return json({ count: data });
    }
    if (path === 'scan' && method === 'POST') {
      await consumeLimit(db, `scan:${member.id}`, 2, 300);
      return json({ scan: await runExceptionScan(db, member.id) });
    }
    if (path === 'stripe' && method === 'POST') {
      await consumeLimit(db, `stripe:${member.id}`, 2, 300);
      return json(await importStripeSandbox(db, member.id));
    }
    if (path === 'extract' && method === 'POST') {
      await consumeLimit(db, `extract:${member.id}`, 5, 60);
      const extracted = await extractDocument(
        await readJson(request, 3_000_000),
      );
      await audit(db, member.id, 'document_extracted');
      return json(extracted);
    }
    if (segments[0] === 'case' && segments.length >= 2) {
      const transactionId = traceSchema
        .parse({ transactionId: segments[1] })
        .transactionId.toUpperCase();
      const existing = await db
        .from('workspace_records')
        .select('id')
        .eq('transaction_id', transactionId)
        .limit(1);
      databaseCheck(existing.error);
      if (!existing.data?.length)
        throw new WorkspaceError(404, 'Transaction not found.');
      if (method === 'GET') {
        const [current, notes] = await Promise.all([
          db
            .from('workspace_cases')
            .select('*')
            .eq('transaction_id', transactionId)
            .maybeSingle(),
          db
            .from('workspace_notes')
            .select('*')
            .eq('transaction_id', transactionId)
            .order('created_at')
            .limit(200),
        ]);
        databaseCheck(current.error);
        databaseCheck(notes.error);
        return json({ case: current.data, notes: notes.data });
      }
      if (segments[2] === 'notes' && method === 'POST') {
        const input = noteSchema.parse(await readJson(request, 7000));
        const { data, error } = await db
          .from('workspace_notes')
          .insert({
            ...input,
            transaction_id: transactionId,
            author_id: member.id,
          })
          .select()
          .single();
        databaseCheck(error);
        await audit(db, member.id, 'note_added', transactionId);
        return json({ note: data });
      }
      if (segments.length === 2 && method === 'PATCH') {
        const input = caseSchema.parse(await readJson(request, 5000));
        if (input.assignee_id) {
          const target = await db
            .from('workspace_members')
            .select('id')
            .eq('id', input.assignee_id)
            .eq('active', true)
            .in('role', ['investigator', 'admin'])
            .maybeSingle();
          databaseCheck(target.error);
          if (!target.data)
            throw new WorkspaceError(
              422,
              'Assign an active investigator or admin.',
            );
        }
        const { error } = await db.from('workspace_cases').upsert({
          ...input,
          transaction_id: transactionId,
          updated_by: member.id,
          updated_at: new Date().toISOString(),
        });
        databaseCheck(error);
        await audit(db, member.id, 'case_updated', transactionId, input);
        return json({ ok: true });
      }
    }
    if (path === 'cases/bulk' && method === 'PATCH') {
      const { transactionIds, status } = bulkCaseSchema.parse(
        await readJson(request, 20000),
      );
      const ids = [...new Set(transactionIds.map((id) => id.toUpperCase()))];
      const existing = await db
        .from('workspace_records')
        .select('transaction_id')
        .in('transaction_id', ids);
      databaseCheck(existing.error);
      if (
        ids.some((id) => !existing.data?.some((r) => r.transaction_id === id))
      )
        throw new WorkspaceError(
          404,
          'One or more transactions no longer exist.',
        );
      const { error } = await db.from('workspace_cases').upsert(
        ids.map((id) => ({
          transaction_id: id,
          status,
          updated_by: member.id,
          updated_at: new Date().toISOString(),
        })),
      );
      databaseCheck(error);
      await audit(db, member.id, 'bulk_case_status', null, {
        transactionIds: ids,
        status,
      });
      return json({ count: ids.length });
    }
    if (path === 'admin' && method === 'GET') {
      const url = new URL(request.url);
      const page = Math.floor(
        Math.max(0, Math.min(10000, Number(url.searchParams.get('page')) || 0)),
      );
      const search = (url.searchParams.get('search') || '')
        .replace(/[^a-zA-Z0-9 _-]/g, '')
        .slice(0, 100);
      let logQuery = db.from('workspace_audit').select('*', { count: 'exact' });
      if (search)
        logQuery = logQuery.or(
          `action.ilike.*${search}*,transaction_id.ilike.*${search}*`,
        );
      const [members, logs, settings] = await Promise.all([
        db
          .from('workspace_members')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1000),
        logQuery
          .order('created_at', { ascending: false })
          .range(page * 25, page * 25 + 24),
        loadSettings(db),
      ]);
      databaseCheck(members.error);
      databaseCheck(logs.error);
      return json({
        members: members.data,
        logs: logs.data,
        auditCount: logs.count,
        settings,
        connections: {
          stripe: Boolean(
            process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_'),
          ),
          documents: Boolean(process.env.GEMINI_API_KEY),
          alerts: Boolean(process.env.ALERT_WEBHOOK_URL),
          scheduled: Boolean(process.env.CRON_SECRET),
        },
      });
    }
    if (path === 'admin/members' && method === 'POST') {
      const input = memberSchema.parse(await readJson(request, 5000));
      const { error } = await db.from('workspace_members').insert(input);
      if (error?.code === '23505')
        throw new WorkspaceError(409, 'This email is already invited.');
      databaseCheck(error);
      await audit(db, member.id, 'member_invited', null, input);
      return json({ ok: true });
    }
    if (
      segments[0] === 'admin' &&
      segments[1] === 'members' &&
      segments[2] &&
      method === 'PATCH'
    ) {
      const id = z.uuid().parse(segments[2]);
      const input = memberUpdateSchema.parse(await readJson(request, 5000));
      const { error } = await db.rpc('workspace_update_member', {
        p_actor: member.id,
        p_member: id,
        p_role: input.role,
        p_active: input.active,
      });
      if (error)
        throw new WorkspaceError(
          409,
          'The role could not be changed. Keep your own account and at least one Admin active.',
        );
      return json({ ok: true });
    }
    if (path === 'admin/settings' && method === 'PATCH') {
      const input = settingsSchema.parse(await readJson(request, 5000));
      const { error } = await db
        .from('workspace_settings')
        .upsert({ id: 1, ...input });
      databaseCheck(error);
      await audit(db, member.id, 'settings_updated', null, input);
      return json({ settings: input });
    }
    throw new WorkspaceError(404, 'Workspace endpoint not found.');
  } catch (error) {
    if (error instanceof z.ZodError)
      return json(
        { error: error.issues[0]?.message ?? 'Check the submitted values.' },
        422,
      );
    if (error instanceof CsvValidationError)
      return json(
        {
          error: 'Fix the CSV validation errors.',
          issues: error.issues.slice(0, 12),
        },
        422,
      );
    if (error instanceof WorkspaceError)
      return json({ error: error.message }, error.status);
    return json(
      { error: 'The workspace could not complete this request. Please retry.' },
      500,
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;

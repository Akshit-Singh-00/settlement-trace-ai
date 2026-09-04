import {
  consumeLimit,
  serviceDatabase,
  workspaceConfigured,
} from '@/lib/server/workspace-auth';
import {
  audit,
  databaseCheck,
  loadSettings,
  runExceptionScan,
} from '@/lib/server/workspace-data';
import { importStripeSandbox } from '@/lib/server/stripe-connector';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  )
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!workspaceConfigured())
    return Response.json(
      { error: 'Workspace is not connected' },
      { status: 503 },
    );
  try {
    const db = serviceDatabase();
    await consumeLimit(db, 'daily-job', 1, 1800);
    let stripeSyncFailed = false;
    if (process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
      try {
        await importStripeSandbox(db, null);
      } catch {
        stripeSyncFailed = true;
        await audit(db, null, 'stripe_sync_failed');
      }
    }
    const scan = await runExceptionScan(db, null);
    let delivered = 0;
    const settings = await loadSettings(db);
    if (settings.alerts_enabled && process.env.ALERT_WEBHOOK_URL) {
      const target = new URL(process.env.ALERT_WEBHOOK_URL);
      // Destination is operator-owned server configuration, never a request URL.
      if (
        target.protocol !== 'https:' ||
        target.username ||
        target.password ||
        target.hostname === 'localhost' ||
        /^\d+\.\d+\.\d+\.\d+$/.test(target.hostname) ||
        target.hostname.includes(':') ||
        target.hostname.endsWith('.local')
      )
        throw new Error('Invalid webhook destination');
      const queue = await db.rpc('workspace_claim_alerts');
      databaseCheck(queue.error);
      for (const alert of queue.data ?? []) {
        const response = await fetch(target, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': alert.fingerprint,
          },
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
          body: JSON.stringify({
            text: `Settlement Trace AI: ${alert.transaction_id} requires review. ${alert.payload.rootCause}`,
            event: 'settlement.sla_breach',
            ...alert.payload,
          }),
        });
        if (response.ok) {
          const saved = await db
            .from('workspace_alerts')
            .update({
              delivered_at: new Date().toISOString(),
              claimed_until: null,
            })
            .eq('id', alert.id);
          databaseCheck(saved.error);
          delivered++;
        }
      }
    }
    return Response.json(
      { scanId: scan.id, delivered, stripeSyncFailed },
      {
        status: stripeSyncFailed ? 503 : 200,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch {
    return Response.json(
      {
        error:
          'Daily scan or alert delivery failed. Check the job logs and connection.',
      },
      { status: 503 },
    );
  }
}

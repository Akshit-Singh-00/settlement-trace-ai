import { z } from 'zod';
import type { GatewayRecord } from '@/lib/settlement-types';
import { WorkspaceError } from './workspace-auth';
import {
  databaseCheck,
  loadSettings,
  type WorkspaceDatabase,
} from './workspace-data';

const eventSchema = z.object({
  id: z.string(),
  type: z.enum(['charge.succeeded', 'charge.captured']),
  created: z.number().int().positive(),
  livemode: z.literal(false),
  data: z.object({
    object: z.object({
      id: z.string(),
      object: z.literal('charge'),
      captured: z.boolean(),
      paid: z.boolean(),
      amount_captured: z.number().int().nonnegative(),
      currency: z.string(),
      metadata: z.record(z.string(), z.string()).default({}),
    }),
  }),
});
const supportedCurrencies = new Set([
  'inr',
  'usd',
  'eur',
  'gbp',
  'cad',
  'aud',
  'sgd',
  'nzd',
  'aed',
  'chf',
]);
export function stripeEventToGateway(
  value: unknown,
  slaMinutes: number,
): GatewayRecord | null {
  const parsed = eventSchema.safeParse(value);
  if (!parsed.success) return null;
  const event = parsed.data;
  const charge = event.data.object;
  if (
    !charge.captured ||
    !charge.paid ||
    charge.amount_captured <= 0 ||
    !supportedCurrencies.has(charge.currency)
  )
    return null;
  const explicit = charge.metadata.transaction_id?.toUpperCase();
  return {
    transactionId:
      explicit && /^TXN-[A-Z0-9-]{3,}$/.test(explicit)
        ? explicit
        : `TXN-STRIPE-${charge.id.replaceAll('_', '-').toUpperCase()}`,
    merchantId: charge.metadata.merchant_id || 'STRIPE-SANDBOX',
    merchantName: charge.metadata.merchant_name || 'Stripe sandbox account',
    amount: charge.amount_captured,
    currency: charge.currency.toUpperCase(),
    status: 'captured',
    gatewayReference: charge.id,
    capturedAt: new Date(event.created * 1000).toISOString(),
    expectedSettlementMinutes: slaMinutes,
  };
}
export async function importStripeSandbox(
  db: WorkspaceDatabase,
  actorId: string | null,
  fetcher: typeof fetch = fetch,
) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith('sk_test_'))
    throw new WorkspaceError(
      503,
      'Add a Stripe sandbox secret key to enable this connector. Live keys are not accepted.',
    );
  const settings = await loadSettings(db);
  const records = new Map<string, GatewayRecord>();
  let cursor = '';
  let hasMore = false;
  let skipped = 0;
  for (let page = 0; page < 10; page++) {
    const url = new URL('https://api.stripe.com/v1/events');
    url.searchParams.set('limit', '100');
    url.searchParams.append('types[]', 'charge.succeeded');
    url.searchParams.append('types[]', 'charge.captured');
    if (cursor) url.searchParams.set('starting_after', cursor);
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    if (!response.ok)
      throw new WorkspaceError(
        502,
        'Stripe could not return sandbox events. Check the connection and retry.',
      );
    const payload = z
      .object({ data: z.array(z.unknown()), has_more: z.boolean() })
      .parse(await response.json());
    hasMore = payload.has_more;
    for (const raw of payload.data) {
      const record = stripeEventToGateway(raw, settings.gateway_sla_minutes);
      if (!record) {
        skipped++;
        continue;
      }
      // Stripe events are newest first. Repeated charge events use one stable key.
      if (!records.has(record.gatewayReference))
        records.set(record.gatewayReference, record);
    }
    if (!hasMore || !payload.data.length) break;
    cursor = z.object({ id: z.string() }).parse(payload.data.at(-1)).id;
  }
  if (hasMore)
    throw new WorkspaceError(
      422,
      'More than 1,000 events need ingestion. Use a bounded CSV export; no partial sync was saved.',
    );
  if (!records.size)
    return {
      count: 0,
      skipped,
      message:
        'No eligible captured sandbox charges were found in Stripe’s 30-day event window.',
    };
  const imported = await db.rpc('workspace_import', {
    p_actor: actorId,
    p_source: 'gateway',
    p_records: [...records.values()],
    p_provenance: actorId
      ? 'stripe_sandbox_capture_event'
      : 'stripe_sandbox_scheduled',
  });
  databaseCheck(imported.error);
  return {
    count: imported.data,
    skipped,
    message:
      'Gateway evidence imported. Bank, settlement and ledger evidence must be supplied separately.',
  };
}

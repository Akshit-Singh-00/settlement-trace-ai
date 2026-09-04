import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const env = {
  ...parseEnv(readFileSync('.env.local', 'utf8')),
  ...parseEnv(readFileSync('.env.workspace.local', 'utf8')),
  ...process.env,
};
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const actor = randomUUID(),
  viewer = randomUUID(),
  nonce = randomUUID(),
  transactionId = `TXN-VERIFY-${nonce.toUpperCase()}`,
  rateKey = `verify:${nonce}`;
function ok(response) {
  assert.equal(
    response.error,
    null,
    response.error?.code || 'Database operation failed',
  );
  return response.data;
}
try {
  ok(
    await db.from('workspace_members').insert([
      { id: actor, email: `admin-${nonce}@example.invalid`, role: 'admin' },
      { id: viewer, email: `viewer-${nonce}@example.invalid`, role: 'viewer' },
    ]),
  );
  const records = [
    {
      transactionId,
      merchantId: 'VERIFY',
      merchantName: 'Temporary integration check',
      amount: 10000,
      currency: 'INR',
      status: 'captured',
      gatewayReference: `VERIFY-${nonce}`,
      capturedAt: new Date().toISOString(),
      expectedSettlementMinutes: 120,
    },
  ];
  const forbidden = await db.rpc('workspace_import', {
    p_actor: viewer,
    p_source: 'gateway',
    p_records: records,
    p_provenance: 'csv',
  });
  assert.ok(forbidden.error, 'Viewer import must be denied');
  ok(
    await db.rpc('workspace_import', {
      p_actor: actor,
      p_source: 'gateway',
      p_records: records,
      p_provenance: 'csv',
    }),
  );
  ok(
    await db.rpc('workspace_import', {
      p_actor: actor,
      p_source: 'gateway',
      p_records: records,
      p_provenance: 'csv',
    }),
  );
  const stored = ok(
    await db
      .from('workspace_records')
      .select('payload')
      .eq('transaction_id', transactionId),
  );
  assert.equal(stored.length, 1, 'Repeated imports must be idempotent');
  assert.equal(stored[0].payload.amount, 10000);
  ok(
    await db
      .from('workspace_cases')
      .insert({
        transaction_id: transactionId,
        status: 'in_progress',
        assignee_id: actor,
        updated_by: actor,
      }),
  );
  ok(
    await db
      .from('workspace_cases')
      .upsert({
        transaction_id: transactionId,
        status: 'resolved',
        updated_by: actor,
        updated_at: new Date().toISOString(),
      }),
  );
  const current = ok(
    await db
      .from('workspace_cases')
      .select('*')
      .eq('transaction_id', transactionId)
      .single(),
  );
  assert.equal(
    current.assignee_id,
    actor,
    'Bulk status updates must preserve assignment',
  );
  ok(
    await db
      .from('workspace_cases')
      .upsert(
        { transaction_id: transactionId, status: 'todo' },
        { onConflict: 'transaction_id', ignoreDuplicates: true },
      ),
  );
  assert.equal(
    ok(
      await db
        .from('workspace_cases')
        .select('status')
        .eq('transaction_id', transactionId)
        .single(),
    ).status,
    'resolved',
    'Scans must preserve resolved cases',
  );
  assert.ok(
    (
      await db.rpc('workspace_update_member', {
        p_actor: viewer,
        p_member: actor,
        p_role: 'viewer',
        p_active: false,
      })
    ).error,
    'Viewer cannot change members',
  );
  assert.ok(
    (
      await db.rpc('workspace_update_member', {
        p_actor: actor,
        p_member: actor,
        p_role: 'viewer',
        p_active: true,
      })
    ).error,
    'Admin cannot remove their own access',
  );
  ok(
    await db.rpc('workspace_record_trace', {
      p_actor: actor,
      p_transaction: transactionId,
    }),
  );
  assert.equal(
    ok(
      await db
        .from('workspace_members')
        .select('trace_count')
        .eq('id', actor)
        .single(),
    ).trace_count,
    1,
  );
  assert.equal(
    ok(
      await db.rpc('workspace_consume_limit', {
        p_key: rateKey,
        p_limit: 1,
        p_seconds: 60,
      }),
    ),
    true,
  );
  assert.equal(
    ok(
      await db.rpc('workspace_consume_limit', {
        p_key: rateKey,
        p_limit: 1,
        p_seconds: 60,
      }),
    ),
    false,
  );
  console.log(
    'PASS: role checks, durable/idempotent imports, preserved assignments and case statuses, trace count, rate limit.',
  );
} finally {
  // Delete only this run's generated fixtures. Never select existing workspace data.
  for (const table of [
    'workspace_records',
    'workspace_cases',
    'workspace_notes',
  ])
    ok(await db.from(table).delete().eq('transaction_id', transactionId));
  ok(await db.from('workspace_audit').delete().in('actor_id', [actor, viewer]));
  ok(await db.from('workspace_members').delete().in('id', [actor, viewer]));
  ok(await db.from('workspace_rate_limits').delete().eq('key', rateKey));
  console.log('Temporary integration fixtures removed.');
}

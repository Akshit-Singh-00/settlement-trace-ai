import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';

// Deliberately print only connection status and table names, never credentials or rows.
const env = {
  ...parseEnv(readFileSync('.env.local', 'utf8')),
  ...parseEnv(readFileSync('.env.workspace.local', 'utf8')),
  ...process.env,
};
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error('Missing local Supabase configuration.');
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
for (const table of [
  'workspace_members',
  'workspace_settings',
  'workspace_records',
  'workspace_cases',
  'workspace_notes',
  'workspace_audit',
  'workspace_scans',
  'workspace_alerts',
  'workspace_rate_limits',
]) {
  const { error } = await db.from(table).select('*').limit(1);
  if (error) {
    console.error(
      `${table}: unavailable (${error.code || 'connection error'})`,
    );
    process.exitCode = 1;
  } else console.log(`${table}: accessible to the server`);
}
if (env.SUPABASE_PUBLISHABLE_KEY) {
  const publicDb = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false } },
  );
  const { error } = await publicDb
    .from('workspace_members')
    .select('id')
    .limit(1);
  if (!error || error.code !== '42501') {
    console.error(
      `Public credential access restriction could not be verified (${error?.code || 'query succeeded'}).`,
    );
    process.exitCode = 1;
  } else console.log('Public credential: workspace reads denied');
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY },
  });
  if (response.ok) {
    const settings = await response.json();
    console.log(
      `Google provider: ${settings.external?.google ? 'enabled' : 'not enabled'}`,
    );
  }
}
const verification = await db.rpc('workspace_consume_limit', {
  p_key: 'connection-verification',
  p_limit: 100,
  p_seconds: 60,
});
console.log(
  `Database RPC: ${verification.error ? `unavailable (${verification.error.code})` : 'available'}`,
);
if (verification.error) process.exitCode = 1;

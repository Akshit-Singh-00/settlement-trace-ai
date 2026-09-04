import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import {
  canAccess,
  type WorkspaceMember,
  type WorkspacePermission,
} from '@/lib/workspace-types';

export class WorkspaceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function workspaceConfigured() {
  return Boolean(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.APP_URL &&
    process.env.WORKSPACE_ADMIN_EMAIL,
  );
}
export function appOrigin() {
  return new URL(process.env.APP_URL || 'http://localhost:4173').origin;
}
let providerCache:
  | { url: string; ready: boolean; expiresAt: number }
  | undefined;
export async function googleAuthEnabled() {
  const url = process.env.SUPABASE_URL!;
  if (providerCache?.url === url && providerCache.expiresAt > Date.now())
    return providerCache.ready;
  const response = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY! },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new WorkspaceError(
      503,
      'Google sign-in availability could not be checked. Please retry.',
    );
  const settings = (await response.json()) as {
    external?: { google?: boolean };
  };
  const ready = settings.external?.google === true;
  providerCache = { url, ready, expiresAt: Date.now() + 60000 };
  return ready;
}
export function serviceDatabase() {
  if (!workspaceConfigured())
    throw new WorkspaceError(
      503,
      'The team workspace is awaiting its Supabase connection.',
    );
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (url, options) =>
          fetch(url, {
            ...options,
            signal: AbortSignal.timeout(15000),
            cache: 'no-store',
          }),
      },
    },
  );
}
export function authContext(request: Request) {
  const headers = new Headers({
    'Cache-Control': 'private, no-store, max-age=0',
    Vary: 'Cookie',
  });
  if (!workspaceConfigured())
    throw new WorkspaceError(
      503,
      'The team workspace is awaiting its Supabase connection.',
    );
  const client = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () =>
          parseCookieHeader(request.headers.get('cookie') ?? '').filter(
            (c): c is { name: string; value: string } => c.value !== undefined,
          ),
        setAll: (cookies) => {
          for (const { name, value, options } of cookies)
            headers.append(
              'Set-Cookie',
              serializeCookieHeader(name, value, {
                ...options,
                httpOnly: true,
                secure: appOrigin().startsWith('https:'),
                sameSite: 'lax',
                path: '/',
              }),
            );
        },
      },
    },
  );
  return { client, headers };
}
export function checkOrigin(request: Request) {
  if (request.headers.get('origin') !== appOrigin())
    throw new WorkspaceError(
      403,
      'This request must come from the workspace website.',
    );
}
export async function requireMember(
  context: ReturnType<typeof authContext>,
  permission: WorkspacePermission = 'read',
) {
  const {
    data: { user },
    error,
  } = await context.client.auth.getUser();
  if (error || !user)
    throw new WorkspaceError(401, 'Sign in with Google to continue.');
  if (
    !user.email_confirmed_at ||
    !user.identities?.some((i) => i.provider === 'google')
  )
    throw new WorkspaceError(403, 'A verified Google account is required.');
  const db = serviceDatabase();
  const { data, error: memberError } = await db
    .from('workspace_members')
    .select('*')
    .eq('auth_user_id', user.id)
    .eq('active', true)
    .maybeSingle();
  if (memberError)
    throw new WorkspaceError(503, 'The workspace database is not ready.');
  if (!data)
    throw new WorkspaceError(
      403,
      'Ask your Admin to invite this Google email.',
    );
  const member = data as WorkspaceMember;
  if (!canAccess(member.role, permission))
    throw new WorkspaceError(403, 'Your role does not allow this action.');
  return { db, member, user };
}
export async function consumeLimit(
  db: ReturnType<typeof serviceDatabase>,
  key: string,
  limit = 30,
  seconds = 60,
) {
  const { data, error } = await db.rpc('workspace_consume_limit', {
    p_key: key,
    p_limit: limit,
    p_seconds: seconds,
  });
  if (error)
    throw new WorkspaceError(
      503,
      'Unable to verify the request limit. Please retry.',
    );
  if (!data)
    throw new WorkspaceError(
      429,
      'Too many requests. Please wait a minute and retry.',
    );
}
export async function readJson(request: Request, limit = 1_100_000) {
  const reader = request.body?.getReader();
  if (!reader)
    throw new WorkspaceError(400, 'A JSON request body is required.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new WorkspaceError(413, 'The upload is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new WorkspaceError(400, 'Invalid JSON request.');
  }
}

import {
  appOrigin,
  authContext,
  googleAuthEnabled,
  workspaceConfigured,
} from '@/lib/server/workspace-auth';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!workspaceConfigured())
    return Response.redirect(`${appOrigin()}/login?error=setup`, 303);
  try {
    if (!(await googleAuthEnabled()))
      return Response.redirect(`${appOrigin()}/login?error=setup`, 303);
  } catch {
    return Response.redirect(`${appOrigin()}/login?error=provider`, 303);
  }
  const context = authContext(request);
  const { data, error } = await context.client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${appOrigin()}/auth/callback`,
      scopes: 'openid email profile',
      skipBrowserRedirect: true,
    },
  });
  context.headers.set(
    'Location',
    error || !data.url ? `${appOrigin()}/login?error=provider` : data.url,
  );
  return new Response(null, { status: 303, headers: context.headers });
}

import {
  appOrigin,
  authContext,
  serviceDatabase,
  workspaceConfigured,
} from '@/lib/server/workspace-auth';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!workspaceConfigured())
    return Response.redirect(`${appOrigin()}/login?error=setup`, 303);
  const context = authContext(request);
  try {
    const code = new URL(request.url).searchParams.get('code');
    if (!code) throw new Error('No code');
    const { data, error } =
      await context.client.auth.exchangeCodeForSession(code);
    if (
      error ||
      !data.user?.email ||
      !data.user.email_confirmed_at ||
      !data.user.identities?.some((i) => i.provider === 'google')
    )
      throw new Error('Invalid identity');
    const user = data.user;
    const { error: accessError } = await serviceDatabase().rpc(
      'workspace_login',
      {
        p_user: user.id,
        p_email: user.email!.toLowerCase(),
        p_name: user.user_metadata.full_name || user.email,
        p_avatar: user.user_metadata.avatar_url || '',
        p_bootstrap:
          user.email!.toLowerCase() ===
          process.env.WORKSPACE_ADMIN_EMAIL?.toLowerCase(),
      },
    );
    if (accessError) throw new Error('Access denied');
    context.headers.set('Location', `${appOrigin()}/workspace`);
  } catch {
    await context.client.auth.signOut();
    context.headers.set('Location', `${appOrigin()}/login?error=access`);
  }
  return new Response(null, { status: 303, headers: context.headers });
}

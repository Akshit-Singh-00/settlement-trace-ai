'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Fingerprint, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-provider';
import { workspaceApi } from '@/lib/workspace-client';

export function WorkspaceLogin() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error');
    const frame = requestAnimationFrame(() => {
      if (code)
        setError(
          code === 'access'
            ? 'This Google email has not been invited, or its access is disabled. Ask your Admin to check your membership.'
            : 'Google sign-in could not finish. Please retry.',
        );
    });
    void workspaceApi<{
      configured: boolean;
      authReady?: boolean;
      member: unknown;
    }>('session')
      .then((data) => {
        setConfigured(data.configured && data.authReady !== false);
        if (data.member) window.location.replace('/workspace');
      })
      .catch((failure: Error) => {
        setConfigured(false);
        setError(failure.message);
      });
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <main className="ws-login">
      <header>
        <Link className="brand" href="/">
          <span className="brand-mark">
            <Sparkles size={18} />
          </span>
          Settlement Trace <b>AI</b>
        </Link>
        <ThemeToggle />
      </header>
      <div className="ws-login-grid">
        <section className="ws-login-story">
          <span className="ws-eyebrow">THE OPERATIONS WORKSPACE</span>
          <h1>
            Every settlement.
            <br />
            <em>A shared trail.</em>
          </h1>
          <p>
            Bring your evidence, investigators, and decisions together. Follow a
            payment from capture to the merchant ledger with a record of every
            action.
          </p>
          <div className="ws-flow">
            Gateway <ArrowRight /> Settlement <ArrowRight /> Bank <ArrowRight />{' '}
            Ledger
          </div>
          <div className="ws-login-facts">
            <span>
              <ShieldCheck /> Access by role
            </span>
            <span>
              <Fingerprint /> Evidence you can inspect
            </span>
          </div>
        </section>
        <section className="ws-panel ws-signin">
          <span className="brand-mark">
            <Fingerprint />
          </span>
          <h2>Welcome to your workspace</h2>
          <p>Sign in with your invited Google account.</p>
          {error && (
            <p className="ws-error" role="alert">
              {error}
            </p>
          )}
          {configured === false ? (
            <div className="ws-notice">
              <strong>Workspace setup is in progress</strong>
              <p>
                Your Admin is connecting the workspace. You can explore the
                public demo while setup finishes.
              </p>
            </div>
          ) : (
            <Button
              size="lg"
              disabled={configured === null}
              onClick={() => window.location.assign('/auth/google')}
            >
              {configured === null
                ? 'Checking workspace…'
                : 'Continue with Google'}
              <ArrowRight />
            </Button>
          )}
          <small>
            Access is limited to invited members. Contact your Admin if you need
            an invitation.
          </small>
          <nav className="ws-policy-links" aria-label="Site information">
            <Link href="/privacy">Privacy policy</Link>
            <Link href="/terms">Terms of use</Link>
          </nav>
          <Link href="/">
            Explore the public demo <ArrowRight size={14} />
          </Link>
        </section>
      </div>
    </main>
  );
}

import Link from 'next/link';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-provider';
import type { ReactNode } from 'react';

export function PolicyPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <main className="ws-policy">
      <header>
        <Link className="brand" href="/">
          <span className="brand-mark">
            <Sparkles size={18} />
          </span>
          Settlement Trace <b>AI</b>
        </Link>
        <ThemeToggle />
      </header>
      <article>
        <Link className="ws-policy-back" href="/login">
          <ArrowLeft size={16} /> Workspace sign-in
        </Link>
        <span className="ws-eyebrow">SETTLEMENT TRACE AI</span>
        <h1>{title}</h1>
        <p className="ws-policy-intro">{intro}</p>
        <small>Updated 5 September 2026</small>
        {children}
        <section>
          <h2>Contact the project team</h2>
          <p>
            For access, privacy questions, or a request to remove your workspace
            data, contact the project administrator at{' '}
            <a href="mailto:khush227799@gmail.com">khush227799@gmail.com</a>.
            Include enough information to identify your account or records; do
            not send passwords, API keys, or payment-card details.
          </p>
        </section>
      </article>
      <nav className="ws-policy-links" aria-label="Site information">
        <Link href="/">Public demo</Link>
        <Link href="/privacy">Privacy policy</Link>
        <Link href="/terms">Terms of use</Link>
      </nav>
    </main>
  );
}

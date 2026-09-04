'use client';

import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Banknote,
  CheckCircle2,
  CircleAlert,
  Database,
  Fingerprint,
  Landmark,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buildSandboxData, demoCases } from '@/lib/sandbox-data';
import { extractTransactionId, reconcileTransaction } from '@/lib/reconciliation';
import type { InvestigationResult, StageStatus } from '@/lib/settlement-types';

const stageIcons = [Fingerprint, Database, Landmark, Banknote];

const statusCopy: Record<InvestigationResult['status'], string> = {
  successful: 'Settled',
  pending: 'Pending',
  delayed: 'Delayed',
  failed: 'Failed',
  mismatch: 'Mismatch',
  uncertain: 'Uncertain',
};

function formatMoney(amount?: number) {
  if (amount === undefined) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(amount / 100);
}

function formatDate(value?: string) {
  if (!value) return 'Unavailable';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function stageTone(status: StageStatus) {
  if (status === 'complete') return 'stage-complete';
  if (status === 'failed' || status === 'missing') return 'stage-failed';
  if (status === 'mismatch' || status === 'delayed') return 'stage-warning';
  return 'stage-current';
}

export function InvestigationShell() {
  const dataset = useMemo(() => buildSandboxData(), []);
  const [query, setQuery] = useState('TXN-1048');
  const [result, setResult] = useState(() =>
    reconcileTransaction('TXN-1048', dataset),
  );

  const investigate = (value = query) => {
    const id = extractTransactionId(value);
    setQuery(id);
    setResult(reconcileTransaction(id, dataset));
    requestAnimationFrame(() =>
      document
        .querySelector('#investigation')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <div className="ambient-grid" aria-hidden="true" />
      <header className="site-header">
        <a href="#top" className="brand" aria-label="Settlement Trace AI home">
          <span className="brand-mark">
            <Sparkles size={18} />
          </span>
          <span>
            Settlement Trace <b>AI</b>
          </span>
        </a>
        <div className="header-meta">
          <span className="live-dot" /> Reconciliation engine online
        </div>
      </header>

      <section id="top" className="hero-shell">
        <div className="hero-copy">
          <div className="eyebrow">
            <ShieldCheck size={15} /> Evidence-grounded settlement intelligence
          </div>
          <h1>
            Follow the money.
            <br />
            <span>Find the break.</span>
          </h1>
          <p className="hero-lead">
            Trace a payment from capture to settlement, bank credit, and merchant
            ledger—then explain the exact failure with auditable evidence.
          </p>
          <form
            className="search-shell"
            onSubmit={(event) => {
              event.preventDefault();
              investigate();
            }}
          >
            <Search size={20} aria-hidden="true" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Transaction ID or support question"
              placeholder="Enter TXN-1048 or ask what happened…"
            />
            <Button type="submit">
              Investigate <ArrowRight size={17} />
            </Button>
          </form>
          <div className="trust-row" aria-label="Product guarantees">
            <span>
              <CheckCircle2 size={14} /> Deterministic
            </span>
            <span>
              <Fingerprint size={14} /> Explainable
            </span>
            <span>
              <Database size={14} /> Evidence-linked
            </span>
          </div>
        </div>

        <div className="hero-visual" aria-label="Settlement pipeline preview">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="pipeline-preview">
            {['Gateway', 'Settlement', 'Bank', 'Ledger'].map((label, index) => {
              const Icon = stageIcons[index];
              return (
                <div className="preview-node" key={label}>
                  <Icon size={22} />
                  <span>{label}</span>
                  {index < 3 && <i />}
                </div>
              );
            })}
          </div>
          <div className="hero-readout">
            <span>TRACE / 1048</span>
            <strong>Break detected at settlement</strong>
            <small>Confidence 96%</small>
          </div>
        </div>
      </section>

      <div className="sandbox-banner">
        <CircleAlert size={17} />
        <strong>Simulated dataset — not live financial data.</strong>
        <span>Every outcome is computed from synthetic source records.</span>
      </div>

      <section id="investigation" className="workspace-shell">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Active investigation</span>
            <h2>{result.transactionId}</h2>
          </div>
          <span className={`status-pill status-${result.status}`}>
            {statusCopy[result.status]}
          </span>
        </div>

        <div className="workspace-grid">
          <article className="result-card">
            <div className="result-head">
              <span>Root-cause assessment</span>
              <strong>{result.confidence}% confidence</strong>
            </div>
            <h3>{result.rootCause}</h3>
            <p>{result.explanation}</p>
            <dl className="detail-grid">
              <div>
                <dt>Merchant</dt>
                <dd>{result.merchant ?? 'Unknown'}</dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>{formatMoney(result.amount)}</dd>
              </div>
              <div>
                <dt>Settlement</dt>
                <dd>{result.settlementId ?? 'Not created'}</dd>
              </div>
              <div>
                <dt>Captured</dt>
                <dd>{formatDate(result.transactionTimestamp)}</dd>
              </div>
            </dl>
            <div className="action-box">
              <span>Recommended next action</span>
              <p>{result.recommendedAction}</p>
            </div>
          </article>

          <aside className="demo-panel">
            <div className="panel-title">
              <span>Demo cases</span>
              <small>{demoCases.length} scenarios</small>
            </div>
            <div className="demo-list">
              {demoCases.slice(0, 6).map((item) => (
                <button
                  key={item.transactionId}
                  onClick={() => investigate(item.transactionId)}
                  className={item.transactionId === result.transactionId ? 'active' : ''}
                >
                  <span>
                    <b>{item.transactionId}</b>
                    <small>{item.label}</small>
                  </span>
                  <ArrowRight size={15} />
                </button>
              ))}
            </div>
          </aside>
        </div>

        <div className="trace-card">
          <div className="panel-title">
            <span>Evidence trace</span>
            <small>One engine · one source of truth</small>
          </div>
          <div className="trace-rail">
            {result.timeline.map((item, index) => {
              const Icon = stageIcons[index];
              return (
                <div className={`trace-stage ${stageTone(item.status)}`} key={item.stage}>
                  <div className="trace-icon">
                    <Icon size={22} />
                  </div>
                  <span className="trace-index">0{index + 1}</span>
                  <h3>{item.label}</h3>
                  <strong>{item.status}</strong>
                  <p>{item.evidence}</p>
                  <small>{item.referenceId ?? 'No reference'}</small>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleAlert,
  Database,
  Download,
  Fingerprint,
  Gauge,
  Layers3,
  Printer,
  Search,
  ShieldCheck,
  Sparkles,
  TimerReset,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CsvUploader } from '@/components/csv-uploader';
import { EvidenceInspector } from '@/components/evidence-inspector';
import { OperationsDashboard } from '@/components/operations-dashboard';
import { PipelineExperience } from '@/components/pipeline-experience';
import { TransactionTimeline } from '@/components/transaction-timeline';
import { buildSandboxData, demoCases } from '@/lib/sandbox-data';
import { extractTransactionId, reconcileTransaction } from '@/lib/reconciliation';
import type { InvestigationResult, PipelineStage, SettlementDataset } from '@/lib/settlement-types';

const statusCopy: Record<InvestigationResult['status'], string> = {
  successful: 'Settled',
  pending: 'Pending',
  delayed: 'Delayed',
  failed: 'Failed',
  mismatch: 'Mismatch',
  uncertain: 'Uncertain',
};

function formatMoney(amount?: number) {
  if (amount === undefined) return 'Unavailable';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount / 100);
}

function formatDate(value?: string) {
  if (!value) return 'Unavailable';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatSla(minutes?: number) {
  if (minutes === undefined) return 'Not applicable';
  if (minutes <= 0) return 'Window elapsed';
  if (minutes < 60) return `${minutes} min remaining`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m remaining`;
}

export function InvestigationShell() {
  const initialDataset = useMemo(() => buildSandboxData(), []);
  const [dataset, setDataset] = useState<SettlementDataset>(initialDataset);
  const [query, setQuery] = useState('TXN-1048');
  const [result, setResult] = useState(() => reconcileTransaction('TXN-1048', initialDataset));
  const [recent, setRecent] = useState<InvestigationResult[]>([]);
  const [selectedStage, setSelectedStage] = useState<PipelineStage>('settlement');
  const reportHref = useMemo(() => {
    const report = { generatedAt: new Date().toISOString(), disclaimer: 'Simulated dataset — not live financial data.', ...result };
    return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(report, null, 2))}`;
  }, [result]);

  const investigate = useCallback((value: string, scroll = true) => {
    const transactionId = extractTransactionId(value);
    const next = reconcileTransaction(transactionId, dataset);
    setQuery(transactionId);
    setResult(next);
    setSelectedStage(next.stage);
    setRecent((current) => [next, ...current.filter((item) => item.transactionId !== next.transactionId)].slice(0, 8));
    if (scroll) {
      requestAnimationFrame(() => document.querySelector('#investigation')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
    return next;
  }, [dataset]);

  useEffect(() => {
    const context = typeof document === 'undefined' ? undefined : document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const reportError = (error: unknown) => console.warn('WebMCP registration failed', error);
    try {
      void Promise.resolve(context.registerTool({
        name: 'investigate_transaction',
        title: 'Investigate transaction',
        description: 'Run the evidence-grounded settlement trace for a synthetic transaction ID and update the visible investigation workspace.',
        inputSchema: {
          type: 'object',
          properties: { transactionId: { type: 'string', pattern: '^TXN-[0-9]{4,}$' } },
          required: ['transactionId'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute(input: unknown) {
          const transactionId = typeof input === 'object' && input !== null && 'transactionId' in input
            ? String((input as { transactionId: unknown }).transactionId).trim().toUpperCase()
            : '';
          if (!/^TXN-\d{4,}$/.test(transactionId)) throw new Error('transactionId must use the format TXN-1048.');
          const next = investigate(transactionId, false);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          return {
            transactionId: next.transactionId,
            status: next.status,
            stage: next.stage,
            rootCause: next.rootCause,
            confidence: next.confidence,
          };
        },
      }, { signal: lifecycle.signal })).catch(reportError);
    } catch (error) {
      reportError(error);
    }
    return () => lifecycle.abort();
  }, [investigate]);

  function replaceDataset(nextDataset: SettlementDataset) {
    setDataset(nextDataset);
    const next = reconcileTransaction(result.transactionId, nextDataset);
    setResult(next);
    setSelectedStage(next.stage);
    setRecent((current) => [next, ...current.filter((item) => item.transactionId !== next.transactionId)].slice(0, 8));
  }

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <div className="ambient-grid" aria-hidden="true" />
      <header className="site-header">
        <a href="#top" className="brand" aria-label="Settlement Trace AI home">
          <span className="brand-mark"><Sparkles size={18} /></span>
          <span>Settlement Trace <b>AI</b></span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#demo-cases">Demo cases</a>
          <a href="#operations">Operations</a>
          <a href="#data-lab">Data lab</a>
        </nav>
        <div className="header-meta"><span className="live-dot" /> Reconciliation engine online</div>
      </header>

      <section id="top" className="hero-shell">
        <div className="hero-copy">
          <div className="eyebrow"><ShieldCheck size={15} /> Evidence-grounded settlement intelligence</div>
          <h1>Follow the money.<br /><span>Find the break.</span></h1>
          <p className="hero-lead">Trace a payment from capture to settlement, bank credit, and merchant ledger—then explain the first failure with auditable evidence.</p>
          <form className="search-shell" onSubmit={(event) => { event.preventDefault(); investigate(query); }}>
            <Search size={20} aria-hidden="true" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Transaction ID or support question" placeholder="Ask: Why is TXN-1048 still pending?" />
            <Button type="submit">Investigate Transaction <ArrowRight size={17} /></Button>
          </form>
          <div className="hero-actions">
            <a href="#demo-cases">View Demo Cases <ArrowDown size={14} /></a>
            <span><Bot size={14} /> Natural-language ID extraction, no LLM required</span>
          </div>
          <div className="trust-row" aria-label="Product guarantees">
            <span><CheckCircle2 size={14} /> Deterministic reconciliation</span>
            <span><Fingerprint size={14} /> Explainable results</span>
            <span><Database size={14} /> Synthetic evidence</span>
            <span><Layers3 size={14} /> One shared result model</span>
          </div>
        </div>

        <div className="hero-visual" aria-label="Interactive 3D settlement pipeline">
          <div className="scene-kicker"><span>Live trace model</span><small>Click a stage to inspect evidence</small></div>
          <PipelineExperience timeline={result.timeline} selectedStage={selectedStage} onStageSelect={setSelectedStage} />
          <div className="hero-readout">
            <span>TRACE / {result.transactionId.replace('TXN-', '')}</span>
            <strong>{result.rootCause}</strong>
            <small>{result.confidence}% confidence · {statusCopy[result.status]}</small>
          </div>
        </div>
      </section>

      <div className="sandbox-banner">
        <CircleAlert size={17} />
        <strong>Simulated dataset — not live financial data.</strong>
        <span>Every finding is computed from synthetic source records.</span>
      </div>

      <section id="investigation" className="workspace-shell" aria-live="polite">
        <div className="section-heading">
          <div><span className="section-kicker">Active investigation</span><h2>{result.transactionId}</h2></div>
          <div className="report-actions">
            <button type="button" onClick={() => window.print()}><Printer size={15} /> Print report</button>
            <a href={reportHref} download={`${result.transactionId}-settlement-trace.json`}><Download size={15} /> Download JSON</a>
            <span className={`status-pill status-${result.status}`}>{statusCopy[result.status]}</span>
          </div>
        </div>

        <div className="workspace-grid">
          <article className="result-card">
            <div className="result-head"><span>Root-cause assessment</span><strong><Gauge size={14} /> {result.confidence}% confidence</strong></div>
            <h3>{result.rootCause}</h3>
            <p>{result.explanation}</p>
            <dl className="detail-grid">
              <div><dt>Merchant</dt><dd>{result.merchant ?? 'Unknown'}</dd></div>
              <div><dt>Amount</dt><dd>{formatMoney(result.amount)}</dd></div>
              <div><dt>Current stage</dt><dd>{result.stage}</dd></div>
              <div><dt>Settlement ID</dt><dd>{result.settlementId ?? 'Not created'}</dd></div>
              <div><dt>Captured</dt><dd>{formatDate(result.transactionTimestamp)}</dd></div>
              <div><dt>Expected by</dt><dd>{formatDate(result.expectedSettlementTime)}</dd></div>
              <div className="sla-detail"><dt>SLA countdown</dt><dd><TimerReset size={14} /> {formatSla(result.slaMinutesRemaining)}</dd></div>
              <div><dt>Evidence sources</dt><dd>{result.evidence.filter((group) => group.records.length).length} of 4 present</dd></div>
            </dl>
            <div className="action-box"><span>Recommended next support action</span><p>{result.recommendedAction}</p></div>
          </article>

          <aside className="demo-panel" id="demo-cases">
            <div className="panel-title"><span>Demo cases</span><small>{demoCases.length} scenarios</small></div>
            <p className="panel-intro">Each outcome is computed at click time—none of these answers is hardcoded.</p>
            <div className="demo-list">
              {demoCases.map((item) => (
                <button key={item.transactionId} type="button" onClick={() => investigate(item.transactionId)} className={item.transactionId === result.transactionId ? 'active' : ''}>
                  <span><b>{item.transactionId}</b><small>{item.label}</small></span>
                  <em data-status={item.category}>{item.category}</em>
                </button>
              ))}
            </div>
          </aside>
        </div>

        <TransactionTimeline timeline={result.timeline} selectedStage={selectedStage} onStageSelect={setSelectedStage} />

        <div className="evidence-grid">
          <EvidenceInspector evidence={result.evidence} exceptions={result.exceptions} selectedStage={selectedStage} onStageSelect={setSelectedStage} />
          <section className="exceptions-card" aria-labelledby="exceptions-title">
            <div className="panel-title"><span id="exceptions-title"><CircleAlert size={15} /> Exceptions &amp; Uncertainty</span><small>{result.exceptions.length} detected</small></div>
            {result.exceptions.length ? (
              <ul>{result.exceptions.map((exception) => <li key={exception}><CircleAlert size={15} /><span><strong>{exception}</strong><small>Requires evidence-aware handling</small></span></li>)}</ul>
            ) : (
              <div className="exceptions-clear"><CheckCircle2 size={25} /><strong>No unresolved exceptions</strong><p>References, amounts, and stage transitions reconcile.</p></div>
            )}
            <div className="uncertainty-note"><ShieldCheck size={16} /><p><strong>Honest by design.</strong> Missing or conflicting evidence lowers confidence; the engine never guesses a financial fact.</p></div>
          </section>
        </div>

        <OperationsDashboard dataset={dataset} recent={recent} />
        <div id="data-lab"><CsvUploader dataset={dataset} onDatasetChange={replaceDataset} /></div>
      </section>

      <footer>
        <span className="brand"><span className="brand-mark"><Sparkles size={15} /></span>Settlement Trace <b>AI</b></span>
        <p>Built for transparent fintech support investigations. All names, amounts, and records are simulated.</p>
        <a href="#top">Back to top ↑</a>
      </footer>
    </main>
  );
}

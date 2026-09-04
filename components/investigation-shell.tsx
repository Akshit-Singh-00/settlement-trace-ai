'use client';

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, stagger, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
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
  History,
  Layers3,
  ListFilter,
  LoaderCircle,
  Printer,
  Search,
  ShieldCheck,
  Sparkles,
  TimerReset,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CsvUploader } from '@/components/csv-uploader';
import { EvidenceInspector } from '@/components/evidence-inspector';
import { PipelineExperience } from '@/components/pipeline-experience';
import { ThemeToggle } from '@/components/theme-provider';
import { TransactionTimeline } from '@/components/transaction-timeline';
import { deterministicExplanation, type ExplanationResponse } from '@/lib/ai-explanation';
import { parseInvestigationQuery, searchTransactions, type ParsedInvestigationQuery } from '@/lib/query-parser';
import { buildSandboxData, demoCases } from '@/lib/sandbox-data';
import { extractTransactionId, reconcileTransaction } from '@/lib/reconciliation';
import type { InvestigationResult, InvestigationStatus, PipelineStage, SettlementDataset } from '@/lib/settlement-types';

const OperationsDashboard = lazy(() => import('@/components/operations-dashboard').then((module) => ({ default: module.OperationsDashboard })));

const statusCopy: Record<InvestigationStatus, string> = {
  successful: 'Settled',
  pending: 'Pending',
  delayed: 'Delayed',
  failed: 'Failed',
  mismatch: 'Mismatch',
  uncertain: 'Uncertain',
};

const suggestions = [
  'Why is TXN-1048 pending?',
  'Which settlements failed on September 3?',
  'Show delayed transactions',
  'Which transactions have settlement mismatches?',
];

const reveal = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0 },
};

function formatMoney(amount?: number, currency = 'INR') {
  if (amount === undefined) return 'Unavailable';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount / 100);
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

function TraceLoading() {
  return (
    <motion.output className="trace-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <span>Tracing evidence</span>
      <div>{['Gateway', 'Settlement', 'Bank', 'Ledger'].map((label, index) => (
        <i key={label} style={{ '--trace-delay': `${index * 55}ms` } as React.CSSProperties}><b />{label}</i>
      ))}</div>
    </motion.output>
  );
}

function ResultList({
  results,
  query,
  onSelect,
}: {
  results: InvestigationResult[];
  query: ParsedInvestigationQuery;
  onSelect: (transactionId: string) => void;
}) {
  return (
    <motion.section id="query-results" className="query-results" initial="hidden" animate="visible" variants={reveal} aria-live="polite">
      <div className="panel-title">
        <span><ListFilter size={15} /> Matching transactions</span>
        <small>{results.length} result{results.length === 1 ? '' : 's'}</small>
      </div>
      {results.length ? (
        <motion.div className="query-result-grid" initial="hidden" animate="visible" variants={{ visible: { transition: { delayChildren: stagger(0.045) } } }}>
          {results.map((item) => (
            <motion.button key={item.transactionId} type="button" variants={reveal} onClick={() => onSelect(item.transactionId)}>
              <span className="query-result-id"><b>{item.transactionId}</b><em data-status={item.status}>{statusCopy[item.status]}</em></span>
              <strong>{item.merchant ?? 'Unknown merchant'}</strong>
              <span>{formatMoney(item.amount, item.currency)} · {formatDate(item.transactionTimestamp)}</span>
              <small>{item.stage} · {item.rootCause}</small>
              <ArrowRight size={16} aria-hidden="true" />
            </motion.button>
          ))}
        </motion.div>
      ) : (
        <div className="query-empty">
          <Search size={25} />
          <strong>No matching transactions</strong>
          <p>No synthetic records match {query.date ? `the date ${query.date}` : 'those filters'}. Try a demo case or remove a filter.</p>
        </div>
      )}
    </motion.section>
  );
}

export function InvestigationShell({ referenceTime }: { referenceTime: string }) {
  const referenceDate = useMemo(() => new Date(referenceTime), [referenceTime]);
  const initialDataset = useMemo(() => buildSandboxData(referenceDate), [referenceDate]);
  const [dataset, setDataset] = useState<SettlementDataset>(initialDataset);
  const [query, setQuery] = useState('TXN-1048');
  const [result, setResult] = useState(() => reconcileTransaction('TXN-1048', initialDataset, referenceDate));
  const [recent, setRecent] = useState<InvestigationResult[]>([]);
  const [selectedStage, setSelectedStage] = useState<PipelineStage>('settlement');
  const [listResults, setListResults] = useState<InvestigationResult[] | null>(null);
  const [parsedQuery, setParsedQuery] = useState(() => parseInvestigationQuery('TXN-1048', referenceDate));
  const [searchOpen, setSearchOpen] = useState(false);
  const [isTracing, setIsTracing] = useState(false);
  const [explanation, setExplanation] = useState<ExplanationResponse>(() => ({ source: 'deterministic', explanation: deterministicExplanation(result), fallbackReason: 'not-configured' }));
  const [explanationLoading, setExplanationLoading] = useState(true);
  const [reportReady, setReportReady] = useState(false);
  const reducedMotion = useReducedMotion();
  const visualX = useSpring(useMotionValue(0), { stiffness: 120, damping: 22 });
  const visualY = useSpring(useMotionValue(0), { stiffness: 120, damping: 22 });
  const searchRef = useRef<HTMLDivElement>(null);

  const visibleSuggestions = useMemo(() => {
    const needle = query.toLowerCase();
    const demos = demoCases
      .filter((item) => !needle || `${item.transactionId} ${item.label} ${item.summary}`.toLowerCase().includes(needle))
      .slice(0, 4)
      .map((item) => `${item.transactionId} — ${item.label}`);
    const prompts = suggestions.filter((item) => !needle || item.toLowerCase().includes(needle)).slice(0, 3);
    return [...demos, ...prompts].slice(0, 6);
  }, [query]);

  useEffect(() => {
    document.documentElement.dataset.appReady = 'true';
    return () => { delete document.documentElement.dataset.appReady; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result }),
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() as Promise<ExplanationResponse> : Promise.reject(new Error('Explanation service unavailable')))
      .then((next) => setExplanation(next))
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          setExplanation({ source: 'deterministic', explanation: deterministicExplanation(result), fallbackReason: 'provider-unavailable' });
        }
      })
      .finally(() => setExplanationLoading(false));
    return () => controller.abort();
  }, [result]);

  const applyResult = useCallback((next: InvestigationResult, scroll = true) => {
    setExplanation({ source: 'deterministic', explanation: deterministicExplanation(next), fallbackReason: 'not-configured' });
    setExplanationLoading(true);
    setResult(next);
    setListResults(null);
    setSelectedStage(next.stage);
    setRecent((current) => [next, ...current.filter((item) => item.transactionId !== next.transactionId)].slice(0, 8));
    if (scroll) requestAnimationFrame(() => document.querySelector('#investigation')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' }));
  }, [reducedMotion]);

  const investigate = useCallback(async (value: string, scroll = true) => {
    const parsed = parseInvestigationQuery(value, referenceDate);
    setParsedQuery(parsed);
    setSearchOpen(false);
    setIsTracing(true);
    await new Promise<void>((resolve) => setTimeout(resolve, reducedMotion ? 20 : 180));

    if (parsed.mode === 'list') {
      const matches = searchTransactions(parsed, dataset, referenceDate);
      setListResults(matches);
      setIsTracing(false);
      if (scroll) requestAnimationFrame(() => document.querySelector('#query-results')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' }));
      return matches[0];
    }

    const transactionId = parsed.transactionId ?? extractTransactionId(value);
    const next = reconcileTransaction(transactionId, dataset, referenceDate);
    setQuery(transactionId);
    applyResult(next, scroll);
    setIsTracing(false);
    return next;
  }, [applyResult, dataset, reducedMotion, referenceDate]);

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
          const next = await investigate(transactionId, false);
          if (!next) throw new Error('No transaction matched the request.');
          return { transactionId: next.transactionId, status: next.status, stage: next.stage, rootCause: next.rootCause, confidence: next.confidence };
        },
      }, { signal: lifecycle.signal })).catch(reportError);
    } catch (error) {
      reportError(error);
    }
    return () => lifecycle.abort();
  }, [investigate]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!searchRef.current?.contains(event.target as Node)) setSearchOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  function replaceDataset(nextDataset: SettlementDataset) {
    setDataset(nextDataset);
    applyResult(reconcileTransaction(result.transactionId, nextDataset, referenceDate), false);
  }

  function resetDataset() {
    const next = buildSandboxData(referenceDate);
    setDataset(next);
    applyResult(reconcileTransaction('TXN-1048', next, referenceDate), false);
    setQuery('TXN-1048');
  }

  const reportHref = useMemo(() => {
    const report = {
      generatedAt: referenceTime,
      disclaimer: 'Simulated dataset — not live financial data.',
      explanationSource: explanation.source === 'ai' ? 'AI-assisted explanation' : 'Deterministic explanation',
      supportExplanation: explanation.explanation,
      ...result,
    };
    return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(report, null, 2))}`;
  }, [explanation, referenceTime, result]);

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <div className="ambient-grid" aria-hidden="true" />
      <header className="site-header">
        <a href="#top" className="brand" aria-label="Settlement Trace AI home"><span className="brand-mark"><Sparkles size={18} /></span><span>Settlement Trace <b>AI</b></span></a>
        <nav aria-label="Primary navigation"><a href="#investigation">Investigate</a><a href="#demo-cases">Demo cases</a><a href="#operations">Operations</a><a href="#data-lab">Data lab</a></nav>
        <div className="header-tools"><div className="header-meta"><span className="live-dot" /> Engine online</div><ThemeToggle /></div>
      </header>

      <section id="top" className="hero-shell">
        <motion.div className="hero-copy" initial="hidden" animate="visible" variants={{ visible: { transition: { delayChildren: reducedMotion ? 0 : stagger(0.075) } } }}>
          <motion.div variants={reveal} className="eyebrow"><ShieldCheck size={15} /> Evidence-grounded settlement intelligence</motion.div>
          <motion.h1 variants={reveal}>Follow the money.<br /><span>Find the break.</span></motion.h1>
          <motion.p variants={reveal} className="hero-lead">Trace a payment from capture to settlement, bank credit, and merchant ledger—then explain the first failure with auditable evidence.</motion.p>
          <motion.div variants={reveal} className="search-area" ref={searchRef}>
            <form className="search-shell" onSubmit={(event) => { event.preventDefault(); void investigate(query); }}>
              <Search size={20} aria-hidden="true" />
              <Input value={query} onFocus={() => setSearchOpen(true)} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }} aria-label="Transaction ID, date, or support question" autoComplete="off" placeholder="Ask about TXN-1048, a settlement date, or failed transactions…" />
              <AnimatePresence>{query && <motion.button className="search-clear" type="button" aria-label="Clear search" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} onClick={() => { setQuery(''); setListResults(null); }}><X size={16} /></motion.button>}</AnimatePresence>
              <Button type="submit" disabled={isTracing || !query.trim()}>{isTracing ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />} Investigate <ArrowRight size={17} /></Button>
            </form>
            <AnimatePresence>{searchOpen && visibleSuggestions.length > 0 && (
              <motion.div className="search-suggestions" initial={{ opacity: 0, y: -6, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.18 }}>
                <span><History size={13} /> Demo and recent searches</span>
                {visibleSuggestions.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => { const value = suggestion.split(' — ')[0] ?? suggestion; setQuery(value); void investigate(value); }}><Search size={13} />{suggestion}<ArrowRight size={13} /></button>
                ))}
              </motion.div>
            )}</AnimatePresence>
          </motion.div>
          <AnimatePresence>{parsedQuery.chips.length > 0 && <motion.div className="query-chips" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>{parsedQuery.chips.map((chip) => <span key={chip}>{chip}</span>)}</motion.div>}</AnimatePresence>
          <motion.div variants={reveal} className="hero-actions"><a href="#demo-cases">View Demo Cases <ArrowDown size={14} /></a><span><Bot size={14} /> Dates and filters route deterministically</span></motion.div>
          <motion.div variants={reveal} className="trust-row" aria-label="Product guarantees">
            {[<><CheckCircle2 size={14} /> Deterministic reconciliation</>, <><Fingerprint size={14} /> Explainable confidence</>, <><Database size={14} /> Synthetic evidence</>, <><Layers3 size={14} /> Grounded AI fallback</>].map((content, index) => <motion.span key={index} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: reducedMotion ? 0 : 0.45 + index * 0.07 }}>{content}</motion.span>)}
          </motion.div>
        </motion.div>

        <motion.div
          className="hero-visual"
          aria-label="Interactive 3D settlement pipeline"
          style={{ x: visualX, y: visualY }}
          onPointerMove={(event) => {
            if (reducedMotion || event.pointerType === 'touch') return;
            const rect = event.currentTarget.getBoundingClientRect();
            visualX.set(((event.clientX - rect.left) / rect.width - 0.5) * 6);
            visualY.set(((event.clientY - rect.top) / rect.height - 0.5) * 5);
          }}
          onPointerLeave={() => { visualX.set(0); visualY.set(0); }}
          initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.45 }}
        >
          <div className="scene-kicker"><span>Live trace model</span><small>Click a stage to inspect evidence</small></div>
          <PipelineExperience timeline={result.timeline} selectedStage={selectedStage} onStageSelect={setSelectedStage} transactionId={result.transactionId} />
          <AnimatePresence mode="wait"><motion.div key={result.transactionId} className="hero-readout" initial={{ opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -7 }}>
            <span>TRACE / {result.transactionId.replace('TXN-', '')}</span><strong>{result.rootCause}</strong><small>{result.confidence}% confidence · {statusCopy[result.status]}</small>
          </motion.div></AnimatePresence>
        </motion.div>
      </section>

      <AnimatePresence>{isTracing && <TraceLoading />}</AnimatePresence>
      {listResults && <ResultList results={listResults} query={parsedQuery} onSelect={(transactionId) => void investigate(transactionId)} />}

      <div className="sandbox-banner"><CircleAlert size={17} /><strong>Simulated dataset — not live financial data.</strong><span>Every finding is computed from synthetic source records.</span></div>

      <section id="investigation" className="workspace-shell" aria-live="polite">
        <AnimatePresence mode="wait">
          <motion.div key={result.transactionId} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: reducedMotion ? 0.01 : 0.24 }}>
            <div className="section-heading">
              <div><span className="section-kicker">Active investigation</span><h2>{result.transactionId}</h2></div>
              <div className="report-actions">
                <button type="button" onClick={() => { setReportReady(true); setTimeout(() => { window.print(); setReportReady(false); }, 160); }} disabled={reportReady}>{reportReady ? <LoaderCircle className="spin" size={15} /> : <Printer size={15} />} Print report</button>
                <a href={reportHref} download={`${result.transactionId}-settlement-trace.json`}><Download size={15} /> Download report</a>
                <span className={`status-pill status-${result.status}`}>{statusCopy[result.status]}</span>
              </div>
            </div>

            {result.validationIssues.some((item) => item.code === 'missing_gateway') ? (
              <div className="unknown-state"><Search size={28} /><div><strong>Transaction not found</strong><p>No gateway record matches {result.transactionId}. Check the ID or import a synthetic gateway CSV.</p></div><button type="button" onClick={() => { setQuery(''); setSearchOpen(true); document.querySelector<HTMLInputElement>('.search-shell input')?.focus(); }}>Try another search</button></div>
            ) : (
              <div className="workspace-grid">
                <article className="result-card">
                  <div className="result-head"><span>Root-cause assessment</span><strong title="Confidence reflects completeness and consistency of evidence across gateway, settlement, bank, and ledger records."><Gauge size={14} /> {result.confidence}% confidence</strong></div>
                  <motion.h3 initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: reducedMotion ? 0 : 0.08 }}>{result.rootCause}</motion.h3>
                  <div className="confidence-track"><span className="visually-hidden">Investigation confidence: {result.confidence}%</span><motion.i initial={{ width: 0 }} animate={{ width: `${result.confidence}%` }} transition={{ duration: reducedMotion ? 0.01 : 0.55, ease: 'easeOut' }} /></div>
                  {result.confidenceBreakdown.length > 0 && <div className="confidence-breakdown">{result.confidenceBreakdown.map((factor) => <span key={`${factor.stage}-${factor.reason}`}>−{factor.deduction} {factor.reason}</span>)}</div>}

                  <motion.div className="explanation-box" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reducedMotion ? 0 : 0.13 }}>
                    <div><span className={`explanation-source ${explanation.source}`}>{explanationLoading ? <LoaderCircle className="spin" size={13} /> : explanation.source === 'ai' ? <Sparkles size={13} /> : <ShieldCheck size={13} />}{explanationLoading ? 'Checking grounded AI…' : explanation.source === 'ai' ? 'AI-assisted explanation' : 'Deterministic explanation'}</span></div>
                    <p>{explanation.explanation.whatHappened}</p>
                    <small>{explanation.explanation.uncertainty}</small>
                  </motion.div>

                  <dl className="detail-grid">
                    <div><dt>Merchant</dt><dd>{result.merchant ?? 'Unknown'}</dd></div><div><dt>Amount</dt><dd>{formatMoney(result.amount, result.currency)}</dd></div>
                    <div><dt>Current stage</dt><dd>{result.stage}</dd></div><div><dt>Settlement ID</dt><dd>{result.settlementId ?? 'Not created'}</dd></div>
                    <div><dt>Captured</dt><dd>{formatDate(result.transactionTimestamp)}</dd></div><div><dt>Expected by</dt><dd>{formatDate(result.expectedSettlementTime)}</dd></div>
                    <div className="sla-detail"><dt>SLA countdown</dt><dd><TimerReset size={14} /> {formatSla(result.slaMinutesRemaining)}</dd></div><div><dt>Evidence sources</dt><dd>{result.evidence.filter((group) => group.records.length).length} of 4 present</dd></div>
                  </dl>
                  <motion.div className="action-box" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reducedMotion ? 0 : 0.18 }}><span>Recommended next support action</span><p>{explanation.explanation.recommendedAction}</p></motion.div>
                </article>

                <aside className="demo-panel" id="demo-cases">
                  <div className="panel-title"><span>Demo cases</span><small>{demoCases.length} scenarios</small></div><p className="panel-intro">Every outcome is computed at click time—answers are never hardcoded.</p>
                  <div className="demo-list">{demoCases.map((item) => (
                    <button key={item.transactionId} type="button" onClick={() => void investigate(item.transactionId)} className={item.transactionId === result.transactionId ? 'active' : ''}><span><b>{item.transactionId}</b><small>{item.label}</small></span><em data-status={item.category}>{item.category}</em></button>
                  ))}</div>
                </aside>
              </div>
            )}

            {!result.validationIssues.some((item) => item.code === 'missing_gateway') && <>
              <TransactionTimeline timeline={result.timeline} selectedStage={selectedStage} onStageSelect={setSelectedStage} />
              <div className="evidence-grid">
                <EvidenceInspector evidence={result.evidence} validationIssues={result.validationIssues} selectedStage={selectedStage} onStageSelect={setSelectedStage} />
                <section className="exceptions-card" aria-labelledby="exceptions-title">
                  <div className="panel-title"><span id="exceptions-title"><CircleAlert size={15} /> Exceptions &amp; Uncertainty</span><small>{result.validationIssues.length} detected</small></div>
                  {result.validationIssues.length ? <motion.ul initial="hidden" animate="visible" variants={{ visible: { transition: { delayChildren: stagger(0.045) } } }}>{result.validationIssues.map((item, index) => <motion.li variants={reveal} key={`${item.code}-${item.stage}-${index}`}><CircleAlert size={15} /><span><strong>{item.message}</strong><small>{item.detail}</small></span></motion.li>)}</motion.ul> : <div className="exceptions-clear"><CheckCircle2 size={25} /><strong>No unresolved exceptions</strong><p>References, amounts, currency, merchant, and stage transitions reconcile.</p></div>}
                  <div className="uncertainty-note"><ShieldCheck size={16} /><p><strong>Honest by design.</strong> Missing or conflicting evidence lowers confidence; the engine never guesses a financial fact.</p></div>
                </section>
              </div>
            </>}
          </motion.div>
        </AnimatePresence>

        <Suspense fallback={<div className="dashboard-loading"><LoaderCircle className="spin" /> Loading operations dashboard…</div>}>
          <OperationsDashboard dataset={dataset} recent={recent} referenceTime={referenceTime} onInvestigate={(transactionId) => void investigate(transactionId)} onFilter={(status) => { const value = `Show ${status} transactions`; setQuery(value); void investigate(value); }} />
        </Suspense>
        <div id="data-lab"><CsvUploader dataset={dataset} onDatasetChange={replaceDataset} onReset={resetDataset} /></div>
      </section>

      <footer><span className="brand"><span className="brand-mark"><Sparkles size={15} /></span>Settlement Trace <b>AI</b></span><p>Built for transparent fintech support investigations. All names, amounts, and records are simulated.</p><a href="#top">Back to top ↑</a></footer>
    </main>
  );
}

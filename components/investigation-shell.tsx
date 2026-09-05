'use client';
import Link from 'next/link';

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
  Network,
  Printer,
  Route,
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
import { BootSequence, TraceSequence, ViewFrame, type AppView } from '@/components/motion-system';
import { ProductNavigation } from '@/components/product-navigation';
import { TransactionTimeline } from '@/components/transaction-timeline';
import { deterministicExplanation, type ExplanationResponse } from '@/lib/ai-explanation';
import { parseInvestigationQuery, searchTransactions, type ParsedInvestigationQuery } from '@/lib/query-parser';
import { buildSandboxData, demoCases } from '@/lib/sandbox-data';
import { extractTransactionId, reconcileTransaction } from '@/lib/reconciliation';
import type { InvestigationResult, InvestigationStatus, PipelineStage, SettlementDataset } from '@/lib/settlement-types';

const loadDashboard = () => import('@/components/operations-dashboard');
const OperationsDashboard = lazy(() => loadDashboard().then((module) => ({ default: module.OperationsDashboard })));

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
  'Which settlements failed on September 3 2026?',
  'Show delayed transactions',
  'Which transactions have settlement mismatches?',
];

const heroDemoIds = ['TXN-1055', 'TXN-1001', 'TXN-1080'] as const;
const landingDemoIds = ['TXN-1001', 'TXN-1055', 'TXN-1071', 'TXN-1080', 'TXN-1090', 'TXN-1097'] as const;

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

function SectionReveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reducedMotion ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration: reducedMotion ? 0.01 : 0.42, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
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
  const [view, setView] = useState<AppView>('landing');
  const [booting, setBooting] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [landingSection, setLandingSection] = useState('product');
  const [tracingResult, setTracingResult] = useState<InvestigationResult>();
  const [resultRevision, setResultRevision] = useState(0);
  const searchRequest = useRef(0);
  const preparationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollTarget = useRef('');
  const viewRef = useRef<AppView>('landing');
  const [heroDemo, setHeroDemo] = useState<{ index: number; stage: PipelineStage }>({ index: 0, stage: 'bank' });
  const reducedMotion = useReducedMotion();
  const visualX = useSpring(useMotionValue(0), { stiffness: 120, damping: 22 });
  const visualY = useSpring(useMotionValue(0), { stiffness: 120, damping: 22 });
  const searchRef = useRef<HTMLDivElement>(null);
  const heroResult = useMemo(
    () => reconcileTransaction(heroDemoIds[heroDemo.index], initialDataset, referenceDate),
    [heroDemo.index, initialDataset, referenceDate],
  );

  useEffect(() => {
    if (reducedMotion || view !== 'landing' || booting) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setHeroDemo((current) => {
        const index = (current.index + 1) % heroDemoIds.length;
        const nextResult = reconcileTransaction(heroDemoIds[index], initialDataset, referenceDate);
        return { index, stage: nextResult.stage };
      });
    }, 5600);
    return () => window.clearInterval(interval);
  }, [initialDataset, reducedMotion, referenceDate, view, booting]);

  const visibleSuggestions = useMemo(() => {
    const needle = query.toLowerCase();
    const demos = demoCases
      .filter((item) => !needle || `${item.transactionId} ${item.label} ${item.summary}`.toLowerCase().includes(needle))
      .slice(0, 4)
      .map((item) => `${item.transactionId} — ${item.label}`);
    const prompts = suggestions.filter((item) => !needle || item.toLowerCase().includes(needle)).slice(0, 3);
    return [...demos, ...prompts].slice(0, 6);
  }, [query]);

  const navigate = useCallback((target: string, updateHistory = true) => {
    const views: Record<string, AppView> = { investigation: 'investigation', dashboard: 'dashboard', operations: 'dashboard', demos: 'demos', upload: 'upload', 'data-lab': 'upload', reports: 'reports' };
    const nextView = views[target] ?? 'landing';
    searchRequest.current += 1;
    setIsTracing(false);
    setSearchOpen(false);
    if ((nextView === 'investigation' || nextView === 'reports') && nextView !== viewRef.current) setExplanationLoading(true);
    setTracingResult(undefined);
    clearTimeout(preparationTimer.current);
    if (nextView === 'dashboard') void loadDashboard();
    const shouldPrepare = nextView === 'investigation' && viewRef.current !== 'investigation';
    setPreparing(shouldPrepare && !reducedMotion);
    if (shouldPrepare) preparationTimer.current = setTimeout(() => setPreparing(false), 300);
    scrollTarget.current = nextView === 'landing' ? target : '';
    if (updateHistory && location.hash !== '#' + target) history.pushState(null, '', '#' + target);
    if (nextView === viewRef.current) {
      if (nextView === 'landing') {
        if (target === 'top') window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
        else document.getElementById(target)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
      }
    } else {
      viewRef.current = nextView;
      setView(nextView);
    }
  }, [reducedMotion]);

  useEffect(() => {
    // Match the CSS entrance, without waiting for optional AI or WebGL downloads.
    const timer = setTimeout(() => setBooting(false), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 780);
    return () => { clearTimeout(timer); clearTimeout(preparationTimer.current); searchRequest.current += 1; };
  }, []);

  useEffect(() => {
    const syncHash = () => navigate(location.hash.slice(1) || 'top', false);
    syncHash();
    window.addEventListener('popstate', syncHash);
    window.addEventListener('hashchange', syncHash);
    return () => { window.removeEventListener('popstate', syncHash); window.removeEventListener('hashchange', syncHash); };
  }, [navigate]);

  useEffect(() => {
    if (booting) return;
    const timer = setTimeout(() => {
      document.documentElement.dataset.appReady = 'true';
      const section = view === 'landing' && scrollTarget.current && scrollTarget.current !== 'top' ? document.getElementById(scrollTarget.current) : null;
      if (section) section.scrollIntoView({ behavior: 'instant' });
      else window.scrollTo({ top: 0, behavior: 'instant' });
      if (view !== 'landing') document.querySelector<HTMLElement>('[data-view] h2')?.focus({ preventScroll: true });
    }, reducedMotion ? 90 : 260);
    return () => clearTimeout(timer);
  }, [view, booting, reducedMotion]);

  useEffect(() => {
    if (view !== 'landing' || booting) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setLandingSection(visible[0].target.id === 'top' ? 'product' : visible[0].target.id);
    }, { rootMargin: '-15% 0px -45% 0px', threshold: 0 });
    const timer = setTimeout(() => ['top', 'product', 'how-it-works', 'demo-cases'].forEach((id) => { const section = document.getElementById(id); if (section) observer.observe(section); }), 260);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [view, booting]);

  useEffect(() => {
    if (view !== 'investigation' && view !== 'reports') return;
    const controller = new AbortController();
    void fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result }),
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() as Promise<ExplanationResponse> : Promise.reject(new Error('Explanation service unavailable')))
      .then((next) => { if (!controller.signal.aborted) setExplanation(next); })
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          setExplanation({ source: 'deterministic', explanation: deterministicExplanation(result), fallbackReason: 'provider-unavailable' });
        }
      })
      .finally(() => { if (!controller.signal.aborted) setExplanationLoading(false); });
    return () => controller.abort();
  }, [result, view]);

  const applyResult = useCallback((next: InvestigationResult, scroll = true) => {
    setExplanation({ source: 'deterministic', explanation: deterministicExplanation(next), fallbackReason: 'not-configured' });
    setExplanationLoading(true);
    setResult(next);
    setResultRevision((revision) => revision + 1);
    setListResults(null);
    setSelectedStage(next.stage);
    setRecent((current) => [next, ...current.filter((item) => item.transactionId !== next.transactionId)].slice(0, 8));
    if (scroll) requestAnimationFrame(() => document.querySelector('#investigation')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' }));
  }, [reducedMotion]);

  const investigate = useCallback(async (value: string, scroll = true) => {
    navigate('investigation');
    const request = ++searchRequest.current;
    const parsed = parseInvestigationQuery(value, referenceDate);
    const transactionId = parsed.transactionId ?? extractTransactionId(value);
    const next = parsed.mode === 'list' ? undefined : reconcileTransaction(transactionId, dataset, referenceDate);
    setParsedQuery(parsed);
    setTracingResult(next);
    setIsTracing(true);
    // Reconciliation has already completed; this short visual bridge presents its actual statuses.
    await new Promise<void>((resolve) => setTimeout(resolve, reducedMotion ? 0 : 320));
    if (request !== searchRequest.current) return undefined;
    if (parsed.mode === 'list') {
      const matches = searchTransactions(parsed, dataset, referenceDate);
      setListResults(matches);
      setIsTracing(false);
      return matches[0];
    }
    setQuery(transactionId);
    applyResult(next!, scroll);
    setIsTracing(false);
    return next;
  }, [applyResult, dataset, navigate, reducedMotion, referenceDate]);

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

  const landingContent = <>      <section id="top" className="hero-shell" aria-labelledby="hero-title">
        <motion.div className="hero-copy" initial="hidden" animate="visible" variants={{ visible: { transition: { delayChildren: reducedMotion ? 0 : stagger(0.075) } } }}>
          <motion.div variants={reveal} className="eyebrow"><ShieldCheck size={15} /> Settlement Trace AI</motion.div>
          <motion.h1 id="hero-title" variants={reveal}>Follow the money.<br /><span>Find the break.</span></motion.h1>
          <motion.p variants={reveal} className="hero-lead">Trace settlement failures across payment gateway, settlement, bank, and merchant ledger records using deterministic reconciliation and evidence-grounded AI explanations.</motion.p>
          <motion.div variants={reveal} className="hero-cta-row">
            <a className="primary-cta" href="#investigation" onClick={(event) => { event.preventDefault(); navigate('investigation'); }}>Investigate a Transaction <ArrowRight size={17} /></a>
            <a className="secondary-cta" href="#demo-cases" onClick={(event) => { event.preventDefault(); navigate('demo-cases'); }}>Explore Demo Cases <ArrowDown size={16} /></a>
          </motion.div>
          <motion.p variants={reveal} className="hero-disclaimer"><CircleAlert size={15} /> Simulated dataset — not live financial data.</motion.p>
          <motion.div variants={reveal} className="trust-row" aria-label="Product guarantees">
            {[<><Sparkles size={14} /> Evidence-grounded AI</>, <><CheckCircle2 size={14} /> Deterministic reconciliation</>, <><Fingerprint size={14} /> Explainable confidence</>, <><Database size={14} /> Synthetic sandbox data</>].map((content, index) => <motion.span key={index} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: reducedMotion ? 0 : 0.45 + index * 0.07 }}>{content}</motion.span>)}
          </motion.div>
          <motion.div variants={reveal} className="hero-metrics" aria-label="Product scope"><span><strong>{demoCases.length}</strong> real demo scenarios</span><span><strong>4</strong> reconciled systems</span><span><strong>1</strong> deterministic truth layer</span></motion.div>
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
          <PipelineExperience timeline={heroResult.timeline} selectedStage={heroDemo.stage} onStageSelect={(stage) => setHeroDemo((current) => ({ ...current, stage }))} transactionId={heroResult.transactionId} />
          <AnimatePresence mode="wait"><motion.div key={heroResult.transactionId} className="hero-readout" initial={{ opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -7 }}>
            <span>LIVE DEMO / {heroResult.transactionId}</span><strong>{heroResult.rootCause}</strong><small>{heroResult.confidence}% confidence · {statusCopy[heroResult.status]}</small>
          </motion.div></AnimatePresence>
          <div className="hero-demo-controls" aria-label="Hero demo transaction">
            {heroDemoIds.map((transactionId, index) => <button key={transactionId} type="button" className={index === heroDemo.index ? 'active' : ''} aria-label={`Show ${transactionId} demo`} aria-pressed={index === heroDemo.index} onClick={() => setHeroDemo({ index, stage: reconcileTransaction(transactionId, initialDataset, referenceDate).stage })} />)}
          </div>
        </motion.div>
      </section>

      <section id="product" className="landing-section problem-section" aria-labelledby="problem-title">
        <SectionReveal className="landing-split">
          <div><span className="section-kicker">The settlement blind spot</span><h2 id="problem-title">One payment. Four systems. Too many places to look.</h2></div>
          <p>A single settlement crosses independent gateway, processor, bank, and ledger records. When one event disappears or conflicts, support teams are forced to compare timestamps and references by hand. Settlement Trace turns that fragmented evidence into one auditable answer.</p>
        </SectionReveal>
      </section>

      <section id="how-it-works" className="landing-section" aria-labelledby="how-title">
        <SectionReveal>
          <div className="landing-heading"><span className="section-kicker">How it works</span><h2 id="how-title">Trace every handoff. Explain the first break.</h2><p>The language model explains a structured finding; it never decides the financial facts.</p></div>
          <div className="process-grid">
            {[
              ['01', 'Trace', 'Collect evidence from gateway, settlement, bank, and ledger records.', Network],
              ['02', 'Reconcile', 'Join identifiers, amounts, currency, merchants, timestamps, and references.', Route],
              ['03', 'Detect', 'Surface missing stages, mismatches, duplicates, and impossible chronology.', CircleAlert],
              ['04', 'Explain', 'Turn the deterministic result into a concise support action with an honest fallback.', Bot],
            ].map(([number, title, copy, Icon], index) => (
              <motion.article key={String(title)} initial={reducedMotion ? false : { opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: reducedMotion ? 0 : index * 0.06 }}>
                <span>{String(number)}</span><Icon size={20} /><h3>{String(title)}</h3><p>{String(copy)}</p>
              </motion.article>
            ))}
          </div>
        </SectionReveal>
      </section>

      <section className="landing-section why-section" aria-labelledby="why-title">
        <SectionReveal>
          <div className="landing-heading"><span className="section-kicker">Why Settlement Trace AI</span><h2 id="why-title">Clear enough for support. Rigorous enough for audit.</h2></div>
          <div className="feature-grid">
            <article><ShieldCheck size={21} /><h3>Deterministic truth</h3><p>Every status and confidence deduction comes from testable reconciliation rules.</p></article>
            <article><Sparkles size={21} /><h3>Grounded explanation</h3><p>AI receives only structured findings and falls back safely when unavailable.</p></article>
            <article><Gauge size={21} /><h3>Explainable confidence</h3><p>Missing or conflicting evidence visibly lowers confidence—never by chance.</p></article>
            <article><Layers3 size={21} /><h3>Evidence in context</h3><p>The 3D pipeline, timeline, and source panels stay synchronized stage by stage.</p></article>
          </div>
        </SectionReveal>
      </section>

      <section id="demo-cases" className="landing-section landing-demo-section" aria-labelledby="landing-demo-title">
        <SectionReveal>
          <div className="landing-heading"><span className="section-kicker">Interactive demo cases</span><h2 id="landing-demo-title">See how the engine handles the messy cases.</h2><p>Select a real synthetic scenario to open the complete investigation.</p></div>
          <div className="landing-demo-grid">
            {landingDemoIds.map((transactionId, index) => {
              const demo = demoCases.find((item) => item.transactionId === transactionId)!;
              return <motion.button key={transactionId} type="button" initial={reducedMotion ? false : { opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: reducedMotion ? 0 : index * 0.045 }} onClick={() => void investigate(transactionId)}><span><b>{transactionId}</b><em data-status={demo.category}>{demo.category}</em></span><strong>{demo.label}</strong><small>{demo.summary}</small><ArrowRight size={16} /></motion.button>;
            })}
          </div>
        </SectionReveal>
      </section>

      <section className="landing-section final-cta-section" aria-labelledby="final-cta-title">
        <SectionReveal className="final-cta-card"><div><span className="section-kicker">Ready to trace the break?</span><h2 id="final-cta-title">Investigate a settlement in seconds.</h2><p>Search by transaction ID, date, or a plain-language support question.</p></div><a className="primary-cta" href="#investigation" onClick={(event) => { event.preventDefault(); navigate('investigation'); }}>Open Investigation <ArrowRight size={17} /></a></SectionReveal>
      </section>

</>;
  const investigationContent = <>      <section id="investigation" className="workspace-shell" aria-live="polite">
        <div className="investigation-entry">
          <div className="landing-heading"><span className="section-kicker">Investigation workspace</span><h2 tabIndex={-1}>Ask where the settlement stopped.</h2><p>Use a transaction ID, an exact date, or an obvious status filter. Query routing stays deterministic.</p></div>
          <div className="search-area" ref={searchRef}>
            <form className="search-shell" onSubmit={(event) => { event.preventDefault(); void investigate(query); }}>
              <Search size={20} aria-hidden="true" />
              <Input id="investigation-query" value={query} onFocus={() => setSearchOpen(true)} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }} aria-label="Transaction ID, date, or support question" autoComplete="off" placeholder="Ask about TXN-1048, a settlement date, or failed transactions…" />
              <AnimatePresence>{query && <motion.button className="search-clear" type="button" aria-label="Clear search" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} onClick={() => { setQuery(''); setListResults(null); }}><X size={16} /></motion.button>}</AnimatePresence>
              <Button type="submit" disabled={isTracing || !query.trim()}>{isTracing ? <span className="button-trace" aria-hidden="true"><i /><i /><i /></span> : <Search size={17} />} {isTracing ? 'Tracing…' : 'Investigate'} <ArrowRight size={17} /></Button>
            </form>
            <AnimatePresence>{searchOpen && visibleSuggestions.length > 0 && (
              <motion.div className="search-suggestions" initial={{ opacity: 0, y: -6, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.18 }}>
                <span><History size={13} /> Demo and recent searches</span>
                {visibleSuggestions.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => { const value = suggestion.split(' — ')[0] ?? suggestion; setQuery(value); void investigate(value); }}><Search size={13} />{suggestion}<ArrowRight size={13} /></button>
                ))}
              </motion.div>
            )}</AnimatePresence>
          </div>
          <AnimatePresence>{parsedQuery.chips.length > 0 && <motion.div className="query-chips" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>{parsedQuery.chips.map((chip) => <span key={chip}>{chip}</span>)}</motion.div>}</AnimatePresence>
        </div>
        <AnimatePresence>{isTracing && <motion.div className="trace-loading-panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><TraceSequence label="Tracing evidence" result={tracingResult} /></motion.div>}</AnimatePresence>
        {listResults && <ResultList results={listResults} query={parsedQuery} onSelect={(transactionId) => void investigate(transactionId)} />}
        <AnimatePresence mode="wait">
          <motion.div key={`${result.transactionId}-${resultRevision}`} className={`investigation-result ${isTracing ? 'is-tracing' : ''}`} aria-busy={isTracing} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: reducedMotion ? 0.01 : 0.24 }}>
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
                  <div className="confidence-track"><span className="visually-hidden">Investigation confidence: {result.confidence}%</span><motion.i style={{ width: `${result.confidence}%`, transformOrigin: 'left' }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: reducedMotion ? 0.01 : 0.55, ease: 'easeOut' }} /></div>
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

                <aside className="demo-panel" id="workspace-demo-cases">
                  <div className="panel-title"><span>Demo cases</span><small>{demoCases.length} scenarios</small></div><p className="panel-intro">Every outcome is computed at click time—answers are never hardcoded.</p>
                  <div className="demo-list">{demoCases.map((item) => (
                    <button key={item.transactionId} type="button" onClick={() => void investigate(item.transactionId)} className={item.transactionId === result.transactionId ? 'active' : ''}><span><b>{item.transactionId}</b><small>{item.label}</small></span><em data-status={item.category}>{item.category}</em></button>
                  ))}</div>
                </aside>
              </div>
            )}

            {!result.validationIssues.some((item) => item.code === 'missing_gateway') && <>
              <div className="workspace-pipeline"><div className="scene-kicker"><span>{result.transactionId} / evidence trace</span><small>Select a stage to inspect</small></div><PipelineExperience timeline={result.timeline} selectedStage={selectedStage} onStageSelect={setSelectedStage} transactionId={result.transactionId} /></div>
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

      </section>
</>;

  return <main className="app-shell min-h-screen bg-background text-foreground" data-booting={booting}>
    <div className="ambient-grid" aria-hidden="true" />
    <BootSequence active={booting} />
    <div inert={booting}>
      <ProductNavigation view={view} ready={!booting} section={landingSection} onNavigate={navigate} />
      <AnimatePresence>{preparing && !booting && <motion.div key="preparing" className="preparing-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}><TraceSequence label="Preparing investigation workspace" result={tracingResult} /></motion.div>}</AnimatePresence>
      {!booting && <AnimatePresence mode="wait">
        <ViewFrame key={view} view={view}>
          {view === 'landing' && landingContent}
          {view !== 'landing' && <div className="sandbox-banner"><CircleAlert size={17} /><strong>Simulated dataset — not live financial data.</strong><span>Every finding is computed from synthetic source records.</span></div>}
          {view === 'investigation' && investigationContent}
          {view === 'dashboard' && <div className="workspace-shell view-workspace"><Suspense fallback={<TraceSequence label="Preparing operations dashboard…" />}><OperationsDashboard dataset={dataset} recent={recent} referenceTime={referenceTime} onInvestigate={(transactionId) => void investigate(transactionId)} onFilter={(status) => { const value = `Show ${status} transactions`; setQuery(value); void investigate(value); }} /></Suspense></div>}
          {view === 'demos' && <>      <section id="demo-gallery" className="landing-section landing-demo-section" aria-labelledby="landing-demo-title">
        <SectionReveal>
          <div className="landing-heading"><span className="section-kicker">Interactive demo cases</span><h2 id="landing-demo-title" tabIndex={-1}>See how the engine handles the messy cases.</h2><p>Select a real synthetic scenario to open the complete investigation.</p></div>
          <div className="landing-demo-grid">
            {landingDemoIds.map((transactionId, index) => {
              const demo = demoCases.find((item) => item.transactionId === transactionId)!;
              return <motion.button key={transactionId} type="button" initial={reducedMotion ? false : { opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: reducedMotion ? 0 : index * 0.045 }} onClick={() => void investigate(transactionId)}><span><b>{transactionId}</b><em data-status={demo.category}>{demo.category}</em></span><strong>{demo.label}</strong><small>{demo.summary}</small><ArrowRight size={16} /></motion.button>;
            })}
          </div>
        </SectionReveal>
      </section>

</>}
          {view === 'upload' && <div className="workspace-shell view-workspace"><div className="landing-heading"><span className="section-kicker">Synthetic data lab</span><h2 tabIndex={-1}>Bring the evidence together.</h2><p>Validate a source, then trace its transactions in the workspace.</p></div><CsvUploader dataset={dataset} onDatasetChange={replaceDataset} onReset={resetDataset} /><div className="upload-next"><button className="primary-cta" onClick={() => navigate('investigation')}>Open investigation <ArrowRight size={17} /></button><button className="secondary-cta" onClick={() => navigate('dashboard')}>View dashboard <ArrowRight size={17} /></button></div></div>}
          {view === 'reports' && <section className="workspace-shell view-workspace report-view"><div className="section-heading"><div><span className="section-kicker">Investigation report</span><h2 tabIndex={-1}>{result.transactionId}</h2></div><div className="report-actions"><button type="button" onClick={() => window.print()}><Printer size={15} /> Print report</button><a href={reportHref} download={`${result.transactionId}-settlement-trace.json`}><Download size={15} /> Download report</a></div></div><article className="result-card"><span className={`status-pill status-${result.status}`}>{statusCopy[result.status]}</span><h3>{result.rootCause}</h3><p>{explanation.explanation.whatHappened}</p><p>{result.confidence}% confidence · {explanation.source === 'ai' ? 'AI-assisted explanation' : 'Deterministic explanation'}</p><div className="action-box"><span>Recommended support action</span><p>{explanation.explanation.recommendedAction}</p></div></article><TransactionTimeline timeline={result.timeline} selectedStage={selectedStage} onStageSelect={setSelectedStage} /><EvidenceInspector evidence={result.evidence} validationIssues={result.validationIssues} selectedStage={selectedStage} onStageSelect={setSelectedStage} /></section>}
        </ViewFrame>
      </AnimatePresence>}
      {!booting && <footer><span className="brand"><span className="brand-mark"><Sparkles size={15} /></span>Settlement Trace <b>AI</b></span><p>Built for transparent fintech support investigations. All names, amounts, and records are simulated.</p><nav className="ws-policy-links" aria-label="Site information"><Link href="/privacy">Privacy policy</Link><Link href="/terms">Terms of use</Link></nav><a href="#top" onClick={(event) => { event.preventDefault(); navigate('top'); }}>Back to home ↑</a></footer>}
    </div>
  </main>;
}

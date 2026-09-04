'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, CircleAlert, Sparkles } from 'lucide-react';
import { pipelineStages, statusForStage, traceStopIndex } from '@/lib/pipeline-presentation';
import type { InvestigationResult } from '@/lib/settlement-types';

export const flowEase = [0.22, 1, 0.36, 1] as const;
export type AppView = 'landing' | 'investigation' | 'dashboard' | 'demos' | 'upload' | 'reports';
export const workspaceViews: Array<{ id: AppView; label: string }> = [
  { id: 'investigation', label: 'Investigation' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'demos', label: 'Demo cases' },
  { id: 'upload', label: 'CSV upload' },
  { id: 'reports', label: 'Reports' },
];

export function TraceSequence({ label, result, branded = false }: { label: string; result?: InvestigationResult; branded?: boolean }) {
  const reduced = useReducedMotion();
  const stop = result ? traceStopIndex(result.timeline) : 3;
  return <output className={`trace-sequence ${branded ? 'branded' : ''}`} aria-label={label} data-transaction={result?.transactionId}>
    {branded && <div className="loader-brand"><span className="brand-mark"><Sparkles size={22} /></span><strong>Settlement Trace <b>AI</b></strong></div>}
    <div className="sequence-rail" aria-hidden="true">
      {pipelineStages.map(({ id, label: stageLabel }, index) => {
        const status = result ? statusForStage(result.timeline, id) : 'current';
        const waiting = index > stop;
        return <div className="sequence-stage" key={id} data-stage={id} data-status={waiting ? 'waiting' : status} style={{ '--stage-delay': `${reduced ? 0 : index * (branded ? 130 : 60)}ms` } as React.CSSProperties}>
          <i>{result && !waiting ? status === 'complete' ? <Check size={16} /> : <CircleAlert size={16} /> : <span />}</i>
          <span>{stageLabel}</span><small>{result ? waiting ? 'waiting' : status : 'connecting'}</small>
          {index < 3 && <b className="sequence-connector" data-flow={index < stop} />}
        </div>;
      })}
    </div>
    <p>{label}</p>
    {result && <small className="sequence-result">{result.transactionId} · {result.rootCause}</small>}
  </output>;
}

export function BootSequence({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  return <AnimatePresence>{active && <motion.div className="boot-overlay" key="boot" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0.08 : 0.22 }}>
    <motion.div exit={{ opacity: 0, scale: reduced ? 1 : 0.94, y: reduced ? 0 : -12 }} transition={{ duration: 0.22, ease: flowEase }}>
      <TraceSequence branded label="Tracing settlement systems…" />
    </motion.div>
  </motion.div>}</AnimatePresence>;
}

export function ViewFrame({ children, view }: { children: React.ReactNode; view: AppView }) {
  const reduced = useReducedMotion();
  return <motion.div className="view-frame" data-view={view} initial={{ opacity: 0, y: reduced ? 0 : 16, scale: reduced ? 1 : 0.995 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduced ? 0 : -12, scale: reduced ? 1 : 0.995 }} transition={{ duration: reduced ? 0.08 : 0.22, ease: flowEase }}>{children}</motion.div>;
}

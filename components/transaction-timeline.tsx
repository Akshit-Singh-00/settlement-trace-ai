'use client';

import { Banknote, Database, Fingerprint, Landmark, ServerCog } from 'lucide-react';
import { motion, stagger, useReducedMotion } from 'framer-motion';
import type { PipelineStage, StageStatus, TimelineStage } from '@/lib/settlement-types';

const icons = {
  gateway: Fingerprint,
  settlement: Database,
  bank: Landmark,
  ledger: Banknote,
};

function formatDate(value?: string, timeZone?: string) {
  if (!value) return 'Timestamp unavailable';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value));
}

function formatLatency(minutes?: number) {
  if (minutes === undefined) return 'Latency unavailable';
  if (minutes < 0) return `${minutes} min · impossible order`;
  if (minutes < 60) return `${minutes} min elapsed`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m elapsed`;
}

function tone(status: StageStatus) {
  if (status === 'complete') return 'stage-complete';
  if (status === 'failed' || status === 'missing') return 'stage-failed';
  if (status === 'mismatch' || status === 'delayed') return 'stage-warning';
  return 'stage-current';
}

export function TransactionTimeline({
  timeline,
  selectedStage,
  onStageSelect,
  timeZone,
}: {
  timeline: TimelineStage[];
  selectedStage: PipelineStage;
  onStageSelect: (stage: PipelineStage) => void;
  timeZone?: string;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <section className="trace-card" aria-labelledby="timeline-title">
      <div className="panel-title">
        <span id="timeline-title"><ServerCog size={15} /> Reconciliation timeline</span>
        <small>Five events · one computed result</small>
      </div>
      <motion.div className="trace-rail" initial="hidden" animate="visible" variants={{ visible: { transition: { delayChildren: reducedMotion ? 0 : stagger(0.065) } } }}>
        {timeline.map((item, index) => {
          const Icon = icons[item.stage];
          return (
            <motion.button
              type="button"
              onClick={() => onStageSelect(item.stage)}
              className={`trace-stage ${tone(item.status)} ${selectedStage === item.stage ? 'selected' : ''}`}
              data-status={item.status}
              key={`${item.stage}-${item.label}`}
              variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
              whileTap={reducedMotion ? undefined : { scale: 0.985 }}
            >
              <div className="trace-icon"><Icon size={20} /></div>
              <span className="trace-index">0{index + 1}</span>
              <h3>{item.label}</h3>
              <strong>{item.status}</strong>
              <p>{item.evidence}</p>
              {item.anomalies?.length ? <span className="stage-anomaly">{item.anomalies[0]}</span> : null}
              <dl>
                <div><dt>Source</dt><dd>{item.source}</dd></div>
                <div><dt>Reference</dt><dd>{item.referenceId ?? 'Not issued'}</dd></div>
                <div><dt>Time</dt><dd>{formatDate(item.timestamp, timeZone)}</dd></div>
                <div><dt>Latency</dt><dd>{formatLatency(item.latencyMinutes)}</dd></div>
              </dl>
            </motion.button>
          );
        })}
      </motion.div>
    </section>
  );
}

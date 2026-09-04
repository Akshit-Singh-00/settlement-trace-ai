'use client';

import { Banknote, Database, Fingerprint, Landmark, ServerCog } from 'lucide-react';
import type { PipelineStage, StageStatus, TimelineStage } from '@/lib/settlement-types';

const icons = {
  gateway: Fingerprint,
  settlement: Database,
  bank: Landmark,
  ledger: Banknote,
};

function formatDate(value?: string) {
  if (!value) return 'Timestamp unavailable';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatLatency(minutes?: number) {
  if (minutes === undefined) return 'Latency unavailable';
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
}: {
  timeline: TimelineStage[];
  selectedStage: PipelineStage;
  onStageSelect: (stage: PipelineStage) => void;
}) {
  return (
    <section className="trace-card" aria-labelledby="timeline-title">
      <div className="panel-title">
        <span id="timeline-title"><ServerCog size={15} /> Reconciliation timeline</span>
        <small>Five events · one computed result</small>
      </div>
      <div className="trace-rail">
        {timeline.map((item, index) => {
          const Icon = icons[item.stage];
          return (
            <button
              type="button"
              onClick={() => onStageSelect(item.stage)}
              className={`trace-stage ${tone(item.status)} ${selectedStage === item.stage ? 'selected' : ''}`}
              key={`${item.stage}-${item.label}`}
            >
              <div className="trace-icon"><Icon size={20} /></div>
              <span className="trace-index">0{index + 1}</span>
              <h3>{item.label}</h3>
              <strong>{item.status}</strong>
              <p>{item.evidence}</p>
              <dl>
                <div><dt>Source</dt><dd>{item.source}</dd></div>
                <div><dt>Reference</dt><dd>{item.referenceId ?? 'Not issued'}</dd></div>
                <div><dt>Time</dt><dd>{formatDate(item.timestamp)}</dd></div>
                <div><dt>Latency</dt><dd>{formatLatency(item.latencyMinutes)}</dd></div>
              </dl>
            </button>
          );
        })}
      </div>
    </section>
  );
}

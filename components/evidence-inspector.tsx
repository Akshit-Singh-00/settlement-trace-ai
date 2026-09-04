'use client';

import { useMemo } from 'react';
import { CircleAlert, Database, FileWarning, ShieldCheck } from 'lucide-react';
import type { EvidenceGroup, PipelineStage } from '@/lib/settlement-types';

const sourceToStage: Record<EvidenceGroup['source'], PipelineStage> = {
  'Payment gateway': 'gateway',
  'Settlement system': 'settlement',
  Bank: 'bank',
  'Merchant ledger': 'ledger',
};

const stageToSource: Record<PipelineStage, EvidenceGroup['source']> = {
  gateway: 'Payment gateway',
  settlement: 'Settlement system',
  bank: 'Bank',
  ledger: 'Merchant ledger',
};

function humanize(key: string) {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').toLowerCase();
}

function displayValue(key: string, value: string | number | undefined) {
  if (value === undefined || value === '') return 'Unavailable';
  if (typeof value === 'number' && key.toLowerCase().includes('amount')) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value / 100);
  }
  if (typeof value === 'string' && (key.endsWith('At') || key.endsWith('_at'))) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
    }
  }
  return String(value);
}

export function EvidenceInspector({
  evidence,
  exceptions,
  selectedStage,
  onStageSelect,
}: {
  evidence: EvidenceGroup[];
  exceptions: string[];
  selectedStage: PipelineStage;
  onStageSelect: (stage: PipelineStage) => void;
}) {
  const activeSource = stageToSource[selectedStage];

  const group = useMemo(
    () => evidence.find((item) => item.source === activeSource) ?? evidence[0],
    [activeSource, evidence],
  );

  return (
    <section className="evidence-card" aria-labelledby="evidence-title">
      <div className="panel-title evidence-title-row">
        <span id="evidence-title"><Database size={15} /> Evidence inspector</span>
        <small>{group.records.length} source record{group.records.length === 1 ? '' : 's'}</small>
      </div>
      <div className="evidence-tabs" role="tablist" aria-label="Evidence source">
        {evidence.map((item) => (
          <button
            key={item.source}
            type="button"
            role="tab"
            aria-selected={item.source === activeSource}
            className={item.source === activeSource ? 'active' : ''}
            onClick={() => {
              onStageSelect(sourceToStage[item.source]);
            }}
          >
            {item.source}
            <span>{item.records.length}</span>
          </button>
        ))}
      </div>

      {group.records.length === 0 ? (
        <div className="evidence-empty">
          <FileWarning size={24} />
          <div>
            <strong>No matching record returned</strong>
            <p>The engine treats this absence as evidence; it never fabricates missing fields.</p>
          </div>
        </div>
      ) : (
        <div className="evidence-records">
          {group.records.map((record, recordIndex) => (
            <div className="evidence-record" key={`${group.source}-${recordIndex}`}>
              <div className="record-heading">
                <span>Record {String(recordIndex + 1).padStart(2, '0')}</span>
                <em><ShieldCheck size={13} /> synthetic source</em>
              </div>
              <dl>
                {Object.entries(record).map(([key, value]) => {
                  const attention = exceptions.some((exception) =>
                    `${key} ${exception}`.toLowerCase().match(/amount|reference|utr|multiple|conflict/),
                  );
                  return (
                    <div key={key} data-attention={attention || undefined}>
                      <dt>{humanize(key)}</dt>
                      <dd>{displayValue(key, value)}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          ))}
        </div>
      )}

      {exceptions.length > 0 && (
        <div className="evidence-warning">
          <CircleAlert size={16} /> Review highlighted identifiers against the exception list before acting.
        </div>
      )}
    </section>
  );
}

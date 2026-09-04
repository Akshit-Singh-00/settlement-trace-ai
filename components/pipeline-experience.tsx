'use client';

import { lazy, Suspense, useEffect, useState } from 'react';
import type { PipelineStage, StageStatus, TimelineStage } from '@/lib/settlement-types';

const PipelineScene = lazy(() => import('@/components/pipeline-scene'));

const labels: Array<{ id: PipelineStage; label: string }> = [
  { id: 'gateway', label: 'Gateway' },
  { id: 'settlement', label: 'Settlement' },
  { id: 'bank', label: 'Bank' },
  { id: 'ledger', label: 'Ledger' },
];

function statusForStage(timeline: TimelineStage[], stage: PipelineStage): StageStatus {
  const matches = timeline.filter((item) => item.stage === stage);
  return matches.find((item) => item.status !== 'complete')?.status ?? matches.at(-1)?.status ?? 'pending';
}

function PipelineFallback({
  timeline,
  selectedStage,
  onStageSelect,
}: {
  timeline: TimelineStage[];
  selectedStage: PipelineStage;
  onStageSelect: (stage: PipelineStage) => void;
}) {
  return (
    <div className="pipeline-fallback" aria-label="Settlement pipeline status">
      {labels.map((stage, index) => {
        const status = statusForStage(timeline, stage.id);
        return (
          <button
            type="button"
            key={stage.id}
            className={selectedStage === stage.id ? 'selected' : ''}
            data-status={status}
            onClick={() => onStageSelect(stage.id)}
          >
            <i />
            <strong>{stage.label}</strong>
            <span>{status}</span>
            {index < labels.length - 1 && <b aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

export function PipelineExperience({
  timeline,
  selectedStage,
  onStageSelect,
}: {
  timeline: TimelineStage[];
  selectedStage: PipelineStage;
  onStageSelect: (stage: PipelineStage) => void;
}) {
  const [supports3d, setSupports3d] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const constrained = window.innerWidth < 640 || (navigator.hardwareConcurrency ?? 4) <= 2;
      if (reduced || constrained) return;
      const testCanvas = document.createElement('canvas');
      const context = testCanvas.getContext('webgl2') ?? testCanvas.getContext('webgl');
      setSupports3d(Boolean(context));
      context?.getExtension('WEBGL_lose_context')?.loseContext();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!supports3d) {
    return <PipelineFallback timeline={timeline} selectedStage={selectedStage} onStageSelect={onStageSelect} />;
  }

  return (
    <Suspense fallback={<PipelineFallback timeline={timeline} selectedStage={selectedStage} onStageSelect={onStageSelect} />}>
      <PipelineScene timeline={timeline} selectedStage={selectedStage} onStageSelect={onStageSelect} />
    </Suspense>
  );
}

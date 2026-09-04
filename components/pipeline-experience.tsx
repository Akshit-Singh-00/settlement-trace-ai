'use client';

import { lazy, Suspense, useEffect, useState } from 'react';
import { useTheme } from '@/components/theme-provider';
import type { PipelineStage, TimelineStage } from '@/lib/settlement-types';
import { pipelineStages as labels, statusForStage } from '@/lib/pipeline-presentation';

const PipelineScene = lazy(() => import('@/components/pipeline-scene'));

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
  transactionId,
}: {
  timeline: TimelineStage[];
  selectedStage: PipelineStage;
  onStageSelect: (stage: PipelineStage) => void;
  transactionId: string;
}) {
  const [supports3d, setSupports3d] = useState(false);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const narrow = window.matchMedia('(max-width: 639px)');
    let webgl: boolean | undefined;
    const update = () => {
      if (motionPreference.matches || narrow.matches || (navigator.hardwareConcurrency ?? 4) <= 2) {
        setSupports3d(false);
        return;
      }
      if (webgl !== undefined) { setSupports3d(webgl); return; }
      const testCanvas = document.createElement('canvas');
      const context = testCanvas.getContext('webgl2') ?? testCanvas.getContext('webgl');
      webgl = Boolean(context);
      setSupports3d(webgl);
      context?.getExtension('WEBGL_lose_context')?.loseContext();
    };
    const frame = requestAnimationFrame(update);
    motionPreference.addEventListener('change', update);
    narrow.addEventListener('change', update);
    return () => { cancelAnimationFrame(frame); motionPreference.removeEventListener('change', update); narrow.removeEventListener('change', update); };
  }, []);

  if (!supports3d) {
    return <PipelineFallback timeline={timeline} selectedStage={selectedStage} onStageSelect={onStageSelect} />;
  }

  return (
    <Suspense fallback={<PipelineFallback timeline={timeline} selectedStage={selectedStage} onStageSelect={onStageSelect} />}>
      <PipelineScene timeline={timeline} selectedStage={selectedStage} onStageSelect={onStageSelect} theme={resolvedTheme} transactionId={transactionId} />
    </Suspense>
  );
}

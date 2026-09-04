import type { PipelineStage, StageStatus, TimelineStage } from './settlement-types';

export const pipelineStages: Array<{ id: PipelineStage; label: string }> = [
  { id: 'gateway', label: 'Gateway' },
  { id: 'settlement', label: 'Settlement' },
  { id: 'bank', label: 'Bank' },
  { id: 'ledger', label: 'Ledger' },
];

// Presentation only: consume the engine's existing stage statuses, never reclassify evidence.
export function statusForStage(timeline: TimelineStage[], stage: PipelineStage): StageStatus {
  const matches = timeline.filter((item) => item.stage === stage);
  return matches.find((item) => item.status !== 'complete')?.status ?? matches.at(-1)?.status ?? 'pending';
}

export function traceStopIndex(timeline: TimelineStage[]) {
  const index = pipelineStages.findIndex(({ id }) => statusForStage(timeline, id) !== 'complete');
  return index < 0 ? pipelineStages.length - 1 : index;
}

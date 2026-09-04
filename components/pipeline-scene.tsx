'use client';

import { Html, Line, RoundedBox, Sparkles } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { PipelineStage, StageStatus, TimelineStage } from '@/lib/settlement-types';

const pipelineStages: Array<{ id: PipelineStage; label: string; short: string }> = [
  { id: 'gateway', label: 'Payment Gateway', short: 'Gateway' },
  { id: 'settlement', label: 'Settlement Batch', short: 'Settlement' },
  { id: 'bank', label: 'Bank Record', short: 'Bank' },
  { id: 'ledger', label: 'Merchant Ledger', short: 'Ledger' },
];

const positions: [number, number, number][] = [
  [-4.6, 0.35, 0],
  [-1.55, -0.35, 0.2],
  [1.55, 0.42, -0.1],
  [4.6, -0.15, 0.15],
];

const statusColors: Record<StageStatus, string> = {
  complete: '#50e6a5',
  current: '#67e8f9',
  pending: '#5594b8',
  delayed: '#ffbe6b',
  failed: '#ff657a',
  missing: '#ff657a',
  mismatch: '#c58cff',
};

function statusForStage(timeline: TimelineStage[], stage: PipelineStage): StageStatus {
  const matches = timeline.filter((item) => item.stage === stage);
  return matches.find((item) => item.status !== 'complete')?.status ?? matches.at(-1)?.status ?? 'pending';
}

function FlowParticle({
  start,
  end,
  color,
  delay,
}: {
  start: THREE.Vector3;
  end: THREE.Vector3;
  color: string;
  delay: number;
}) {
  const particle = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!particle.current) return;
    const progress = (clock.elapsedTime * 0.22 + delay) % 1;
    particle.current.position.lerpVectors(start, end, progress);
    particle.current.position.y += Math.sin(progress * Math.PI) * 0.3;
  });

  return (
    <mesh ref={particle}>
      <sphereGeometry args={[0.055, 12, 12]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

function StageNode({
  position,
  label,
  short,
  status,
  selected,
  onSelect,
}: {
  position: [number, number, number];
  label: string;
  short: string;
  status: StageStatus;
  selected: boolean;
  onSelect: () => void;
}) {
  const group = useRef<THREE.Group>(null);
  const color = statusColors[status];

  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.position.y = position[1] + Math.sin(clock.elapsedTime * 0.75 + position[0]) * 0.08;
    group.current.rotation.y = Math.sin(clock.elapsedTime * 0.3 + position[0]) * 0.05;
  });

  return (
    <group
      ref={group}
      position={position}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <RoundedBox args={[2.12, 1.2, 0.52]} radius={0.18} smoothness={4}>
        <meshPhysicalMaterial
          color={selected ? '#122d42' : '#081625'}
          emissive={color}
          emissiveIntensity={selected ? 0.22 : 0.08}
          metalness={0.42}
          roughness={0.34}
          transparent
          opacity={0.96}
        />
      </RoundedBox>
      <mesh position={[0, 0, 0.3]}>
        <torusGeometry args={[0.22, 0.026, 10, 36]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, 0.3]}>
        <sphereGeometry args={[0.082, 16, 16]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {selected && (
        <mesh position={[0, 0, -0.08]}>
          <ringGeometry args={[0.82, 0.86, 48]} />
          <meshBasicMaterial color={color} transparent opacity={0.2} side={THREE.DoubleSide} />
        </mesh>
      )}
      <Html center position={[0, -0.85, 0.42]} distanceFactor={8.4} transform>
        <button className="node-label3d" type="button" onClick={onSelect} aria-label={`Inspect ${label}`}>
          <strong>{short}</strong>
          <span data-status={status}>{status}</span>
        </button>
      </Html>
    </group>
  );
}

function Scene({
  timeline,
  selectedStage,
  onStageSelect,
}: {
  timeline: TimelineStage[];
  selectedStage: PipelineStage;
  onStageSelect: (stage: PipelineStage) => void;
}) {
  const scene = useRef<THREE.Group>(null);
  const vectors = useMemo(() => positions.map((position) => new THREE.Vector3(...position)), []);

  useFrame(({ clock }) => {
    if (!scene.current) return;
    scene.current.rotation.y = Math.sin(clock.elapsedTime * 0.16) * 0.035;
    scene.current.rotation.x = Math.sin(clock.elapsedTime * 0.12) * 0.02;
  });

  return (
    <>
      <ambientLight intensity={0.72} />
      <pointLight position={[-3, 4, 5]} intensity={38} color="#55dfff" distance={13} />
      <pointLight position={[5, -2, 4]} intensity={24} color="#8b5cff" distance={12} />
      <Sparkles count={48} scale={[11, 4, 3]} size={1.4} speed={0.28} color="#80eaff" opacity={0.42} />
      <group ref={scene}>
        {pipelineStages.slice(0, -1).map((stage, index) => {
          const nextStatus = statusForStage(timeline, pipelineStages[index + 1].id);
          const color = statusColors[nextStatus];
          const from = vectors[index];
          const to = vectors[index + 1];
          const points: [number, number, number][] = [
            [from.x + 1.02, from.y, from.z],
            [(from.x + to.x) / 2, Math.max(from.y, to.y) + 0.48, 0],
            [to.x - 1.02, to.y, to.z],
          ];
          const flowAllowed = !['failed', 'missing', 'mismatch', 'delayed'].includes(nextStatus);
          return (
            <group key={stage.id}>
              <Line points={points} color={color} lineWidth={1.15} transparent opacity={0.48} />
              {flowAllowed && (
                <>
                  <FlowParticle start={vectors[index]} end={vectors[index + 1]} color={color} delay={0} />
                  <FlowParticle start={vectors[index]} end={vectors[index + 1]} color={color} delay={0.48} />
                </>
              )}
            </group>
          );
        })}
        {pipelineStages.map((stage, index) => (
          <StageNode
            key={stage.id}
            position={positions[index]}
            label={stage.label}
            short={stage.short}
            status={statusForStage(timeline, stage.id)}
            selected={selectedStage === stage.id}
            onSelect={() => onStageSelect(stage.id)}
          />
        ))}
      </group>
    </>
  );
}

export default function PipelineScene({
  timeline,
  selectedStage,
  onStageSelect,
}: {
  timeline: TimelineStage[];
  selectedStage: PipelineStage;
  onStageSelect: (stage: PipelineStage) => void;
}) {
  return (
    <Canvas
      camera={{ position: [0, 1.2, 11.6], fov: 43 }}
      dpr={[1, 1.45]}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => gl.setClearColor('#000000', 0)}
    >
      <Scene timeline={timeline} selectedStage={selectedStage} onStageSelect={onStageSelect} />
    </Canvas>
  );
}

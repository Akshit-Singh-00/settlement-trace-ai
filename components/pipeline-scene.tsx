'use client';

import { Html, Line, RoundedBox, Sparkles } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { PipelineStage, StageStatus, TimelineStage } from '@/lib/settlement-types';
import { statusForStage, traceStopIndex } from '@/lib/pipeline-presentation';

const pipelineStages: Array<{ id: PipelineStage; label: string; short: string }> = [
  { id: 'gateway', label: 'Payment Gateway', short: 'Gateway' },
  { id: 'settlement', label: 'Settlement Batch', short: 'Settlement' },
  { id: 'bank', label: 'Bank Record', short: 'Bank' },
  { id: 'ledger', label: 'Merchant Ledger', short: 'Ledger' },
];

const positions: [number, number, number][] = [
  [-3.18, 0.35, 0],
  [-1.06, -0.35, 0.2],
  [1.06, 0.42, -0.1],
  [3.18, -0.15, 0.15],
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

function FlowParticle({
  start,
  end,
  color,
  delay,
  speed,
}: {
  start: THREE.Vector3;
  end: THREE.Vector3;
  color: string;
  delay: number;
  speed: number;
}) {
  const particle = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!particle.current) return;
    const progress = (clock.elapsedTime * speed + delay) % 1;
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
  theme,
}: {
  position: [number, number, number];
  label: string;
  short: string;
  status: StageStatus;
  selected: boolean;
  onSelect: () => void;
  theme: 'light' | 'dark';
}) {
  const group = useRef<THREE.Group>(null);
  const material = useRef<THREE.MeshPhysicalMaterial>(null);
  const [hovered, setHovered] = useState(false);
  const color = statusColors[status];

  const targetColor = useMemo(() => new THREE.Color(theme === 'dark' ? (selected ? '#122d42' : '#081625') : (selected ? '#d8f3fa' : '#f4f8fb')), [theme, selected]);
  useFrame(({ clock }, delta) => {
    material.current?.color.lerp(targetColor, 1 - Math.exp(-delta * 10));
    if (!group.current) return;
    const desiredY = position[1] + (hovered ? 0.13 : 0) + Math.sin(clock.elapsedTime * 0.75 + position[0]) * 0.06;
    group.current.position.y = THREE.MathUtils.lerp(group.current.position.y, desiredY, 0.12);
    group.current.rotation.y = Math.sin(clock.elapsedTime * 0.25 + position[0]) * 0.025;
  });

  return (
    <group
      ref={group}
      position={position}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onPointerOver={(event) => { event.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = ''; }}
    >
      <RoundedBox args={[1.78, 1.14, 0.52]} radius={0.18} smoothness={4}>
        <meshPhysicalMaterial
          ref={material}
          emissive={color}
          emissiveIntensity={selected ? 0.22 : 0.08}
          metalness={theme === 'dark' ? 0.42 : 0.12}
          roughness={theme === 'dark' ? 0.34 : 0.62}
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
  theme,
  transactionId,
}: {
  timeline: TimelineStage[];
  selectedStage: PipelineStage;
  onStageSelect: (stage: PipelineStage) => void;
  theme: 'light' | 'dark';
  transactionId: string;
}) {
  const scene = useRef<THREE.Group>(null);
  const entrance = useRef(0);
  const { camera, size } = useThree();
  const vectors = useMemo(() => positions.map((position) => new THREE.Vector3(...position)), []);
  const selectedIndex = pipelineStages.findIndex((stage) => stage.id === selectedStage);
  const targetCamera = useMemo(() => new THREE.Vector3((selectedIndex - 1.5) * 0.22, 1.2, 11.6), [selectedIndex]);

  useEffect(() => { entrance.current = 0; }, [transactionId]);
  useEffect(() => {
    // Keep the same readable scene scale in a wide workspace and a square hero.
    // oxlint-disable-next-line react/react-compiler -- Three.js cameras are mutable scene objects, not React state.
    camera.zoom = Math.min(2.1, Math.max(1, size.width / size.height / 1.35));
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);

  useFrame((_, delta) => {
    if (!scene.current) return;
    entrance.current = Math.min(1, entrance.current + delta * 3.5);
    const eased = 1 - Math.pow(1 - entrance.current, 3);
    scene.current.scale.setScalar(0.94 + eased * 0.06);
    camera.position.lerp(targetCamera, 1 - Math.exp(-delta * 3.8));
    camera.lookAt((selectedIndex - 1.5) * 0.12, 0, 0);
  });

  return (
    <>
      <ambientLight intensity={theme === 'dark' ? 0.72 : 1.45} />
      <pointLight position={[-3, 4, 5]} intensity={theme === 'dark' ? 38 : 24} color="#55dfff" distance={13} />
      <pointLight position={[5, -2, 4]} intensity={theme === 'dark' ? 24 : 15} color="#8b5cff" distance={12} />
      <Sparkles count={theme === 'dark' ? 36 : 22} scale={[11, 4, 3]} size={theme === 'dark' ? 1.25 : 0.85} speed={0.22} color={theme === 'dark' ? '#80eaff' : '#0e7490'} opacity={theme === 'dark' ? 0.35 : 0.18} />
      <group ref={scene} key={transactionId}>
        {pipelineStages.slice(0, -1).map((stage, index) => {
          const nextStatus = statusForStage(timeline, pipelineStages[index + 1].id);
          const color = statusColors[nextStatus];
          const from = vectors[index];
          const to = vectors[index + 1];
          const points: [number, number, number][] = [
            [from.x + 0.86, from.y, from.z],
            [(from.x + to.x) / 2, Math.max(from.y, to.y) + 0.48, 0],
            [to.x - 0.86, to.y, to.z],
          ];
          const flowAllowed = index < traceStopIndex(timeline) && !['failed', 'missing', 'mismatch', 'delayed'].includes(nextStatus);
          const flowSpeed = ['current', 'pending'].includes(nextStatus) ? 0.13 : 0.24;
          return (
            <group key={stage.id}>
              <Line points={points} color={color} lineWidth={1.15} transparent opacity={0.48} />
              {flowAllowed && (
                <>
                  <FlowParticle start={vectors[index]} end={vectors[index + 1]} color={color} delay={0} speed={flowSpeed} />
                  <FlowParticle start={vectors[index]} end={vectors[index + 1]} color={color} delay={0.48} speed={flowSpeed} />
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
            theme={theme}
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
  theme,
  transactionId,
}: {
  timeline: TimelineStage[];
  selectedStage: PipelineStage;
  onStageSelect: (stage: PipelineStage) => void;
  theme: 'light' | 'dark';
  transactionId: string;
}) {
  return (
    <Canvas
      camera={{ position: [0, 1.2, 11.6], fov: 43 }}
      dpr={[1, 1.45]}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => gl.setClearColor('#000000', 0)}
    >
      <Scene timeline={timeline} selectedStage={selectedStage} onStageSelect={onStageSelect} theme={theme} transactionId={transactionId} />
    </Canvas>
  );
}

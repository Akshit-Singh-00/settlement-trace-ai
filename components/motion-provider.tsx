'use client';

import { MotionConfig } from 'framer-motion';
import { flowEase } from '@/components/motion-system';

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user" transition={{ duration: 0.24, ease: flowEase }}>{children}</MotionConfig>;
}

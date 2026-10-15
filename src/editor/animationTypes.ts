import type { AnimationDefinition, AnimationKind } from '../game/types.ts';

export type AnimationBackground = 'magenta' | 'green' | 'keep';
export interface GenerationRequest {
  source: string;
  sourceRevision: string;
  kind: AnimationKind;
  prompt: string;
  duration: 2 | 3 | 5;
  background: AnimationBackground;
}
export interface VideoProcessing {
  trimStart: number;
  trimEnd: number;
  fps: number;
  keySimilarity: number;
}
export interface SourceInfo {
  width: number;
  height: number;
  revision: string;
}
export interface AnimationServiceInfo {
  configured: boolean;
  model: string;
  processorAvailable: boolean;
}
export interface AnimationJob {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  request: GenerationRequest;
  phase: string;
  requestId?: string;
  error?: string;
  video?: string;
  result?: AnimationDefinition;
}

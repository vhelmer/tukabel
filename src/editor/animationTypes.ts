import type {
  AnimationDefinition,
  AnimationGeneration,
  AnimationKind,
  ImageRegion,
} from '../game/types.ts';

export interface GenerationRequest {
  source: string;
  sourceRevision: string;
  kind: AnimationKind;
  prompt: string;
  frameCount: number;
  quality: AnimationGeneration['quality'];
  mode: AnimationGeneration['mode'];
  region?: ImageRegion;
  frameIndex?: number;
  targetAnimationId?: string;
}
export interface SourceInfo {
  width: number;
  height: number;
  revision: string;
}
export interface AnimationServiceInfo {
  configured: boolean;
  model: string;
}
export interface AnimationJob {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  request: GenerationRequest;
  completed: number;
  total: number;
  error?: string;
  result?: {
    id: string;
    source: string;
    kind: AnimationKind;
    frames: string[];
    generation: AnimationGeneration;
  };
}
export type AnimationCandidate = AnimationDefinition;

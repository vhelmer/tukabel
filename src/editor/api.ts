import type { GameContent } from '../game/types';

export interface ProjectResponse {
  content: GameContent;
  revision: string;
  assets: string[];
}
async function request<T>(
  url: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/__tukabel/editor/${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Tukabel-Editor': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error([data.error, ...(data.errors ?? [])].join('\n'));
  return data as T;
}
export const readProject = () => request<ProjectResponse>('project');
export const writeProject = (content: GameContent, revision: string) =>
  request<{ revision: string }>('project', 'PUT', { content, revision });
export async function importAsset(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > 6 * 1024 * 1024)
    throw new Error('Obrázek může mít nejvýše 6 MB.');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return request<{ id: string; assets: string[] }>('assets', 'POST', {
    name: file.name,
    data: btoa(binary),
  });
}

export async function importAnimationFiles(input: {
  source: string;
  label: string;
  kind: import('../game/types').AnimationKind;
  fps: number;
  files: File[];
  atlas?: unknown;
  animationName?: string;
}) {
  if (
    input.files.reduce((size, file) => size + file.size, 0) >
    32 * 1024 * 1024
  )
    throw new Error('Import může mít společně nejvýše 32 MB.');
  const files = await Promise.all(
    input.files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      return { name: file.name, data: btoa(binary) };
    }),
  );
  return request<{
    animation: import('../game/types').AnimationDefinition;
    assets: string[];
  }>('animations/import', 'POST', { ...input, files });
}

export const detectRegion = (source: string, frames: readonly string[]) =>
  request<{ region: import('../game/types').AnimationRegion | null }>(
    'animations/region',
    'POST',
    { source, frames },
  );

export interface SpeechCatalog {
  voices: { id: string; label: string }[];
  hasMore: boolean;
  models: {
    id: string;
    label: string;
    style: boolean;
    speakerBoost: boolean;
    languages: string[];
    audioTags: boolean;
    speed: boolean;
    maxCharacters: number | null;
  }[];
}
export const getSpeechStatus = () =>
  request<{ elevenLabs: boolean; rhubarb: boolean }>('speech/status');
export const getSpeechCatalog = () =>
  request<SpeechCatalog>('speech/catalog', 'POST', {});
export const generateSpeech = (
  text: string,
  voice: import('../game/types').VoiceSettings,
  subtitle?: string,
) =>
  request<import('../game/types').DialogueSpeech & { assets: string[] }>(
    'speech/generate',
    'POST',
    { text, voice, subtitle, confirmed: true },
  );
export const analyzeSpeech = (audio: string) =>
  request<{ lipSync: string; assets: string[] }>('speech/analyze', 'POST', {
    audio,
  });
export async function uploadSpeech(
  text: string,
  file: File,
  subtitle?: string,
) {
  if (file.size > 20 * 1024 * 1024)
    throw new Error('WAV může mít nejvýše 20 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return request<import('../game/types').DialogueSpeech & { assets: string[] }>(
    'speech/import',
    'POST',
    { text, subtitle, data: btoa(binary) },
  );
}

export interface ArtworkResult {
  operation: 'cutout' | 'loop' | 'edit' | 'extract' | 'remove' | 'generate';
  source: string;
  image: string;
  cutout?: string;
  cutoutFull?: string;
  cutoutFrame?: import('../game/transforms').CropFrame;
  backgrounds?: { restored: string; masked: string };
  animation?: import('../game/types').AnimationDefinition;
  width: number;
  height: number;
  manifest: string;
  objectMask?: string;
  original?: string;
  reassembled?: string;
  difference?: string;
  repairMask?: string;
  model?: string;
  quality?: import('./artSettings').ImageQuality;
  debugOnly?: boolean;
  blockedReason?: string;
  debug?: import('./inpaintDebug').InpaintDebug;
  reconstruction?: {
    changedPixels: number;
    selectedPixels: number;
    cleanupPixels?: number;
    unexpectedPixels?: number;
    edgePixels?: number;
  };
  assets: string[];
}
export const getArtStatus = () =>
  request<{
    configured: boolean;
    model: string;
    quality: import('./artSettings').ImageQuality;
    segmentation: {
      grabcut: boolean;
      sam2: boolean;
      sam3?: boolean;
      vitmatte?: boolean;
      closedForm?: boolean;
    };
  }>('art/status');
export const listEditorJobs = () =>
  request<{ jobs: import('./jobs').EditorJob[] }>('jobs');
export const submitEditorJob = (input: {
  kind: 'art' | 'animation' | 'codex';
  label: string;
  context:
    | import('./jobs').ArtContext
    | import('./jobs').AnimationContext
    | import('./codex').CodexContext;
  input: unknown;
}) => request<import('./jobs').EditorJob>('jobs', 'POST', input);
export const editorJobAction = (id: string, action: 'cancel' | 'dismiss') =>
  request(`jobs/${id}/${action}`, 'POST', {});
export const getDirectionStatus = () =>
  request<{ configured: boolean; model: string }>(
    'animations/direction/status',
  );
export const getCodexStatus = () =>
  request<import('./codex').CodexStatus>('codex/status');

export const getMaskSource = (source: string) =>
  request<import('./masks').MaskSource>('art/source', 'POST', { source });
export const segmentMask = (
  source: string,
  mask: import('./masks').ObjectMask,
  seeds: string,
  method: 'grabcut' | 'sam2' | 'sam3',
  refineEdges = true,
  detailPass = false,
) =>
  request<import('./masks').ObjectMask>('art/segment', 'POST', {
    source,
    mask,
    seeds,
    method,
    refineEdges,
    detailPass,
  });
export const matteMask = (
  source: string,
  mask: import('./masks').ObjectMask,
  seeds: string,
  settings: import('./masks').MattingSettings,
) =>
  request<import('./masks').MattingResult>('art/matte', 'POST', {
    source,
    mask,
    seeds,
    ...settings,
  });

export const getArtworkHistory = (source: string) =>
  request<{ results: ArtworkResult[]; assets: string[] }>(
    'art/history',
    'POST',
    { source },
  );

import type { CharacterAnimation, LipSyncTrack, MouthShape } from './types.ts';

export const mouthShapes: readonly MouthShape[] = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'X',
];
export const defaultVoice = {
  voiceId: '',
  modelId: 'eleven_multilingual_v2',
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  speed: 1,
  useSpeakerBoost: true,
};
// /v1/models exposes style/boost/languages, but not audio-tag or speed support.
// These documented exceptions are shared by the editor and server.
export function modelFeatures(id: string) {
  const expressive = /^eleven_v[34](?:_|$)/.test(id);
  return {
    audioTags: [
      'eleven_v3',
      'eleven_v4',
      'eleven_v4_turbo',
      'eleven_v3_conversational',
    ].includes(id),
    speed: !expressive,
    discreteStability: id.startsWith('eleven_v3'),
    expressive,
  };
}
export const suggestedModels = [
  { id: 'eleven_v4', label: 'Eleven v4' },
  { id: 'eleven_v4_turbo', label: 'Eleven v4 Turbo' },
  { id: 'eleven_v3', label: 'Eleven v3' },
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2' },
  { id: 'eleven_flash_v2_5', label: 'Flash v2.5' },
  { id: 'eleven_turbo_v2_5', label: 'Turbo v2.5' },
];
export function lipSyncIssue(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return 'Expected Rhubarb JSON';
  const track = value as LipSyncTrack;
  const duration = track.metadata?.duration;
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 180 ||
    !Array.isArray(track.mouthCues) ||
    !track.mouthCues.length ||
    track.mouthCues.length > 20000
  )
    return 'Invalid lip-sync duration or cues';
  let previous = 0;
  for (const cue of track.mouthCues) {
    if (
      !cue ||
      !Number.isFinite(cue.start) ||
      !Number.isFinite(cue.end) ||
      cue.start < previous - 0.0001 ||
      cue.end <= cue.start ||
      cue.end > duration + 0.02 ||
      !mouthShapes.includes(cue.value)
    )
      return 'Invalid or overlapping Rhubarb cues';
    previous = cue.end;
  }
}
export function mouthShapeAt(track: LipSyncTrack, timeMs: number): MouthShape {
  const seconds = timeMs / 1000;
  // Tracks are short dialogue lines; binary search avoids scanning every cue per frame.
  let low = 0,
    high = track.mouthCues.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1,
      cue = track.mouthCues[middle]!;
    if (seconds < cue.start) high = middle - 1;
    else if (seconds >= cue.end) low = middle + 1;
    else return cue.value;
  }
  return 'X';
}
export function mouthFrame(
  binding: CharacterAnimation,
  shape: MouthShape,
): number {
  const map = binding.mouthShapes ?? {};
  if (map[shape] !== undefined) return map[shape];
  if (shape === 'X' || shape === 'A') return map.X ?? map.A ?? 0;
  return map.C ?? map.B ?? map.X ?? 0;
}

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export function voiceIssue(value: unknown): string | undefined {
  if (
    !object(value) ||
    typeof value.voiceId !== 'string' ||
    typeof value.modelId !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(String(value.voiceId)) ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(String(value.modelId))
  )
    return 'Vyber platné ID hlasu a modelu.';
  if (
    value.designRegistration !== undefined &&
    (typeof value.designRegistration !== 'string' ||
      !/^speech\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/registration\.json$/.test(
        value.designRegistration,
      ))
  )
    return 'Vyber platný lokální archiv registrace hlasu.';
  if (
    value.slot !== undefined &&
    value.slot !== 'static' &&
    value.slot !== 'rotating'
  )
    return 'Neplatný typ hlasového slotu.';
  if (value.retired !== undefined && value.retired !== true)
    return 'Neplatný stav uvolněného hlasu.';
  if (
    value.retired === true &&
    (value.slot !== 'rotating' ||
      !value.designRegistration ||
      !value.retirementManifest)
  )
    return 'Uvolněný hlas vyžaduje rotující slot a archiv registrace i uvolnění.';
  if (
    value.retirementManifest !== undefined &&
    (value.retired !== true ||
      typeof value.retirementManifest !== 'string' ||
      !/^speech\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/retirement\.json$/.test(
        value.retirementManifest,
      ))
  )
    return 'Vyber platný lokální archiv uvolnění hlasu.';
  for (const key of ['stability', 'similarityBoost', 'style', 'speed']) {
    const n = value[key];
    if (
      typeof n !== 'number' ||
      !Number.isFinite(n) ||
      n < (key === 'speed' ? 0.7 : 0) ||
      n > (key === 'speed' ? 1.2 : 1)
    )
      return 'Neplatné parametre hlasu.';
  }
  if (
    String(value.modelId).startsWith('eleven_v3') &&
    ![0, 0.5, 1].includes(Number(value.stability))
  )
    return 'Eleven v3 používa stabilitu 0, 0.5 alebo 1.';
  if (typeof value.useSpeakerBoost !== 'boolean')
    return 'Neplatné parametre hlasu.';
}

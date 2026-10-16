import type {
  DialogueNode,
  SpeechAlignment,
  SubtitleCue,
  SubtitleTrack,
} from './types.ts';

export function stripAudioTags(text: string): string {
  let depth = 0,
    result = '';
  for (const char of text) {
    if (char === '[') {
      depth++;
      continue;
    }
    if (char === ']') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (!depth) result += char;
  }
  return result
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,.;:!?])/gu, '$1')
    .trim();
}
export function subtitleText(
  node: Pick<DialogueNode, 'text' | 'subtitle'>,
): string {
  return node.subtitle?.trim() || stripAudioTags(node.text);
}

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export function alignmentIssue(value: unknown): string | undefined {
  if (!object(value) || !object(value.metadata))
    return 'Invalid speech alignment';
  const {
    characters,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  } = value;
  const duration = value.metadata.duration;
  if (
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 180 ||
    !Array.isArray(characters) ||
    !characters.length ||
    characters.length > 50000 ||
    !Array.isArray(starts) ||
    !Array.isArray(ends) ||
    starts.length !== characters.length ||
    ends.length !== characters.length
  )
    return 'Invalid speech alignment arrays or duration';
  let previousStart = 0,
    previousEnd = 0;
  for (let i = 0; i < characters.length; i++) {
    const start: unknown = starts[i],
      end: unknown = ends[i],
      char: unknown = characters[i];
    if (
      typeof char !== 'string' ||
      !char.length ||
      char.length > 256 ||
      typeof start !== 'number' ||
      typeof end !== 'number' ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < previousStart ||
      end < previousEnd ||
      end < start ||
      end > duration + 0.02
    )
      return 'Invalid speech alignment timestamps';
    previousStart = start;
    previousEnd = end;
  }
}
export function subtitleTrackIssue(
  value: unknown,
  duration = 180,
): string | undefined {
  if (
    !object(value) ||
    Object.keys(value).some((k) => !['text', 'timing', 'cues'].includes(k)) ||
    typeof value.text !== 'string' ||
    value.text.length > 10000 ||
    !['alignment', 'estimated', 'manual'].includes(String(value.timing)) ||
    !Array.isArray(value.cues) ||
    value.cues.length > 500
  )
    return 'Invalid subtitle track';
  let end = 0;
  for (const cue of value.cues) {
    if (
      !object(cue) ||
      Object.keys(cue).some((k) => !['start', 'end', 'text'].includes(k)) ||
      typeof cue.start !== 'number' ||
      typeof cue.end !== 'number' ||
      !Number.isFinite(cue.start) ||
      !Number.isFinite(cue.end) ||
      cue.start < end - 0.0001 ||
      cue.end <= cue.start ||
      cue.end > duration + 0.02 ||
      typeof cue.text !== 'string' ||
      !cue.text.trim() ||
      cue.text.length > 2000
    )
      return 'Invalid or overlapping subtitle cues';
    end = cue.end;
  }
}

// Prefer punctuation, keep whole words, and bound the amount of text on screen.
export function subtitleChunks(text: string): string[] {
  const words = text.trim().split(/\s+/u).filter(Boolean),
    chunks: string[] = [];
  let current = '';
  for (const word of words) {
    if (
      current &&
      (current.length + word.length + 1 > 78 ||
        (current.length >= 24 && /[.!?…]["”»)]?$/u.test(current)) ||
        (current.length >= 50 && /[,;:]["”»)]?$/u.test(current)))
    ) {
      chunks.push(current);
      current = '';
    }
    current += (current ? ' ' : '') + word;
  }
  if (current) chunks.push(current);
  return chunks;
}
const comparable = (char: string) =>
  char.normalize('NFKC').toLocaleLowerCase('sk').replace(/\s/gu, '');
function alignedCharacters(alignment: SpeechAlignment) {
  let depth = 0;
  return alignment.characters.flatMap((part, index) =>
    [...part].flatMap((char) => {
      if (char === '[') {
        depth++;
        return [];
      }
      if (char === ']') {
        depth = Math.max(0, depth - 1);
        return [];
      }
      if (depth || !comparable(char)) return [];
      return [...comparable(char)].map((text) => ({
        text,
        start: alignment.character_start_times_seconds[index]!,
        end: alignment.character_end_times_seconds[index]!,
      }));
    }),
  );
}
export function buildSubtitles(
  text: string,
  duration: number,
  alignment?: SpeechAlignment,
): SubtitleTrack {
  const chunks = subtitleChunks(text);
  if (!Number.isFinite(duration) || duration <= 0)
    return { text, timing: 'estimated', cues: [] };
  const chars =
    alignment && !alignmentIssue(alignment)
      ? alignedCharacters(alignment)
      : undefined;
  // Never pretend that translated/rewritten subtitles match provider characters.
  if (
    chars?.length &&
    chars.map((c) => c.text).join('') === [...text].map(comparable).join('')
  ) {
    let cursor = 0;
    const cues = chunks.map((chunk) => {
      const size = [...[...chunk].map(comparable).join('')].length;
      const start = chars[cursor]!.start;
      cursor += size;
      return {
        start,
        end: Math.min(
          duration,
          Math.max(start + 0.001, chars[cursor - 1]!.end),
        ),
        text: chunk,
      };
    });
    if (!subtitleTrackIssue({ text, timing: 'alignment', cues }, duration))
      return { text, timing: 'alignment', cues };
  }
  const weight = (chunk: string) => Math.max(1, [...chunk].length);
  const total = chunks.reduce((sum, chunk) => sum + weight(chunk), 0);
  let elapsed = 0;
  return {
    text,
    timing: 'estimated',
    cues: chunks.map((chunk) => {
      const start = elapsed;
      elapsed += (duration * weight(chunk)) / total;
      return { start, end: Math.min(duration, elapsed), text: chunk };
    }),
  };
}
export function subtitleAt(
  cues: readonly SubtitleCue[],
  seconds: number,
): string {
  return (
    cues.find((cue) => seconds >= cue.start && seconds < cue.end)?.text ?? ''
  );
}

export function splitSubtitle(cue: SubtitleCue, caret?: number): SubtitleCue[] {
  let at = caret ?? 0;
  if (at <= 0 || at >= cue.text.length) {
    const spaces = [...cue.text.matchAll(/\s+/gu)].map((m) => m.index);
    at =
      spaces.sort(
        (a, b) =>
          Math.abs(a - cue.text.length / 2) - Math.abs(b - cue.text.length / 2),
      )[0] ?? 0;
  }
  if (at <= 0 || at >= cue.text.length) return [cue];
  const left = cue.text.slice(0, at).trim(),
    right = cue.text.slice(at).trim();
  if (!left || !right) return [cue];
  const middle =
    cue.start +
    ((cue.end - cue.start) * left.length) / (left.length + right.length);
  return [
    { start: cue.start, end: middle, text: left },
    { start: middle, end: cue.end, text: right },
  ];
}

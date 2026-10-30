// Recorded Slovak voices for the kids' remarks. The manifest is keyed `${cue}-${index}`
// into LINES; a line whose text changed since recording stays silent and falls back.
import manifest from '../../assets/minigames/suter-k-ciare/voice/manifest.json';
import type { Cue } from './lines.ts';

interface Recording {
  readonly speaker: string;
  readonly text: string;
  readonly file: string;
  readonly durationMs: number;
}

const urls = import.meta.glob<string>(
  '../../assets/minigames/suter-k-ciare/voice/*.wav',
  { eager: true, query: '?url', import: 'default' },
);
const recordings = manifest.lines as Record<string, Recording>;

export function voiceLine(cue: Cue, index: number, text: string) {
  const recording = recordings[`${cue}-${index}`];
  const url =
    recording &&
    urls[`../../assets/minigames/suter-k-ciare/voice/${recording.file}`];
  if (!recording || !url || recording.text !== text) return undefined;
  return { url, seconds: recording.durationMs / 1000 };
}

/** One remark at a time; pauses while the page is hidden. */
export function createVoicePlayer() {
  let current: HTMLAudioElement | undefined;
  const stop = () => {
    current?.pause();
    current?.removeAttribute('src');
    current?.load();
    current = undefined;
  };
  const onVisibility = () => {
    if (!current) return;
    if (document.hidden) current.pause();
    else if (!current.ended) void current.play().catch(() => {});
  };
  document.addEventListener('visibilitychange', onVisibility);
  return {
    play(url: string) {
      stop();
      current = new Audio(url);
      // Blocked autoplay leaves the subtitle visible; the match never waits on audio.
      if (!document.hidden) void current.play().catch(() => {});
    },
    stop,
    get speaking() {
      return !!current && !current.ended && !current.paused;
    },
    destroy() {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}

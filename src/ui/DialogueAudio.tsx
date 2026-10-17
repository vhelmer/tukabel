import { useEffect, useMemo, useRef, useState } from 'react';
import { lipSyncIssue, mouthFrame, mouthShapeAt } from '../game/speech';
import { useSubtitles } from './useSubtitles';
import type {
  CharacterAnimation,
  DialogueNode,
  LipSyncTrack,
  SceneSpeechPlayback,
} from '../game/types';

// The audio element is the only clock. Pixi reads currentTime directly, including
// seeks, without a React render or a separate accumulating animation timer.
export function useDialogueAudio(
  node: DialogueNode | undefined,
  binding: CharacterAnimation | undefined,
  paused: boolean,
  enabled = true,
  autoplay = true,
  utteranceKey = node?.id,
  options: { compact?: boolean; onComplete?: () => void } = {},
) {
  const ref = useRef<HTMLAudioElement>(null);
  const track = useRef<LipSyncTrack | null>(null);
  const started = useRef(false),
    skipped = useRef(false),
    failed = useRef(false),
    resume = useRef(false);
  const [status, setStatus] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const completed = useRef(false);
  const speech = node?.speech?.text === node?.text ? node?.speech : undefined;
  const audioUrl = speech?.audio,
    lipSyncUrl = speech?.lipSync;
  const subtitles = useSubtitles(node, speech, ref, enabled, utteranceKey);
  useEffect(() => {
    const audio = ref.current;
    if (!audio || !audioUrl || !enabled) return;
    const abort = new AbortController();
    track.current = null;
    started.current = false;
    skipped.current = false;
    failed.current = false;
    resume.current = false;
    completed.current = false;
    setUnavailable(false);
    setStatus('');
    audio.src = audioUrl;
    if (lipSyncUrl)
      void fetch(lipSyncUrl, { signal: abort.signal })
        .then(async (response) => {
          if (!response.ok) throw Error();
          const data: unknown = await response.json();
          if (lipSyncIssue(data)) throw Error();
          if (!abort.signal.aborted) track.current = data as LipSyncTrack;
        })
        .catch(() => {
          if (!abort.signal.aborted && !failed.current)
            setStatus(
              'Časovanie úst sa nepodarilo načítať; používam bežnú animáciu.',
            );
        });
    if (autoplay)
      void audio.play().catch(() => {
        if (!abort.signal.aborted) {
          setUnavailable(true);
          failed.current = true;
          setStatus(
            audio.error
              ? 'Dabing sa nepodarilo prehrať. Text zostáva dostupný.'
              : 'Spusti dabing tlačidlom Prehrať.',
          );
        }
      });
    return () => {
      abort.abort();
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      track.current = null;
    };
  }, [audioUrl, lipSyncUrl, enabled, autoplay, utteranceKey]);
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    const sync = () => {
      if (paused || document.hidden) {
        if (!audio.paused) resume.current = true;
        audio.pause();
      } else if (resume.current) {
        resume.current = false;
        void audio.play().catch(() => {
          failed.current = true;
          setUnavailable(true);
          setStatus('Pokračuj tlačidlom Prehrať.');
        });
      }
    };
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => document.removeEventListener('visibilitychange', sync);
  }, [paused, speech]);
  const clock = useMemo<SceneSpeechPlayback | undefined>(
    () =>
      speech && enabled
        ? {
            actor: node?.actor,
            read: () => {
              const audio = ref.current,
                timeMs = (audio?.currentTime ?? 0) * 1000;
              return {
                active: Boolean(
                  audio &&
                  started.current &&
                  !audio.ended &&
                  !skipped.current &&
                  !failed.current,
                ),
                timeMs,
                frameIndex:
                  track.current &&
                  binding?.mouthShapes &&
                  Object.keys(binding.mouthShapes).length
                    ? mouthFrame(binding, mouthShapeAt(track.current, timeMs))
                    : undefined,
              };
            },
          }
        : undefined,
    [speech, enabled, node?.actor, binding],
  );
  const finish = () => {
    if (completed.current) return;
    completed.current = true;
    options.onComplete?.();
  };
  const stop = () => {
    const audio = ref.current;
    if (audio) {
      skipped.current = true;
      resume.current = false;
      audio.pause();
      if (Number.isFinite(audio.duration)) audio.currentTime = audio.duration;
    }
  };
  const skip = () => {
    stop();
    finish();
  };
  const controls =
    speech && enabled ? (
      <div
        className={`dialogue-audio${options.compact ? ' is-compact' : ''}`}
        aria-label="Dabing repliky"
      >
        <audio
          key={speech.audio}
          ref={ref}
          src={speech.audio}
          controls={!options.compact}
          hidden={options.compact}
          preload="auto"
          onPlay={() => {
            started.current = true;
            skipped.current = false;
            failed.current = false;
            setUnavailable(false);
          }}
          onEnded={finish}
          onError={() => {
            failed.current = true;
            setUnavailable(true);
            setStatus('Dabing sa nepodarilo prehrať. Text zostáva dostupný.');
          }}
        />
        {!options.compact && (
          <button type="button" onClick={skip}>
            Preskočiť dabing
          </button>
        )}
        {options.compact
          ? unavailable && (
              <p role="status">
                Dabing nie je dostupný. Pokračuj kliknutím na titulky.
              </p>
            )
          : status && <p role="status">{status}</p>}
      </div>
    ) : null;
  return { clock, controls, stop, unavailable, ...subtitles };
}

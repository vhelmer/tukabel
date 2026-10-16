import { useEffect, useMemo, useRef, useState } from 'react';
import { lipSyncIssue, mouthFrame, mouthShapeAt } from '../game/speech';
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
) {
  const ref = useRef<HTMLAudioElement>(null);
  const track = useRef<LipSyncTrack | null>(null);
  const started = useRef(false),
    skipped = useRef(false),
    failed = useRef(false),
    resume = useRef(false);
  const [status, setStatus] = useState('');
  const speech = node?.speech?.text === node?.text ? node?.speech : undefined;
  useEffect(() => {
    const audio = ref.current;
    if (!audio || !speech || !enabled) return;
    const abort = new AbortController();
    track.current = null;
    started.current = false;
    skipped.current = false;
    failed.current = false;
    resume.current = false;
    setStatus('');
    audio.src = speech.audio;
    if (speech.lipSync)
      void fetch(speech.lipSync, { signal: abort.signal })
        .then(async (response) => {
          if (!response.ok) throw Error();
          const data: unknown = await response.json();
          if (lipSyncIssue(data)) throw Error();
          if (!abort.signal.aborted) track.current = data as LipSyncTrack;
        })
        .catch(() => {
          if (!abort.signal.aborted)
            setStatus(
              'Časovanie úst sa nepodarilo načítať; používam bežnú animáciu.',
            );
        });
    if (autoplay)
      void audio.play().catch(() => {
        if (!abort.signal.aborted)
          setStatus('Spusti dabing tlačidlom Prehrať.');
      });
    return () => {
      abort.abort();
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      track.current = null;
    };
  }, [speech, enabled, autoplay, utteranceKey]);
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    const sync = () => {
      if (paused || document.hidden) {
        if (!audio.paused) resume.current = true;
        audio.pause();
      } else if (resume.current) {
        resume.current = false;
        void audio.play().catch(() => setStatus('Pokračuj tlačidlom Prehrať.'));
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
  const controls =
    speech && enabled ? (
      <div className="dialogue-audio" aria-label="Dabing repliky">
        <audio
          key={speech.audio}
          ref={ref}
          src={speech.audio}
          controls
          preload="auto"
          onPlay={() => {
            started.current = true;
            skipped.current = false;
          }}
          onError={() => {
            failed.current = true;
            setStatus('Dabing sa nepodarilo prehrať. Text zostáva dostupný.');
          }}
        />
        <button
          type="button"
          onClick={() => {
            const audio = ref.current;
            if (audio) {
              audio.pause();
              skipped.current = true;
              audio.currentTime = Number.isFinite(audio.duration)
                ? audio.duration
                : 0;
            }
          }}
        >
          Preskočiť dabing
        </button>
        {status && <p role="status">{status}</p>}
      </div>
    ) : null;
  return { clock, controls };
}

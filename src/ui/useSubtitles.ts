import { useEffect, useMemo, useState, type RefObject } from 'react';
import type {
  DialogueNode,
  DialogueSpeech,
  SpeechAlignment,
} from '../game/types';
import {
  alignmentIssue,
  buildSubtitles,
  subtitleAt,
  subtitleChunks,
  subtitleText,
} from '../game/subtitles';

// Subtitles and Rhubarb read the same audio playhead. Seeking never advances
// separate timers, and editing captions never restarts the audio or eye clock.
export function useSubtitles(
  node: DialogueNode | undefined,
  speech: DialogueSpeech | undefined,
  audioRef: RefObject<HTMLAudioElement | null>,
  enabled: boolean,
  utteranceKey: string | undefined,
) {
  const source = enabled && speech ? `${utteranceKey}/${speech.audio}` : '';
  const text = node ? subtitleText(node) : '';
  const [media, setMedia] = useState({ source: '', duration: 0 });
  const [loaded, setLoaded] = useState<{
    path: string;
    data: SpeechAlignment;
  }>();
  const [caption, setCaption] = useState({ source: '', text: '' });
  const duration = media.source === source ? media.duration : 0;
  const alignmentPath = enabled ? speech?.alignment : undefined;
  const alignment = loaded?.path === alignmentPath ? loaded?.data : undefined;
  useEffect(() => {
    if (!alignmentPath) return;
    const abort = new AbortController();
    void fetch(alignmentPath, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const data: unknown = await response.json();
        if (!abort.signal.aborted && !alignmentIssue(data))
          setLoaded({ path: alignmentPath, data: data as SpeechAlignment });
      })
      .catch(() => {
        /* Use the persisted track or an explicitly labelled estimate. */
      });
    return () => abort.abort();
  }, [alignmentPath]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !source) return;
    const update = () =>
      setMedia({
        source,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      });
    audio.addEventListener('loadedmetadata', update);
    audio.addEventListener('durationchange', update);
    update();
    return () => {
      audio.removeEventListener('loadedmetadata', update);
      audio.removeEventListener('durationchange', update);
    };
  }, [source, audioRef]);
  const automaticSubtitles = useMemo(
    () => buildSubtitles(text, duration, alignment),
    [text, duration, alignment],
  );
  const track = useMemo(() => {
    const stored = speech?.subtitles;
    return stored?.text === text ? stored : automaticSubtitles;
  }, [speech?.subtitles, text, automaticSubtitles]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !source) return;
    let frame = 0;
    const update = () => {
      const value = audio.error
        ? text
        : !track.cues.length
          ? (subtitleChunks(text)[0] ?? '')
          : audio.ended || (duration > 0 && audio.currentTime >= duration)
            ? track.cues.at(-1)!.text
            : audio.paused && audio.currentTime === 0
              ? track.cues[0]!.text
              : subtitleAt(track.cues, audio.currentTime);
      setCaption((previous) =>
        previous.source === source && previous.text === value
          ? previous
          : { source, text: value },
      );
    };
    const tick = () => {
      update();
      if (!audio.paused && !audio.ended) frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      update();
      if (!audio.paused && !audio.ended) frame = requestAnimationFrame(tick);
    };
    const events = [
      'play',
      'pause',
      'seeked',
      'timeupdate',
      'ended',
      'error',
      'loadedmetadata',
    ] as const;
    events.forEach((event) => audio.addEventListener(event, sync));
    sync();
    return () => {
      cancelAnimationFrame(frame);
      events.forEach((event) => audio.removeEventListener(event, sync));
    };
  }, [audioRef, source, text, track, duration]);
  return {
    subtitle: source
      ? caption.source === source
        ? caption.text
        : (track.cues[0]?.text ?? subtitleChunks(text)[0] ?? '')
      : text,
    subtitleTrack: track,
    automaticSubtitles,
    duration,
    seek: (seconds: number) => {
      const audio = audioRef.current;
      if (audio && duration > 0)
        audio.currentTime = Math.max(0, Math.min(duration, seconds));
    },
  };
}

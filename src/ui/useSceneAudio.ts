import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import pickup from '../assets/ambience/pickup.wav';
import combine from '../assets/ambience/combine.wav';
import travel from '../assets/ambience/travel.wav';

const effects = { pickup, combine, travel };

// Audio presentation belongs to the mounted game, never to saved player progress.
export function useSceneAudio(ambient: string | undefined, paused: boolean) {
  const [enabled, setEnabled] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const loop = useRef<HTMLAudioElement | null>(null);
  const sounds = useRef(new Map<HTMLAudioElement, () => void>());
  const canPlay = enabled && unlocked && !paused && !hidden;
  const ready = useRef(false);
  useLayoutEffect(() => {
    ready.current = canPlay;
  }, [canPlay]);

  useEffect(() => {
    const unlock = (event: Event) => {
      if (!event.isTrusted) return;
      setUnlocked(true);
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    const visibility = () => setHidden(document.hidden);
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    document.addEventListener('visibilitychange', visibility);
    const activeSounds = sounds.current;
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      document.removeEventListener('visibilitychange', visibility);
      for (const release of activeSounds.values()) release();
    };
  }, []);

  useEffect(() => {
    if (!ambient || !unlocked) return;
    const audio = new Audio(ambient);
    audio.loop = true;
    audio.volume = 0.45;
    loop.current = audio;
    return () => {
      loop.current = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
  }, [ambient, unlocked]);

  useEffect(() => {
    const audio = loop.current;
    if (canPlay) void audio?.play().catch(() => {});
    else {
      audio?.pause();
      for (const release of sounds.current.values()) release();
    }
  }, [ambient, unlocked, canPlay]);

  const playEffect = useCallback((effect: keyof typeof effects) => {
    if (!ready.current) return;
    const audio = new Audio(effects[effect]);
    audio.volume = 0.45;
    const release = () => {
      if (!sounds.current.delete(audio)) return;
      audio.removeEventListener('ended', release);
      audio.removeEventListener('error', release);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
    sounds.current.set(audio, release);
    audio.addEventListener('ended', release, { once: true });
    audio.addEventListener('error', release, { once: true });
    void audio.play().catch(release);
  }, []);
  return { enabled, toggle: () => setEnabled((value) => !value), playEffect };
}

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
import { assetUrl } from '../game/assets';
import { MusicLoop } from './musicLoop';

const effects: Record<string, string> = { pickup, combine, travel };
const EFFECT_COOLDOWN_MS = 250;

// Audio presentation belongs to the mounted game, never to saved player progress.
export function useSceneAudio(
  ambient: string | undefined,
  paused: boolean,
  { music, ducked = false }: { music?: string; ducked?: boolean } = {},
) {
  const [enabled, setEnabled] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const loop = useRef<HTMLAudioElement | null>(null);
  const musicLoop = useRef<MusicLoop | null>(null);
  const sounds = useRef(new Map<HTMLAudioElement, () => void>());
  const cooldowns = useRef(new Map<string, number>());
  const canPlay = enabled && unlocked && !paused && !hidden;
  const ready = useRef(false);
  useLayoutEffect(() => {
    ready.current = canPlay;
  }, [canPlay]);

  useEffect(() => {
    const controller = new MusicLoop();
    musicLoop.current = controller;
    const unlock = (event: Event) => {
      if (!event.isTrusted) return;
      // Safari can suspend again after hiding: resume within a trusted gesture.
      controller.unlock();
      setUnlocked(true);
      const audio = loop.current;
      if (ready.current && audio?.paused)
        void audio
          .play()
          .then(() => {
            if ((!ready.current || loop.current !== audio) && !audio.paused)
              audio.pause();
          })
          .catch(() => {});
    };
    const visibility = () => setHidden(document.hidden);
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    document.addEventListener('visibilitychange', visibility);
    const activeSounds = sounds.current;
    return () => {
      ready.current = false;
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      document.removeEventListener('visibilitychange', visibility);
      for (const release of activeSounds.values()) release();
      musicLoop.current = null;
      controller.dispose();
    };
  }, []);

  useEffect(() => {
    const controller = musicLoop.current;
    controller?.setPlaying(canPlay);
    controller?.setDucked(ducked);
    if (unlocked) controller?.setTrack(music);
  }, [music, unlocked, canPlay, ducked]);

  useEffect(() => {
    if (!ambient || !unlocked) return;
    const audio = new Audio(ambient);
    audio.loop = true;
    audio.volume = 0.12;
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
    if (audio) audio.volume = 0.12 * (ducked ? 0.25 : 1);
    if (canPlay)
      void audio
        ?.play()
        .then(() => {
          // A late promise must not resume a removed scene or a paused menu.
          if ((!ready.current || loop.current !== audio) && !audio.paused)
            audio.pause();
        })
        .catch(() => {});
    else {
      audio?.pause();
      for (const release of sounds.current.values()) release();
    }
  }, [ambient, unlocked, canPlay, ducked]);

  const playEffect = useCallback((effect: string) => {
    if (!ready.current) return;
    const url = Object.hasOwn(effects, effect)
      ? effects[effect]
      : assetUrl(effect);
    if (!url) return;
    const now = performance.now();
    if (now - (cooldowns.current.get(url) ?? -Infinity) < EFFECT_COOLDOWN_MS)
      return;
    cooldowns.current.set(url, now);
    if (sounds.current.size >= 2) sounds.current.values().next().value?.();
    const audio = new Audio(url);
    audio.volume = 0.35;
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
    void audio
      .play()
      .then(() => {
        if ((!ready.current || !sounds.current.has(audio)) && !audio.paused)
          audio.pause();
      })
      .catch(release);
  }, []);
  return { enabled, toggle: () => setEnabled((value) => !value), playEffect };
}

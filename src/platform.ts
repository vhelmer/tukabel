import { game } from '@azet/games-sdk';
import { SAVE_KEY, setSaveStorage } from './game/storage';

// Azet Games shell integration. Only a production build running inside the
// shell's frame talks to the SDK; dev, editor and a standalone page never wait
// for a shell that is not there.
export interface Platform {
  /** The player finished the story: report the play time as the score. */
  finish(endingId: string): void;
  onPause(listener: () => void): () => void;
}

export let platform: Platform | null = null;

const STORE_KEY = 'save';

/**
 * Connects to the shell and calls `mount` for every Play (a replay starts a
 * fresh game). The shell's own start screen covers the frame until then.
 */
export async function startPlatform(mount: (session: number) => void) {
  if (import.meta.env.DEV || window.parent === window) return false;
  await game.init();
  // The games origin is opaque: localStorage throws, so the manual save slot
  // lives in the player's cloud store, read on every Play (the shell opens the
  // play session, which the store needs, only then) for the sync save API.
  let saved: string | null = null;
  setSaveStorage({
    getItem: (key) => (key === SAVE_KEY ? saved : null),
    setItem: (key, value) => {
      if (key !== SAVE_KEY) return;
      saved = value;
      game.store.player.set(STORE_KEY, value).catch((error: unknown) => {
        console.warn('Cloud save failed', error);
      });
    },
  });
  let startedAt = 0;
  let finished = false;
  let session = 0;
  platform = {
    finish(endingId) {
      if (finished) return;
      finished = true;
      const seconds = Math.max(
        1,
        Math.round((performance.now() - startedAt) / 1000),
      );
      game.complete({
        score: seconds,
        timeSeconds: seconds,
        success: true,
        details: { ending: endingId },
      });
    },
    onPause: (listener) => game.onPause(listener),
  };
  game.onStart(async () => {
    startedAt = performance.now();
    finished = false;
    try {
      const value = await game.store.player.get<string>(STORE_KEY);
      saved = typeof value === 'string' ? value : null;
    } catch {
      saved = null;
    }
    mount(++session);
  });
  game.ready();
  return true;
}

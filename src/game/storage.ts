import type { GameContent, GameState } from './types';
import { syncLocations, syncTasks } from './state';

export const SAVE_KEY = 'tukabel.save.v1';

type SaveStorage = Pick<Storage, 'getItem' | 'setItem'>;
// The Azet Games shell forbids localStorage; it swaps in its cloud store.
let saveStorage: SaveStorage | null = null;
export function setSaveStorage(storage: SaveStorage) {
  saveStorage = storage;
}
const SAVE_VERSION = 1;

type Result<T> = { ok: true; value: T } | { ok: false; message: string };
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function decodeSave(
  raw: string,
  content: GameContent,
): Result<GameState> {
  try {
    const data: unknown = JSON.parse(raw);
    if (
      !isRecord(data) ||
      data.version !== SAVE_VERSION ||
      data.contentId !== content.id
    )
      return { ok: false, message: 'Uložená hra patrí inej verzii hry.' };
    const state = data.state;
    if (
      !isRecord(state) ||
      !content.scenes.some((scene) => scene.id === state.sceneId) ||
      !Array.isArray(state.inventory) ||
      !state.inventory.every(
        (id) =>
          typeof id === 'string' &&
          content.items.some((item) => item.id === id),
      ) ||
      new Set(state.inventory).size !== state.inventory.length ||
      !isRecord(state.flags) ||
      !Object.entries(state.flags).every(
        ([id, value]) =>
          content.flags.includes(id) && typeof value === 'boolean',
      ) ||
      typeof state.message !== 'string' ||
      state.message.length > 4000
    )
      throw new Error('Invalid state');
    if (state.dialogue !== null) {
      if (!isRecord(state.dialogue)) throw new Error('Invalid dialogue');
      const active = state.dialogue;
      if (
        !content.dialogues
          .find((dialogue) => dialogue.id === active.id)
          ?.nodes.some((node) => node.id === active.nodeId)
      )
        throw new Error('Unknown dialogue');
    }
    // Version 1 saves from before the journal remain readable. Reconstruct only
    // what current flags/items prove; never invent prior manual events.
    const tasks = state.tasks === undefined ? {} : state.tasks;
    if (
      !isRecord(tasks) ||
      !Object.entries(tasks).every(
        ([id, status]) =>
          content.tasks?.some((task) => task.id === id) &&
          (status === 'active' || status === 'completed'),
      )
    )
      throw new Error('Invalid journal');
    const unlockedScenes =
      state.unlockedScenes === undefined ? [] : state.unlockedScenes;
    if (
      !Array.isArray(unlockedScenes) ||
      !unlockedScenes.every(
        (id) =>
          typeof id === 'string' &&
          content.scenes.some((scene) => scene.id === id),
      ) ||
      new Set(unlockedScenes).size !== unlockedScenes.length
    )
      throw new Error('Invalid unlocked locations');
    // Copy only the known fields; never merge untrusted storage into definitions.
    return {
      ok: true,
      value: syncLocations(
        content,
        syncTasks(content, {
          sceneId: state.sceneId as string,
          unlockedScenes: [...unlockedScenes] as string[],
          inventory: [...state.inventory] as string[],
          flags: { ...state.flags } as Record<string, boolean>,
          tasks: { ...tasks } as GameState['tasks'],
          dialogue:
            state.dialogue === null
              ? null
              : {
                  id: state.dialogue.id as string,
                  nodeId: state.dialogue.nodeId as string,
                },
          // A minigame restarts from its hotspot; it is never resumed mid-match.
          minigame: null,
          message: state.message,
        }),
      ),
    };
  } catch {
    return {
      ok: false,
      message:
        'Uloženú hru sa nepodarilo prečítať. Aktuálna hra ostáva zachovaná.',
    };
  }
}

export function saveGame(
  content: GameContent,
  state: GameState,
  storage?: Pick<Storage, 'setItem'>,
): Result<null> {
  try {
    (storage ?? saveStorage ?? window.localStorage).setItem(
      SAVE_KEY,
      JSON.stringify({ version: SAVE_VERSION, contentId: content.id, state }),
    );
    return { ok: true, value: null };
  } catch {
    return {
      ok: false,
      message:
        'Prehliadač nepovolil uloženie hry. Skontroluj voľné miesto a nastavenie úložiska.',
    };
  }
}

export function loadGame(
  content: GameContent,
  storage?: Pick<Storage, 'getItem'>,
): Result<GameState> {
  try {
    const raw = (storage ?? saveStorage ?? window.localStorage).getItem(
      SAVE_KEY,
    );
    return raw === null
      ? { ok: false, message: 'Zatiaľ nemáš uloženú hru.' }
      : decodeSave(raw, content);
  } catch {
    return { ok: false, message: 'Prehliadač nepovolil čítanie uloženej hry.' };
  }
}

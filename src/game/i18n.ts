import th from './content/translations/th.json' with { type: 'json' };
import { subtitleText } from './subtitles';
import type { GameContent } from './types';

// Player language. Slovak is the source text; a translation maps the exact
// Slovak string to its replacement, so game state and saves stay Slovak and a
// missing or outdated translation falls back to the original. Dubbing stays
// Slovak; translated subtitles are timed as an estimate over the same audio.
export type Language = 'sk' | 'th';
export const languages: readonly { id: Language; label: string }[] = [
  { id: 'sk', label: 'Slovenčina' },
  { id: 'th', label: 'ไทย' },
];
const dictionaries: Record<Language, Readonly<Record<string, string>>> = {
  sk: {},
  th,
};
const STORAGE_KEY = 'tukabel.language';
let current: Language = 'sk';

export function currentLanguage(): Language {
  return current;
}
export function setLanguage(language: Language) {
  current = language;
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}
export function savedLanguage(): Language {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'th' ? 'th' : 'sk';
  } catch {
    return 'sk';
  }
}
export function saveLanguage(language: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* The choice then lasts only for this page. */
  }
}
/** Canvas text measures with whatever font is ready, so load Thai glyphs first. */
export async function loadLanguageFont(language: Language) {
  if (language !== 'th' || !document.fonts) return;
  await Promise.all(
    ['400', '700'].map((weight) =>
      document.fonts.load(`${weight} 16px "Noto Sans Thai"`, 'ก'),
    ),
  ).catch(() => undefined);
}

/** Translates a whole Slovak string; `{name}` placeholders take `values`. */
export function t(text: string, values?: Record<string, string | number>) {
  const translated = dictionaries[current][text] ?? text;
  return values
    ? translated.replace(/\{(\w+)\}/gu, (match, key: string) =>
        key in values ? String(values[key]) : match,
      )
    : translated;
}

/**
 * Display copy of the content. Rule and choice messages are not touched: the
 * reducer copies them into the state, which is translated when shown. Node
 * text and speech stay Slovak so the dubbing is still recognised as current.
 */
export function localizeContent(
  content: GameContent,
  language: Language,
): GameContent {
  const dictionary = dictionaries[language];
  if (!Object.keys(dictionary).length) return content;
  const tr = (text: string) => dictionary[text] ?? text;
  return {
    ...content,
    tasks: content.tasks?.map((task) => ({ ...task, text: tr(task.text) })),
    items: content.items.map((item) => ({
      ...item,
      label: tr(item.label),
      description: item.description && tr(item.description),
    })),
    endings: content.endings?.map((ending) => ({
      ...ending,
      title: tr(ending.title),
      text: tr(ending.text),
    })),
    worldMap: content.worldMap && {
      ...content.worldMap,
      points: content.worldMap.points.map((point) => ({
        ...point,
        label: tr(point.label),
      })),
    },
    scenes: content.scenes.map((scene) => ({
      ...scene,
      title: tr(scene.title),
      hotspots: scene.hotspots.map((hotspot) =>
        hotspot.label ? { ...hotspot, label: tr(hotspot.label) } : hotspot,
      ),
    })),
    dialogues: content.dialogues.map((dialogue) => ({
      ...dialogue,
      nodes: dialogue.nodes.map((node) => {
        const subtitle = dictionary[subtitleText(node)];
        return {
          ...node,
          speaker: tr(node.speaker),
          ...(subtitle ? { subtitle } : {}),
          choices: node.choices.map((choice) => ({
            ...choice,
            text: tr(choice.text),
          })),
        };
      }),
    })),
  };
}

/** Every content string a player can read, as the key a translation uses. */
export function translatableTexts(content: GameContent): string[] {
  const texts = new Set<string>([content.initialMessage]);
  const messages = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(messages);
    else if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value))
        if (key === 'message' && typeof child === 'string') texts.add(child);
        else messages(child);
  };
  content.tasks?.forEach((task) => texts.add(task.text));
  for (const item of content.items) {
    texts.add(item.label);
    if (item.description) texts.add(item.description);
  }
  for (const ending of content.endings ?? []) {
    texts.add(ending.title);
    texts.add(ending.text);
  }
  for (const minigame of content.minigames ?? []) {
    if (minigame.winMessage) texts.add(minigame.winMessage);
    if (minigame.loseMessage) texts.add(minigame.loseMessage);
  }
  content.worldMap?.points.forEach((point) => texts.add(point.label));
  for (const scene of content.scenes) {
    texts.add(scene.title);
    for (const hotspot of scene.hotspots) {
      if (hotspot.label) texts.add(hotspot.label);
      messages(hotspot.onClick);
      messages(hotspot.uses);
    }
  }
  content.combinations.forEach((combination) => messages(combination.rules));
  for (const dialogue of content.dialogues)
    for (const node of dialogue.nodes) {
      texts.add(node.speaker);
      texts.add(subtitleText(node));
      for (const choice of node.choices) {
        texts.add(choice.text);
        if (choice.message) texts.add(choice.message);
      }
    }
  texts.delete('');
  return [...texts];
}
export function missingTranslations(content: GameContent, language: Language) {
  const dictionary = dictionaries[language];
  return language === 'sk'
    ? []
    : translatableTexts(content).filter((text) => !(text in dictionary));
}

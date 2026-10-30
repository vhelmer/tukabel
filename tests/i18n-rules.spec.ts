import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  localizeContent,
  missingTranslations,
  setLanguage,
  t,
} from '../src/game/i18n';
import { subtitleChunks, subtitleText } from '../src/game/subtitles';
import type { GameContent } from '../src/game/types';

const project = JSON.parse(
  readFileSync('src/game/content/project.json', 'utf8'),
) as GameContent;
const th = JSON.parse(
  readFileSync('src/game/content/translations/th.json', 'utf8'),
) as Record<string, string>;

test.afterEach(() => setLanguage('sk'));

test('every text a player reads in the story has a Thai translation', () => {
  expect(missingTranslations(project, 'th')).toEqual([]);
  expect(missingTranslations(project, 'sk')).toEqual([]);
});

test('Thai display content keeps Slovak dubbing current and logic intact', () => {
  const localized = localizeContent(project, 'th');
  expect(localizeContent(project, 'sk')).toBe(project);
  const nodes = project.dialogues.flatMap((dialogue) => dialogue.nodes);
  const shown = localized.dialogues.flatMap((dialogue) => dialogue.nodes);
  nodes.forEach((node, index) => {
    const copy = shown[index]!;
    // DialogueAudio plays speech only while its text matches node.text.
    expect(copy.text).toBe(node.text);
    expect(copy.speech).toBe(node.speech);
    expect(subtitleText(copy)).toBe(th[subtitleText(node)]);
    expect(copy.choices.map((choice) => choice.id)).toEqual(
      node.choices.map((choice) => choice.id),
    );
  });
  expect(localized.items.map((item) => item.label)).toEqual(
    project.items.map((item) => th[item.label]),
  );
  expect(localized.scenes[0]!.hotspots[0]!.onClick).toBe(
    project.scenes[0]!.hotspots[0]!.onClick,
  );
});

test('code texts translate whole strings with placeholders and fall back', () => {
  setLanguage('th');
  expect(t('Uložiť hru')).not.toBe('Uložiť hru');
  expect(t('Denník {count}', { count: 3 })).toContain('3');
  expect(t('Text, ktorý nikto nepreložil.')).toBe(
    'Text, ktorý nikto nepreložil.',
  );
  setLanguage('sk');
  expect(t('Tu si: {place}', { place: 'Krčma' })).toBe('Tu si: Krčma');
});

test('Thai subtitles split at words, not mid-word or as one long line', () => {
  const text = th[subtitleText(project.dialogues[0]!.nodes[0]!)]!;
  const chunks = subtitleChunks(text);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.join('').replace(/\s/gu, '')).toBe(text.replace(/\s/gu, ''));
  for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(80);
});

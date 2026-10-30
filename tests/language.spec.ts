import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { hudClick, ready } from './helpers';

const th = JSON.parse(
  readFileSync('src/game/content/translations/th.json', 'utf8'),
) as Record<string, string>;

test('menu switches the game to Thai, remembers it and keeps dubbing Slovak', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await ready(page);
  const panel = page.locator('.dialogue-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.dialogue-speaker')).toHaveText('Fero');
  const audio = page.locator('.dialogue-panel audio, audio').first();
  const slovakAudio = await audio.getAttribute('src');
  expect(slovakAudio).toMatch(/\.wav$/u);

  await hudClick(
    page,
    page.getByRole('button', { name: 'Menu', exact: true }),
    isMobile,
  );
  await page.getByRole('button', { name: 'ไทย', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'th');
  await expect(
    page.getByRole('heading', { name: th['Pauza na kávu'] }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'ไทย', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('button', { name: th['Pokračovať v hre'], exact: true })
    .click();
  await ready(page);
  await expect(panel.locator('.dialogue-speaker')).toHaveText(th['Fero']!);
  await expect(panel.locator('#dialogue-text')).toContainText(/[฀-๿]/u);
  // The same Slovak recording keeps playing under Thai subtitles.
  await expect(audio).toHaveAttribute('src', slovakAudio ?? '');

  await page.reload();
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'th');
  await hudClick(
    page,
    page.getByRole('button', { name: th['Menu'], exact: true }),
    isMobile,
  );
  await page.getByRole('button', { name: 'Slovenčina', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Pauza na kávu' }),
  ).toBeVisible();
});

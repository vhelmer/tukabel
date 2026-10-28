import { expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { test, openEditor } from './editorFixture';
import { writeCodexFixture } from './codexFixture';
import type { GameContent } from '../src/game/types';
import { ready } from './helpers';

let release = () => {},
  calls = 0;
async function save(page: Page) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/project') && r.request().method() === 'PUT',
  );
  await page
    .getByRole('button', { name: 'Uložit do projektu', exact: true })
    .click();
  expect((await response).ok()).toBe(true);
  await expect(page.locator('.saved-badge')).toBeVisible();
}
test.describe('local Codex agent', () => {
  test.use({
    codexTools: {
      run: async (r) => {
        calls++;
        r.onStage('Testovací agent připravuje snímky');
        await new Promise<void>((resolve, reject) => {
          release = resolve;
          r.signal.addEventListener('abort', () => reject(Error('stopped')), {
            once: true,
          });
        });
        await writeCodexFixture(r);
      },
    },
  });

  test('character task survives reload and saving, previews independent clips, rejects changed bindings and saves playable results', async ({
    page,
    workspace,
  }, info) => {
    calls = 0;
    const original = JSON.parse(
      await readFile(workspace.source, 'utf8'),
    ) as GameContent;
    const actor = original.scenes
      .find((s) => s.id === 'animation-lab')!
      .hotspots.find((h) => h.id === 'blink-character')!;
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openEditor(page, workspace.url);
    await page.getByRole('button', { name: 'Animace', exact: true }).click();
    await page
      .getByLabel('Animovaná postava', { exact: true })
      .selectOption(JSON.stringify(['animation-lab', actor.id]));
    const panel = page.getByRole('region', {
      name: 'Codex animace postavy',
      exact: true,
    });
    await panel.locator('summary').click();
    await expect(panel).toContainText('gpt-6.1-sol');
    await panel
      .getByLabel('Zadání pro agenta', { exact: true })
      .fill('Připrav oči a ústa.');
    await panel
      .getByRole('button', {
        name: 'Spustit místního Codex agenta',
        exact: true,
      })
      .click();
    await expect.poll(() => calls).toBe(1);
    await page.getByRole('button', { name: 'Lokace', exact: true }).click();
    await page
      .getByLabel('Název lokace', { exact: true })
      .fill('Ateliér během práce Codexu');
    await save(page);
    await page.reload();
    await ready(page);
    await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
    await expect(page.locator('.editor-job-tray')).toContainText(
      'Testovací agent připravuje snímky',
    );
    expect(calls).toBe(1);
    release();
    await expect(page.locator('.editor-job-tray')).toContainText(
      'Připravené na kontrolu',
    );
    await page
      .getByRole('button', { name: 'Otevřít výsledek', exact: true })
      .click();
    await expect(panel.locator('canvas')).toBeVisible();
    const apply = panel.getByRole('button', {
      name: 'Přiřadit výsledek do návrhu',
      exact: true,
    });
    await expect(apply).toBeEnabled();
    const first = await panel.locator('canvas').screenshot();
    await page.waitForTimeout(190);
    expect((await panel.locator('canvas').screenshot()).equals(first)).toBe(
      false,
    );
    await panel.screenshot({
      path: info.outputPath('codex-character-preview.png'),
    });
    await page
      .getByLabel('Procedurální pohyb', { exact: true })
      .selectOption('');
    await expect(apply).toBeDisabled();
    await page.getByRole('button', { name: 'Zpět', exact: true }).click();
    await expect(apply).toBeEnabled();
    await apply.click();
    await save(page);
    const saved = JSON.parse(
      await readFile(workspace.source, 'utf8'),
    ) as GameContent;
    const scene = saved.scenes.find((s) => s.id === 'animation-lab')!;
    const updated = scene.hotspots.find((h) => h.id === actor.id)!;
    expect(scene.title).toBe('Ateliér během práce Codexu');
    expect(updated.animation?.blink).toMatch(/^codex-/);
    expect(updated.animation?.talk).toMatch(/^codex-/);
    expect(updated.animation?.voice).toEqual(actor.animation?.voice);
    expect(updated.animation?.mouthShapes).toBeUndefined();
    const clips = saved.animations!.filter(
      (c) =>
        c.id.startsWith('codex-') &&
        !original.animations?.some((existing) => existing.id === c.id),
    );
    expect(clips).toHaveLength(2);
    for (const existing of original.animations ?? [])
      expect(saved.animations).toContainEqual(existing);
    expect(clips[0]!.region!.y).not.toBe(clips[1]!.region!.y);
    for (const clip of clips)
      expect(
        (
          await readFile(
            path.join(workspace.root, 'src/assets', clip.frames[0]!),
          )
        ).length,
      ).toBeGreaterThan(0);
    await page.reload();
    await ready(page);
    await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
    await page.getByRole('button', { name: 'Animace', exact: true }).click();
    await page
      .getByLabel('Animovaná postava', { exact: true })
      .selectOption(JSON.stringify(['animation-lab', actor.id]));
    await page
      .getByRole('button', { name: 'Otestovat odsud ↗', exact: true })
      .click();
    await ready(page);
    await expect(
      page
        .getByRole('region', { name: 'Herné okno', exact: true })
        .locator('canvas'),
    ).toBeVisible();
    expect(calls).toBe(1);
  });

  test('generic gesture imports, saves, reloads and plays independently in the studio and Game Mode', async ({
    page,
    workspace,
  }, info) => {
    calls = 0;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const original = JSON.parse(
      await readFile(workspace.source, 'utf8'),
    ) as GameContent;
    const actor = original.scenes
      .find((s) => s.id === 'animation-lab')!
      .hotspots.find((h) => h.id === 'blink-character')!;
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openEditor(page, workspace.url);
    await page.getByRole('button', { name: 'Animace', exact: true }).click();
    await page
      .getByLabel('Animovaná postava', { exact: true })
      .selectOption(JSON.stringify(['animation-lab', actor.id]));
    const panel = page.getByRole('region', {
      name: 'Codex animace postavy',
      exact: true,
    });
    await panel.locator('summary').click();
    await panel
      .getByLabel('Úloha pro Codex', { exact: true })
      .selectOption('gesture');
    await expect(
      panel.getByLabel('Zadání pro agenta', { exact: true }),
    ).toHaveValue(/poškrábe/);
    await panel
      .getByRole('button', {
        name: 'Spustit místního Codex agenta',
        exact: true,
      })
      .click();
    await expect.poll(() => calls).toBe(1);
    release();
    await expect(page.locator('.editor-job-tray')).toContainText(
      'Připravené na kontrolu',
      { timeout: 15000 },
    );
    const apply = panel.getByRole('button', {
      name: 'Přiřadit výsledek do návrhu',
      exact: true,
    });
    await expect(apply).toBeEnabled();
    await expect(panel.locator('canvas')).toBeVisible();
    await panel.screenshot({ path: info.outputPath('gesture-result.png') });
    await apply.click();
    await page.getByLabel('Gesto min. (sekundy)', { exact: true }).fill('0.1');
    await page.getByLabel('Gesto max. (sekundy)', { exact: true }).fill('0.2');
    await save(page);
    const saved = JSON.parse(
      await readFile(workspace.source, 'utf8'),
    ) as GameContent;
    const updated = saved.scenes
      .find((s) => s.id === 'animation-lab')!
      .hotspots.find((h) => h.id === actor.id)!;
    expect(updated.animation).toMatchObject({
      ...actor.animation,
      gestureIntervalMs: [100, 200],
    });
    const clip = saved.animations!.find(
      (c) => c.id === updated.animation?.gesture,
    )!;
    expect(clip).toMatchObject({
      kind: 'expression',
      loop: false,
      source: actor.image,
    });
    expect(clip.frames).toHaveLength(12);
    expect(clip.region).toBeUndefined();
    await page.reload();
    await ready(page);
    await page.getByRole('button', { name: 'Dev Mode', exact: true }).click();
    await page.getByRole('button', { name: 'Animace', exact: true }).click();
    await page
      .getByLabel('Animovaná postava', { exact: true })
      .selectOption(JSON.stringify(['animation-lab', actor.id]));
    await expect(page.getByLabel('Náhodné gesto', { exact: true })).toHaveValue(
      clip.id,
    );
    const preview = page.locator('.animation-workspace .combined-preview');
    // Isolate only the gesture for a visible-render assertion (not other clocks).
    for (const name of ['Testovat mrkání', 'Testovat mluvení', 'Testovat idle'])
      await preview.getByLabel(name, { exact: true }).uncheck();
    const canvas = preview.locator('canvas');
    await expect(canvas).toBeVisible();
    const still = await canvas.screenshot();
    await expect
      .poll(async () => (await canvas.screenshot()).equals(still), {
        timeout: 5000,
      })
      .toBe(false);
    await preview.screenshot({ path: info.outputPath('gesture-studio.png') });
    await page
      .getByRole('button', { name: 'Otestovat odsud ↗', exact: true })
      .click();
    await ready(page);
    const game = page
      .getByRole('region', { name: 'Herné okno', exact: true })
      .locator('canvas');
    await expect(game).toBeVisible();
    await game.screenshot({ path: info.outputPath('gesture-game.png') });
    expect(errors).toEqual([]);
  });

  test('scene selection captures source coordinates, can stop a running agent and applies a separate animated layer without changing the background', async ({
    page,
    workspace,
    isMobile,
  }) => {
    calls = 0;
    const doc = JSON.parse(
      await readFile(workspace.source, 'utf8'),
    ) as GameContent;
    const scene = doc.scenes[0]!;
    const dir = path.join(workspace.root, 'src/assets/codex/test-input');
    await mkdir(dir, { recursive: true });
    await sharp({
      create: { width: 256, height: 144, channels: 4, background: '#789abc' },
    })
      .png()
      .toFile(path.join(dir, 'background.png'));
    await writeFile(
      workspace.source,
      JSON.stringify({
        ...doc,
        scenes: doc.scenes.map((s) =>
          s.id === scene.id
            ? { ...s, background: 'codex/test-input/background.png' }
            : s,
        ),
      }),
    );
    await openEditor(page, workspace.url);
    const panel = page.getByRole('region', {
      name: 'Codex animace oblasti',
      exact: true,
    });
    await panel.locator('summary').click();
    await page
      .getByRole('button', { name: 'Vybrat obdélník', exact: true })
      .click();
    const stage = page.locator('.editor-stage');
    await stage.scrollIntoViewIfNeeded();
    const points = await stage.evaluate((el, size) => {
      const m = (el as SVGSVGElement).getScreenCTM()!;
      return [
        { x: size.width * 0.2, y: size.height * 0.1 },
        { x: size.width * 0.8, y: size.height * 0.5 },
      ].map((p) => {
        const q = new DOMPoint(p.x, p.y).matrixTransform(m);
        return { x: q.x, y: q.y };
      });
    }, scene);
    if (isMobile) {
      const session = await page.context().newCDPSession(page);
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...points[0]!, id: 1 }],
      });
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ ...points[1]!, id: 1 }],
      });
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await session.detach();
    } else {
      await page.mouse.move(points[0]!.x, points[0]!.y);
      await page.mouse.down();
      await page.mouse.move(points[1]!.x, points[1]!.y, { steps: 4 });
      await page.mouse.up();
    }
    await expect(stage.locator('[data-art-selection]')).toHaveCount(1);
    await panel
      .getByRole('button', {
        name: 'Spustit místního Codex agenta',
        exact: true,
      })
      .click();
    await expect.poll(() => calls).toBe(1);
    await page
      .getByRole('button', { name: 'Zastavit agenta', exact: true })
      .click();
    await expect(page.locator('.editor-job-tray')).toContainText(
      /Agent (se zastavuje|zastaven)/,
    );
    await panel
      .getByRole('button', {
        name: 'Spustit místního Codex agenta',
        exact: true,
      })
      .click();
    await expect.poll(() => calls).toBe(2);
    release();
    await expect(page.locator('.editor-job-tray')).toContainText(
      'Připravené na kontrolu',
    );
    await panel
      .getByRole('button', { name: 'Přiřadit výsledek do návrhu', exact: true })
      .click();
    await save(page);
    const saved = JSON.parse(
      await readFile(workspace.source, 'utf8'),
    ) as GameContent;
    const updated = saved.scenes.find((s) => s.id === scene.id)!;
    expect(updated.background).toBe('codex/test-input/background.png');
    const layer = updated.hotspots.find((h) => h.id.startsWith('codex-'))!;
    expect(layer.decorative).toBe(true);
    expect(updated.hotspots[0]!.id).toBe(layer.id);
    const folder = layer.image!.split('/').slice(0, -1).join('/');
    const recipe = JSON.parse(
      await readFile(
        path.join(workspace.root, 'src/assets', folder, 'recipe.json'),
        'utf8',
      ),
    );
    expect(recipe.context.selection[0].x).toBeCloseTo(256 * 0.2, 1);
    expect(recipe.context.selection[0].y).toBeCloseTo(144 * 0.1, 1);
    expect(layer.bounds).toEqual({
      x: 0,
      y: 0,
      width: scene.width,
      height: scene.height,
    });
  });
});

test('missing CLI explains setup and never enables generation', async ({
  page,
  workspace,
}) => {
  await openEditor(page, workspace.url);
  const panel = page.getByRole('region', {
    name: 'Codex animace oblasti',
    exact: true,
  });
  await panel.locator('summary').click();
  await expect(panel).toContainText('Codex CLI není dostupný');
  await expect(
    panel.getByRole('button', {
      name: 'Spustit místního Codex agenta',
      exact: true,
    }),
  ).toBeDisabled();
});

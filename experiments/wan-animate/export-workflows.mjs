// Run from the TUKABEL checkout with ComfyUI listening on loopback.
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  await page.goto('http://127.0.0.1:8188');
  await page.waitForFunction(() => globalThis.comfyAPI?.app?.app?.isGraphReady);
  // The frontend may still be restoring its initial tab after graph creation.
  await page.waitForTimeout(3000);
  for (const name of ['preprocess', 'animate', 'quality', 'idle', 'ti2v']) {
    const graph = JSON.parse(
      await readFile(new URL(`${name}-api.json`, root), 'utf8'),
    );
    const result = await page.evaluate(
      async ({ name, graph }) => {
        const { app } = await import('/scripts/app.js');
        await app.loadApiJson(graph, `TUKABEL-Wan22-${name}`);
        if (app.graph.nodes.length !== Object.keys(graph).length) {
          throw new Error(`Unexpected nodes after loading ${name}`);
        }
        const positions =
          name === 'preprocess'
            ? {
                1: [0, 100],
                2: [400, 100],
                3: [720, 100],
                4: [1120, 100],
                90: [1120, 300],
                91: [1520, 300],
                5: [0, 600],
                6: [720, 600],
                7: [1120, 600],
                8: [1520, 600],
              }
            : {
                1: [0, 0],
                2: [0, 190],
                3: [0, 430],
                4: [0, 610],
                5: [420, 610],
                6: [420, 920],
                7: [0, 840],
                8: [0, 1030],
                9: [420, 0],
                10: [420, 380],
                11: [830, 0],
                12: [830, 410],
                13: [1250, 0],
                14: [1660, 0],
                15: [1660, 480],
                16: [2050, 0],
                17: [2050, 350],
                90: [2440, 0],
                91: [2840, 0],
                92: [2440, 360],
              };
        const titles =
          name === 'preprocess'
            ? {
                1: '1 · Pohybové video',
                3: '2 · Kostra a ruce (DWPose)',
                4: 'Souřadnice kloubů · JSON',
                91: 'Náhled pohybového vodítka',
              }
            : {
                9: '1 · Obrázek postavy',
                11: '2 · Pohybové vodítko (kostra)',
                5: '3 · Popis pohybu',
                6: 'Nežádoucí změny',
                13: '4 · Rozlišení a počet snímků',
                14: `5 · Generování (${graph['14'].inputs.steps ?? graph['9']?.inputs.steps} kroků)`,
                91: 'Výsledné video',
                92: 'Jednotlivé snímky PNG',
              };
        if (name === 'idle') {
          titles[5] = '2 · Jak se má postava hýbat (bez videa)';
          titles[13] = '3 · Rozlišení a délka klipu';
          titles[14] = `4 · Generování (${graph['14'].inputs.steps} kroků)`;
        }
        if (name === 'ti2v') {
          Object.assign(positions, {
            1: [0, 0],
            2: [0, 190],
            3: [0, 380],
            4: [400, 380],
            5: [400, 710],
            6: [0, 600],
            7: [400, 0],
            8: [820, 0],
            9: [1230, 0],
            10: [1640, 0],
            11: [2020, 0],
            12: [2420, 0],
            13: [2020, 400],
            14: [820, 600],
            15: [1230, 600],
            16: [1640, 600],
          });
          Object.assign(titles, {
            1: 'Model · TI2V-5B FP16',
            2: 'Nastavení modelu',
            3: 'Textový enkodér',
            4: '2 · Pohyb a výtvarný styl',
            5: 'Čemu se má výsledek vyhnout',
            6: 'VAE · Wan2.2',
            7: '1 · Předloha postavy',
            8: '3 · Velikost a délka klipu',
            9: '4 · Generovat pohyb',
            10: 'Převést snímky',
            11: 'Video · 24 fps',
            12: 'Výsledné video',
            13: 'Jednotlivé PNG',
            14: 'Kontrola · původní obraz do VAE',
            15: 'Kontrola · rekonstrukce',
            16: 'Kontrolní PNG bez generování',
          });
        }
        for (const n of app.graph.nodes) {
          n.pos = positions[n.id] ?? [0, 0];
          if (titles[n.id]) n.title = titles[n.id];
          if (
            [
              'CLIPTextEncode',
              'LoadVideo',
              'LoadImage',
              'SaveVideo',
              'SaveImage',
            ].includes(n.type)
          ) {
            n.size = [
              360,
              n.type === 'CLIPTextEncode' ? 250 : Math.max(280, n.size[1]),
            ];
          }
          for (const widget of n.widgets ?? []) {
            if (widget.name === 'control_after_generate')
              widget.value = 'fixed';
          }
        }
        const ui = app.graph.serialize();
        ui.extra.ds = {
          scale: 0.8,
          offset: [100, 120],
        };
        return {
          ui,
          prompt: (await app.graphToPrompt()).output,
        };
      },
      { name, graph },
    );
    // Preserve the workflow identity so re-exporting does not create Git noise.
    const destination = new URL(`${name}-workflow.json`, root);
    try {
      result.ui.id = JSON.parse(await readFile(destination, 'utf8')).id;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    // Keep the UI's canonical flattened dynamic-combo syntax for the API too.
    await writeFile(destination, `${JSON.stringify(result.ui, null, 2)}\n`);
    await writeFile(
      new URL(`${name}-frontend-api.json`, root),
      `${JSON.stringify(result.prompt, null, 2)}\n`,
    );
    console.log(`Exported ${name}: ${result.ui.nodes.length} nodes`);
  }
} finally {
  await browser.close();
}

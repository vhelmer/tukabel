import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readArtSource, artHash } from './artSource.ts';
import { isObject, maskPng, maskPixels, readObjectMask } from './objectMask.ts';
import { ALPHA_LEVELS } from './objectMask.ts';
import sharp from 'sharp';

const execute = promisify(execFile);
const helper = fileURLToPath(
  new URL('../scripts/segmentation/segment.py', import.meta.url),
);
const matteHelper = fileURLToPath(
  new URL('../scripts/segmentation/matting.py', import.meta.url),
);
export interface SegmentationOptions {
  python?: string;
  checkpoint?: string;
  modelConfig?: string;
  mattingModel?: string;
}
async function python(options: SegmentationOptions) {
  if (options.python) return options.python;
  const local = path.resolve('.local-tools/segmentation/bin/python');
  try {
    await access(local);
    return local;
  } catch {
    return 'python3';
  }
}
function environment(options: SegmentationOptions) {
  return {
    ...process.env,
    TUKABEL_SAM2_CHECKPOINT: options.checkpoint ?? '',
    TUKABEL_SAM2_CONFIG:
      options.modelConfig ?? 'configs/sam2.1/sam2.1_hiera_t.yaml',
    TUKABEL_VITMATTE_MODEL:
      options.mattingModel ??
      path.resolve('.local-tools/models/vitmatte-small'),
    HF_HOME: path.resolve('.local-tools/huggingface'),
    HF_HUB_OFFLINE: '1',
    NUMBA_NUM_THREADS: '4',
  };
}
export async function segmentationStatus(options: SegmentationOptions) {
  try {
    const [{ stdout }, matte] = await Promise.all([
      execute(await python(options), [helper, '--status'], {
        timeout: 5000,
        maxBuffer: 16384,
        env: environment(options),
      }),
      execute(await python(options), [matteHelper, '--status'], {
        timeout: 5000,
        maxBuffer: 16384,
        env: environment(options),
      }).catch(() => ({ stdout: '{}' })),
    ]);
    const status = JSON.parse(stdout);
    const matting = JSON.parse(matte.stdout);
    return {
      grabcut: status.grabcut === true,
      sam2: status.sam2 === true,
      vitmatte: matting.vitmatte === true,
      closedForm: matting['closed-form'] === true,
    };
  } catch {
    return { grabcut: false, sam2: false, vitmatte: false, closedForm: false };
  }
}
export async function maskSource(root: string, input: unknown) {
  if (!isObject(input)) throw Error('Vyber zdroj.');
  const { source, width, height, sourceSha256 } = await readArtSource(
    root,
    input.source,
  );
  return { data: source.toString('base64'), width, height, sourceSha256 };
}
// Only one local inference at a time, independent of the project-save queue.
let running = false;
export async function segmentObject(
  root: string,
  input: unknown,
  options: SegmentationOptions,
) {
  if (!isObject(input) || !['grabcut', 'sam2'].includes(String(input.method)))
    throw Error('Neplatný segmentačný nástroj.');
  if (input.refineEdges !== undefined && typeof input.refineEdges !== 'boolean')
    throw Error('Neplatné nastavenie spresnenia obrysov.');
  if (input.detailPass !== undefined && typeof input.detailPass !== 'boolean')
    throw Error('Neplatné nastavenie detailného prechodu.');
  if (running)
    throw Error('Segmentácia už beží. Počkaj na dokončenie; nič sa neopakuje.');
  running = true;
  let directory: string | undefined;
  try {
    const original = await readArtSource(root, input.source);
    const prior = await readObjectMask(input.mask, original);
    const seeds = await maskPixels(
      input.seeds,
      original.width,
      original.height,
      [0, 64, 128, 255],
    );
    const status = await segmentationStatus(options);
    if (!status[input.method as 'grabcut' | 'sam2'])
      throw Error(
        input.method === 'sam2'
          ? 'SAM 2 potrebuje lokálnu inštaláciu a SAM2_CHECKPOINT; pozri README.'
          : 'Spusti npm run setup:segmentation a reštartuj Vite.',
      );
    directory = await mkdtemp(path.join(tmpdir(), 'tukabel-segmentation-'));
    await writeFile(path.join(directory, 'source.png'), original.source);
    await writeFile(
      path.join(directory, 'prior.png'),
      await maskPng(prior.pixels, original.width, original.height),
    );
    await writeFile(
      path.join(directory, 'seeds.png'),
      await maskPng(seeds, original.width, original.height),
    );
    try {
      await execute(
        await python(options),
        [
          helper,
          directory,
          String(input.method),
          input.refineEdges !== false ? 'source-edges' : 'none',
          input.detailPass === true ? 'detail' : 'standard',
        ],
        { timeout: 300000, maxBuffer: 32768, env: environment(options) },
      );
    } catch {
      throw Error(
        'Segmentácia nenašla spoľahlivý objekt alebo prekročila čas. Označ zeleným ťahom objekt a červeným pozadie, prípadne uprav masku ručne.',
      );
    }
    const result = await readFile(path.join(directory, 'result.png'));
    await maskPixels(
      result.toString('base64'),
      original.width,
      original.height,
    );
    if (artHash(await readFile(original.filename)) !== original.sourceSha256)
      throw Error('Zdroj sa medzitým zmenil. Maska sa nepoužila.');
    return {
      data: result.toString('base64'),
      width: original.width,
      height: original.height,
      sourceSha256: original.sourceSha256,
      method: input.method as 'grabcut' | 'sam2',
      refineEdges:
        input.method === 'sam2' ? input.refineEdges !== false : undefined,
      detailPass:
        input.method === 'sam2' ? input.detailPass === true : undefined,
    };
  } finally {
    running = false;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

export async function matteObject(
  root: string,
  input: unknown,
  options: SegmentationOptions,
) {
  if (
    !isObject(input) ||
    !['vitmatte', 'closed-form'].includes(String(input.method)) ||
    !Number.isInteger(input.radius) ||
    Number(input.radius) < 1 ||
    Number(input.radius) > 32 ||
    typeof input.decontaminate !== 'boolean'
  )
    throw Error('Neplatné nastavenie mattingu.');
  if (running) throw Error('Segmentácia už beží. Počkaj na dokončenie.');
  running = true;
  let directory: string | undefined;
  try {
    const original = await readArtSource(root, input.source);
    const prior = await readObjectMask(input.mask, original);
    const seeds = await maskPixels(
      input.seeds,
      original.width,
      original.height,
      [0, 64, 128, 255],
    );
    const status = await segmentationStatus(options);
    if (!(input.method === 'vitmatte' ? status.vitmatte : status.closedForm))
      throw Error(
        'Spusti npm run setup:matting a reštartuj Vite. Matting je iba lokálny.',
      );
    directory = await mkdtemp(path.join(tmpdir(), 'tukabel-matting-'));
    await writeFile(path.join(directory, 'source.png'), original.source);
    await writeFile(
      path.join(directory, 'prior.png'),
      await maskPng(prior.pixels, original.width, original.height),
    );
    await writeFile(
      path.join(directory, 'seeds.png'),
      await maskPng(seeds, original.width, original.height),
    );
    try {
      await execute(
        await python(options),
        [
          matteHelper,
          directory,
          String(input.method),
          String(input.radius),
          input.decontaminate ? 'decontaminate' : 'preserve',
        ],
        { timeout: 300000, maxBuffer: 32768, env: environment(options) },
      );
    } catch {
      throw Error(
        'Matting sa nedokončil. Označ isté vnútro objektu zeleným a pozadie červeným štetcom, prípadne zmenši pásmo hrany. Maska zostala zachovaná.',
      );
    }
    const result = await readFile(path.join(directory, 'result.png'));
    await maskPixels(
      result.toString('base64'),
      original.width,
      original.height,
      ALPHA_LEVELS,
    );
    if (artHash(await readFile(original.filename)) !== original.sourceSha256)
      throw Error('Zdroj sa medzitým zmenil. Matting sa nepoužil.');
    return {
      data: result.toString('base64'),
      width: original.width,
      height: original.height,
      sourceSha256: original.sourceSha256,
      method: prior.method,
      refineEdges: prior.refineEdges,
      detailPass: prior.detailPass,
      matting: {
        method: input.method as 'vitmatte' | 'closed-form',
        radius: Number(input.radius),
        decontaminate: input.decontaminate,
      },
      foreground: input.decontaminate
        ? (await readFile(path.join(directory, 'foreground.png'))).toString(
            'base64',
          )
        : undefined,
    };
  } finally {
    running = false;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

export async function matteForeground(
  original: Awaited<ReturnType<typeof readArtSource>>,
  pixels: Buffer,
  options: SegmentationOptions = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tukabel-matte-colors-'));
  try {
    await writeFile(path.join(directory, 'source.png'), original.source);
    await writeFile(
      path.join(directory, 'prior.png'),
      await maskPng(pixels, original.width, original.height),
    );
    try {
      await execute(
        await python(options),
        [matteHelper, directory, 'foreground'],
        { timeout: 300000, maxBuffer: 32768, env: environment(options) },
      );
    } catch {
      throw Error(
        'Dočistenie farieb potrebuje npm run setup:matting. Vypni Odstrániť farebný lem alebo nainštaluj lokálne nástroje.',
      );
    }
    const { data, info } = await sharp(
      await readFile(path.join(directory, 'foreground.png')),
    )
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== original.width || info.height !== original.height)
      throw Error('Neplatné rozmery mattingu.');
    // Export always owns the original source. A model can only unmix RGB at
    // fractional, previously opaque edges; its interior and intrinsic alpha are immutable.
    const result = Buffer.from(original.raw);
    for (let p = 0; p < pixels.length; p++)
      if (pixels[p]! > 0 && pixels[p]! < 255 && original.raw[p * 4 + 3] === 255)
        data.copy(result, p * 4, p * 4, p * 4 + 3);
    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

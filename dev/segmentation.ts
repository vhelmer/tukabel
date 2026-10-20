import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readArtSource, artHash } from './artSource.ts';
import { isObject, maskPng, maskPixels, readObjectMask } from './objectMask.ts';

const execute = promisify(execFile);
const helper = fileURLToPath(
  new URL('../scripts/segmentation/segment.py', import.meta.url),
);
export interface SegmentationOptions {
  python?: string;
  checkpoint?: string;
  modelConfig?: string;
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
  };
}
export async function segmentationStatus(options: SegmentationOptions) {
  try {
    const { stdout } = await execute(
      await python(options),
      [helper, '--status'],
      { timeout: 5000, maxBuffer: 16384, env: environment(options) },
    );
    const status = JSON.parse(stdout);
    return { grabcut: status.grabcut === true, sam2: status.sam2 === true };
  } catch {
    return { grabcut: false, sam2: false };
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
      [0, 128, 255],
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

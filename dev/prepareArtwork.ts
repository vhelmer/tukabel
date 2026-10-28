import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  realpath,
  lstat,
  copyFile,
  writeFile,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { readArtSource, artHash } from './artSource.ts';
import { placeGeneratedAsset } from './generatedAsset.ts';
import type { ArtResult } from './sceneArt.ts';

// A new local derivation of a paid output. Never overwrite the original archive
// or call any provider. The client retains the original target fingerprint.
export async function prepareArchivedExtraction(
  root: string,
  input: unknown,
): Promise<ArtResult> {
  if (!input || typeof input !== 'object') throw Error('Vyber uložený výřez.');
  const request = input as Record<string, unknown>;
  if (
    typeof request.manifest !== 'string' ||
    !/^scene-art\/[a-f0-9-]{36}\/recipe\.json$/.test(request.manifest) ||
    typeof request.source !== 'string' ||
    ![1, 2].includes(Number(request.scale)) ||
    typeof request.scale !== 'number'
  )
    throw Error('Neplatný uložený výřez nebo rozlišení.');
  const directory = path.dirname(path.join(root, request.manifest));
  if ((await realpath(directory)) !== path.resolve(directory))
    throw Error('Archiv nesmí být symbolický odkaz.');
  async function file(name: string) {
    const filename = path.join(directory, name),
      stat = await lstat(filename);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (await realpath(filename)) !== filename
    )
      throw Error('Neplatný soubor archivu.');
    return filename;
  }
  const manifest = await file('recipe.json');
  if ((await lstat(manifest)).size > 1024 * 1024)
    throw Error('Příliš velký recept.');
  const recipe = JSON.parse(await readFile(manifest, 'utf8'));
  const original = await readArtSource(root, request.source);
  if (
    recipe.operation !== 'extract' ||
    recipe.extraction?.method !== 'openai' ||
    recipe.source !== request.source ||
    recipe.sourceSha256 !== original.sourceSha256 ||
    recipe.debugOnly
  )
    throw Error('Uložený výřez neodpovídá aktuálnímu zdroji.');
  const target = recipe.extraction.target;
  if (
    !target ||
    !['x', 'y', 'width', 'height'].every((k) => Number.isInteger(target[k])) ||
    target.x < 0 ||
    target.y < 0 ||
    target.width < 1 ||
    target.height < 1 ||
    target.x + target.width > original.width ||
    target.y + target.height > original.height
  )
    throw Error('Neplatný původní rám výřezu.');
  const returned = await readArtSource(
    root,
    path
      .relative(root, await file('extraction-returned.png'))
      .split(path.sep)
      .join('/'),
  );
  const background = await readArtSource(
    root,
    path
      .relative(root, await file('image.png'))
      .split(path.sep)
      .join('/'),
  );
  const restored = await readArtSource(
    root,
    path
      .relative(root, await file('provider-restored.png'))
      .split(path.sep)
      .join('/'),
  );
  if (
    [background, restored].some(
      (p) => p.width !== original.width || p.height !== original.height,
    )
  )
    throw Error('Neplatné rozměry opraveného pozadí.');
  const placed = await placeGeneratedAsset(
    returned.bytes,
    target,
    original.width,
    original.height,
    { alphaCutoff: 1, scale: request.scale as 1 | 2 },
  );
  const parent = path.join(root, 'scene-art');
  if ((await realpath(parent)) !== path.resolve(parent))
    throw Error('Archiv nesmí být symbolický odkaz.');
  const id = randomUUID(),
    prefix = `scene-art/${id}`,
    staging = path.join(parent, `.tmp-${id}`);
  await mkdir(staging);
  try {
    for (const name of [
      'source.png',
      'mask.png',
      'repair-mask.png',
      'object-mask.png',
      'ownership-mask.png',
      'provider-input.png',
      'provider-mask.png',
      'provider-returned.png',
      'provider-restored.png',
      'image.png',
      'expanded-mask.png',
      'round-trip.png',
      'provider-difference.png',
      'extraction-input.png',
      'extraction-guide.png',
      'extraction-returned.png',
    ]) {
      let filename;
      try {
        filename = await file(name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      await copyFile(filename, path.join(staging, name));
    }
    for (const [name, bytes] of [
      ['cutout.png', placed.image],
      ['cutout-full.png', placed.full],
      [
        'preview.png',
        await sharp(original.source)
          .composite([{ input: placed.full }])
          .png()
          .toBuffer(),
      ],
      [
        'reassembled.png',
        await sharp(background.source)
          .composite([{ input: placed.full }])
          .png()
          .toBuffer(),
      ],
    ] as const)
      await writeFile(path.join(staging, name), bytes, { flag: 'wx' });
    await writeFile(
      path.join(staging, 'recipe.json'),
      JSON.stringify(
        {
          ...recipe,
          derivedFrom: request.manifest,
          derivedProviderSha256: returned.sourceSha256,
          assetScale: request.scale,
          alphaCutoff: 1,
          blockedReason: undefined,
          assetDiagnostic: undefined,
          cutoutFrame: placed.frame,
          cutoutFull: 'cutout-full.png',
          preview: 'preview.png',
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
    if (artHash(await readFile(original.filename)) !== original.sourceSha256)
      throw Error('Zdroj se mezitím změnil. Výsledek se nepoužil.');
    await rename(staging, path.join(parent, id));
    return {
      operation: 'extract',
      source: request.source,
      image: `${prefix}/image.png`,
      backgrounds: {
        masked: `${prefix}/image.png`,
        restored: `${prefix}/provider-restored.png`,
      },
      extractionMethod: 'openai',
      assetScale: request.scale as 1 | 2,
      cutout: `${prefix}/cutout.png`,
      cutoutFull: `${prefix}/cutout-full.png`,
      cutoutFrame: placed.frame,
      preview: `${prefix}/preview.png`,
      reassembled: `${prefix}/reassembled.png`,
      original: `${prefix}/source.png`,
      manifest: `${prefix}/recipe.json`,
      width: original.width,
      height: original.height,
      model: typeof recipe.model === 'string' ? recipe.model : undefined,
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

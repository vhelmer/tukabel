import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { readArtSource } from './artSource.ts';
import { validateAlignmentRecord } from './registerAsset.ts';
import { inspectAssetAlpha } from './generatedAsset.ts';
import type { ArtResult } from './sceneArt.ts';

// Reopen published removals after a Vite restart without spending API credits.
// Only known filenames below real UUID directories are exposed; recipe paths
// are never trusted. A stale source cannot be silently overwritten.
export async function artworkHistory(
  root: string,
  input: unknown,
): Promise<ArtResult[]> {
  if (!input || typeof input !== 'object' || !('source' in input))
    throw Error('Vyber zdroj.');
  const original = await readArtSource(root, input.source);
  const folder = path.join(root, 'scene-art');
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  if ((await realpath(folder)) !== path.resolve(folder))
    throw Error('Archiv nesmí být symbolický odkaz.');
  const results: ArtResult[] = [];
  const recent = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && /^[a-f0-9-]{36}$/.test(e.name))
      .map(async (entry) => ({
        entry,
        modified: (await lstat(path.join(folder, entry.name))).mtimeMs,
      })),
  );
  recent.sort((a, b) => b.modified - a.modified);
  for (const { entry } of recent.slice(0, 200)) {
    const directory = path.join(folder, entry.name);
    try {
      if ((await realpath(directory)) !== path.resolve(directory)) continue;
      const filename = path.join(directory, 'recipe.json');
      const stat = await lstat(filename);
      if (
        !stat.isFile() ||
        stat.size > 1024 * 1024 ||
        (await realpath(filename)) !== filename
      )
        continue;
      const recipe = JSON.parse(await readFile(filename, 'utf8'));
      const prefix = `scene-art/${entry.name}`;
      const isAsset = recipe.operation === 'asset';
      const appliedVariant =
        !isAsset &&
        (input.source === `${prefix}/image.png` ||
          input.source === `${prefix}/provider-restored.png`);
      const reference = appliedVariant
        ? await readArtSource(root, recipe.source)
        : original;
      if (
        (!appliedVariant && recipe.source !== input.source) ||
        recipe.sourceSha256 !== reference.sourceSha256 ||
        reference.width !== original.width ||
        reference.height !== original.height ||
        !['extract', 'remove', 'asset'].includes(recipe.operation) ||
        recipe.debugOnly ||
        (recipe.blockedReason && !recipe.assetDiagnostic)
      )
        continue;
      async function png(name: string, fullSize = true) {
        const file = path.join(directory, name);
        if (!(await lstat(file)).isFile() || (await realpath(file)) !== file)
          throw Error('Neplatný archiv.');
        const meta = await sharp(file).metadata();
        if (
          meta.format !== 'png' ||
          (fullSize &&
            (meta.width !== original.width || meta.height !== original.height))
        )
          throw Error('Neplatné rozměry archivu.');
        return `${prefix}/${name}`;
      }
      if (isAsset) {
        if (
          recipe.assetScale !== undefined &&
          ![1, 2].includes(recipe.assetScale)
        )
          continue;
        const target = recipe.assetPlacement?.target;
        if (
          !target ||
          !['x', 'y', 'width', 'height'].every((k) =>
            Number.isInteger(target[k]),
          ) ||
          target.x < 0 ||
          target.y < 0 ||
          target.width < 1 ||
          target.height < 1 ||
          target.x + target.width > original.width ||
          target.y + target.height > original.height
        )
          continue;
        const provider = await png('provider-returned.png', false);
        const source = await png('source.png');
        const image = await png('image.png', false);
        if (recipe.blockedReason) {
          results.push({
            operation: 'asset',
            source: String(input.source),
            image,
            original: source,
            width: original.width,
            height: original.height,
            manifest: `${prefix}/recipe.json`,
            blockedReason: String(recipe.blockedReason),
            assetScale: recipe.assetScale === 2 ? 2 : 1,
            assetDiagnostic: {
              ...(await inspectAssetAlpha(
                await readFile(path.join(root, provider)),
              )),
              image: provider,
            },
          });
          continue;
        }
        const c = recipe.cutoutFrame;
        if (
          !c ||
          !['x', 'y', 'width', 'height', 'sourceWidth', 'sourceHeight'].every(
            (k) => Number.isInteger(c[k]),
          ) ||
          c.x < 0 ||
          c.y < 0 ||
          c.width < 1 ||
          c.height < 1 ||
          c.sourceWidth !== original.width ||
          c.sourceHeight !== original.height ||
          c.x + c.width > original.width ||
          c.y + c.height > original.height
        )
          continue;
        const scale = recipe.assetScale === 2 ? 2 : 1;
        const meta = await sharp(path.join(root, image)).metadata();
        if (meta.width !== c.width * scale || meta.height !== c.height * scale)
          continue;
        results.push({
          operation: 'asset',
          source: String(input.source),
          image,
          original: source,
          preview: await png('preview.png'),
          cutoutFull: await png('cutout-full.png'),
          cutoutFrame: c,
          assetScale: scale,
          width: original.width,
          height: original.height,
          manifest: `${prefix}/recipe.json`,
          model: typeof recipe.model === 'string' ? recipe.model : undefined,
        });
        continue;
      }
      if (recipe.blockedReason && recipe.assetDiagnostic) {
        if (appliedVariant) continue;
        const image = await png('extraction-returned.png', false);
        results.push({
          operation: recipe.operation,
          source: String(input.source),
          image: await png('image.png'),
          width: original.width,
          height: original.height,
          manifest: `${prefix}/recipe.json`,
          blockedReason: String(recipe.blockedReason),
          extractionMethod: 'openai',
          assetScale: recipe.assetScale === 2 ? 2 : 1,
          assetDiagnostic: {
            ...(await inspectAssetAlpha(
              await readFile(path.join(root, image)),
            )),
            image,
          },
        });
        continue;
      }
      const image = await png('image.png'),
        restored = await png('provider-restored.png');
      let cutoutFrame: ArtResult['cutoutFrame'];
      if (!appliedVariant && recipe.cutoutFrame) {
        const c = recipe.cutoutFrame;
        if (
          !['x', 'y', 'width', 'height', 'sourceWidth', 'sourceHeight'].every(
            (k) => Number.isInteger(c[k]),
          ) ||
          c.x < 0 ||
          c.y < 0 ||
          c.width < 1 ||
          c.height < 1 ||
          c.sourceWidth !== original.width ||
          c.sourceHeight !== original.height ||
          c.x + c.width > original.width ||
          c.y + c.height > original.height
        )
          continue;
        cutoutFrame = c;
      }
      const cutout =
        recipe.operation === 'extract' && !appliedVariant
          ? await png('cutout.png', !cutoutFrame)
          : undefined;
      if (cutoutFrame && cutout) {
        const meta = await sharp(path.join(root, cutout)).metadata();
        if (
          meta.width !==
            cutoutFrame.width * (recipe.assetScale === 2 ? 2 : 1) ||
          meta.height !== cutoutFrame.height * (recipe.assetScale === 2 ? 2 : 1)
        )
          continue;
      }
      const alignment = recipe.alignment
        ? validateAlignmentRecord(
            recipe.alignment,
            original.width,
            original.height,
          )
        : undefined;
      if (
        alignment &&
        cutoutFrame &&
        ['x', 'y', 'width', 'height'].some(
          (k) =>
            alignment.frame[k as keyof typeof alignment.frame] !==
            cutoutFrame[k as keyof typeof cutoutFrame],
        )
      )
        continue;
      results.push({
        // Switching an already applied background must not duplicate its object.
        operation: appliedVariant ? 'remove' : recipe.operation,
        source: path
          .relative(root, original.filename)
          .split(path.sep)
          .join('/'),
        image,
        assetScale: recipe.assetScale === 2 ? 2 : 1,
        alignment,
        alignmentMatches:
          recipe.alignment?.method === 'features'
            ? await png('alignment-matches.png', false)
            : undefined,
        extractionMethod:
          recipe.extraction?.method === 'openai' ? 'openai' : undefined,
        reassembled:
          recipe.extraction?.method === 'openai' && !appliedVariant
            ? await png('reassembled.png')
            : undefined,
        preview:
          recipe.extraction?.method === 'openai' && !appliedVariant
            ? await png('preview.png')
            : undefined,
        width: original.width,
        height: original.height,
        manifest: `${prefix}/recipe.json`,
        backgrounds: { restored, masked: image },
        cutout,
        cutoutFrame,
        cutoutFull: cutoutFrame ? await png('cutout-full.png') : cutout,
        original: await png('source.png'),
      });
    } catch {
      /* Incomplete/legacy/edited archives are not usable results. */
    }
  }
  return results.slice(0, 30);
}

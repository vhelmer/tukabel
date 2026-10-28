import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { readArtSource } from './artSource.ts';
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
      if (!stat.isFile() || stat.size > 1024 * 1024) continue;
      const recipe = JSON.parse(await readFile(filename, 'utf8'));
      const prefix = `scene-art/${entry.name}`;
      const appliedVariant =
        input.source === `${prefix}/image.png` ||
        input.source === `${prefix}/provider-restored.png`;
      const reference = appliedVariant
        ? await readArtSource(root, recipe.source)
        : original;
      if (
        (!appliedVariant && recipe.source !== input.source) ||
        recipe.sourceSha256 !== reference.sourceSha256 ||
        reference.width !== original.width ||
        reference.height !== original.height ||
        !['extract', 'remove'].includes(recipe.operation) ||
        recipe.debugOnly ||
        (recipe.blockedReason && !recipe.assetDiagnostic)
      )
        continue;
      async function png(name: string, fullSize = true) {
        const file = path.join(directory, name);
        if (!(await lstat(file)).isFile()) throw Error('Neplatný archiv.');
        const meta = await sharp(file).metadata();
        if (
          meta.format !== 'png' ||
          (fullSize &&
            (meta.width !== original.width || meta.height !== original.height))
        )
          throw Error('Neplatné rozměry archivu.');
        return `${prefix}/${name}`;
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
      results.push({
        // Switching an already applied background must not duplicate its object.
        operation: appliedVariant ? 'remove' : recipe.operation,
        source: path
          .relative(root, original.filename)
          .split(path.sep)
          .join('/'),
        image,
        assetScale: recipe.assetScale === 2 ? 2 : 1,
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

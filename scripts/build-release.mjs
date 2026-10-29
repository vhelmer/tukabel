// Frontend-only release build: bundles just the assets the game content really
// references, resized to their largest on-screen size and re-encoded
// (PNG/JPG/WebP -> AVIF, WAV -> gapless MP3). Sources in src/assets stay untouched.
//
//   npm run build:release                  # best preset whose zip fits 5 MB
//   node scripts/build-release.mjs --budget 8
//   node scripts/build-release.mjs --preset 0
//
// Presets go from best to smallest; `scale` is the largest zoom (canvas px per
// location unit) kept in detail.
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { encodeMp3, readWav } from './release/mp3.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = path.join(root, 'src/assets');
const work = path.join(root, '.release');
const outAssets = path.join(work, 'assets');
const cacheDir = path.join(work, 'cache');

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`--${name} expects a non-negative number`);
  return value;
}
// quality: AVIF 0-100; kbps: stereo 44.1 kHz music/effects, 22 kHz ambience,
// speech. Mono downmix of stereo effects/music from preset 2.
// prettier-ignore
const PRESETS = [
  [1.5, 60, 128, false, 48, 48],
  [1.25, 55, 96, false, 40, 40],
  [1, 50, 64, true, 40, 32],
  [0.85, 45, 56, true, 32, 32],
  [0.75, 40, 48, true, 32, 24],
  [0.6, 35, 40, true, 24, 24],
].map(([scale, quality, stereo, downmix, ambient, speech]) => ({
  scale, quality, stereo, downmix, ambient, speech,
}));
const BUDGET = option('budget', 0);
const FIXED = process.argv.includes('--preset') ? option('preset', 0) : -1;
if (FIXED >= PRESETS.length || !Number.isInteger(FIXED))
  throw new Error(`--preset expects 0..${PRESETS.length - 1}`);
// Item icons are drawn into ~52 unit HUD slots and a slightly larger drag ghost.
const ITEM_BOX = 128;
const CURSOR_DEFAULT = 40;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']);
// SVGs wrapping big embedded rasters are cheaper as a sized AVIF.
const rasterSvg = (id) => {
  if (path.extname(id).toLowerCase() !== '.svg') return false;
  const file = path.join(assetsDir, id);
  return (
    fs.statSync(file).size > 50_000 &&
    fs.readFileSync(file, 'utf8').includes('data:image/')
  );
};

const project = JSON.parse(
  fs.readFileSync(path.join(root, 'src/game/content/project.json'), 'utf8'),
);
const isFile = (id) => {
  try {
    return fs.statSync(path.join(assetsDir, id)).isFile();
  } catch {
    return false;
  }
};

// 1. Drop animation clips nothing points at, and portraits the game never shows.
const animations = project.animations ?? [];
const outside = JSON.stringify({ ...project, animations: undefined });
const usedAnimations = animations.filter((a) =>
  outside.includes(JSON.stringify(a.id)),
);
const release = structuredClone({
  ...project,
  animations: project.animations ? usedAnimations : undefined,
});
for (const dialogue of release.dialogues)
  for (const node of dialogue.nodes) delete node.portrait;
const animationById = new Map(release.animations?.map((a) => [a.id, a]));

// 2. Every string in the pruned content that names a file is a used asset.
const used = new Set();
(function walk(value) {
  if (typeof value === 'string') {
    if (isFile(value)) used.add(value);
  } else if (value && typeof value === 'object')
    Object.values(value).forEach(walk);
})(release);
// Statically imported WAVs and rasters are swapped for their encodes by the
// Vite plugin as well. Code may depend on their pixels, so rasters keep size.
const staticAssets = [];
(function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'editor') scan(file);
    } else if (/\.tsx?$/.test(entry.name)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const [, spec] of text.matchAll(
        /from '((?:\.\.?\/)+assets\/[^']+\.(?:wav|png|jpe?g|webp))'/g,
      )) {
        const id = path.relative(assetsDir, path.resolve(dir, spec));
        if (!staticAssets.includes(id)) staticAssets.push(id);
      }
    }
  }
})(path.join(root, 'src'));

// 3. Largest needed display factor per image, relative to its native pixels.
// Scaled needs grow with the preset zoom; cursors are fixed device pixels.
const meta = new Map();
async function size(id) {
  if (!meta.has(id)) {
    const m = await sharp(path.join(assetsDir, id)).metadata();
    meta.set(id, { width: m.width, height: m.height });
  }
  return meta.get(id);
}
const needs = new Map();
function need(id, factor, scaled = true) {
  if (!id || !(IMAGE_EXT.has(path.extname(id).toLowerCase()) || rasterSvg(id)))
    return;
  const entry = needs.get(id) ?? { scaled: 0, fixed: 0 };
  if (scaled) entry.scaled = Math.max(entry.scaled, factor);
  else entry.fixed = Math.max(entry.fixed, factor);
  needs.set(id, entry);
}
async function cover(id, width, height) {
  if (!id || !isFile(id)) return;
  const s = await size(id);
  need(id, Math.max(width / s.width, height / s.height));
}
async function contain(id, width, height, scaled = true) {
  if (!id || !isFile(id)) return;
  const s = await size(id);
  need(id, Math.min(width / s.width, height / s.height), scaled);
}
const animationFields = [
  'idle',
  'blink',
  'gesture',
  'talk',
  'onClick',
  'onUse',
];
function clipImages(clipId) {
  const clip = animationById.get(clipId);
  return clip ? [clip.source, ...clip.frames] : [];
}

for (const scene of release.scenes) {
  await cover(scene.background, scene.width, scene.height);
  for (const hotspot of scene.hotspots) {
    if (hotspot.clipMask)
      await cover(hotspot.clipMask, scene.width, scene.height);
    const { width, height } = hotspot.bounds;
    const stretch = hotspot.imageFit === 'stretch';
    const images = [
      hotspot.image,
      ...animationFields.flatMap((field) =>
        clipImages(hotspot.animation?.[field]),
      ),
    ];
    for (const id of images)
      if (stretch) await cover(id, width, height);
      else await contain(id, width, height);
    const cursor = (hotspot.cursorSize ?? CURSOR_DEFAULT) * 2;
    for (const id of [
      hotspot.cursorImage,
      ...clipImages(hotspot.cursorAnimation),
    ])
      await contain(id, cursor, cursor, false);
  }
}
for (const item of release.items) await contain(item.image, ITEM_BOX, ITEM_BOX);
if (release.worldMap)
  await cover(
    release.worldMap.image,
    release.worldMap.width,
    release.worldMap.height,
  );
// Referenced images without a known placement keep full resolution.
for (const id of [...used, ...staticAssets])
  if (!needs.has(id)) need(id, 1, false);

// Clip frames are cut by regions in source pixels: all images of one source
// share one factor, so every frame keeps the source canvas exactly.
const groups = new Map();
for (const clip of release.animations ?? []) {
  const group = groups.get(clip.source) ?? new Set([clip.source]);
  clip.frames.forEach((frame) => group.add(frame));
  groups.set(clip.source, group);
}
for (const group of groups.values()) {
  const members = [...group];
  // Plain vector clips stay SVG and need no shared raster size.
  if (!members.some((id) => needs.has(id))) continue;
  if (!members.every((id) => needs.has(id)))
    throw new Error(`Clip images of ${members[0]} mix raster and vector`);
  const shared = { scaled: 0, fixed: 0 };
  for (const id of members) {
    shared.scaled = Math.max(shared.scaled, needs.get(id).scaled);
    shared.fixed = Math.max(shared.fixed, needs.get(id).fixed);
  }
  for (const id of members) needs.set(id, shared);
}

// Frames used only by regional clips are drawn and hit-tested inside their
// region alone; clearing the rest leaves almost nothing to encode.
const regionsOnly = new Map();
const wholeImages = new Set(release.animations?.map((clip) => clip.source));
(function walk(value, key) {
  if (key === 'animations') return;
  if (typeof value === 'string') wholeImages.add(value);
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) walk(v, k);
})(release);
for (const clip of release.animations ?? [])
  for (const frame of clip.frames)
    if (!clip.region) wholeImages.add(frame);
    else
      regionsOnly.set(frame, [...(regionsOnly.get(frame) ?? []), clip.region]);
for (const id of wholeImages) regionsOnly.delete(id);

// 4. Encode one preset. Outputs are cached by source hash + parameters.
fs.mkdirSync(cacheDir, { recursive: true });
const mb = (bytes) => (bytes / 1e6).toFixed(2) + ' MB';

async function encodeAssets(preset) {
  fs.rmSync(outAssets, { recursive: true, force: true });
  const manifest = {};
  const targets = new Map();
  const stats = { files: 0, before: 0, after: 0 };
  function cached(id, params, extension, produce) {
    const source = fs.readFileSync(path.join(assetsDir, id));
    const key = createHash('sha256')
      .update(source)
      .update(JSON.stringify(params))
      .digest('hex');
    const cacheFile = path.join(cacheDir, key + extension);
    return (async () => {
      if (!fs.existsSync(cacheFile)) {
        const data = await produce(source);
        fs.writeFileSync(cacheFile + '.tmp', data);
        fs.renameSync(cacheFile + '.tmp', cacheFile);
      }
      const outId = id + extension;
      const target = path.join(outAssets, outId);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(cacheFile, target);
      manifest[id] = outId;
      stats.files++;
      stats.before += source.length;
      stats.after += fs.statSync(target).size;
    })();
  }

  function imageJob(id) {
    const svg = path.extname(id).toLowerCase() === '.svg';
    const need = needs.get(id);
    // Vector wrappers may render above their nominal size, rasters never upscale.
    const factor = Math.min(
      svg ? 2 : 1,
      Math.max(need.scaled * preset.scale, need.fixed),
    );
    if (!(factor > 0)) throw new Error(`No display size for ${id}`);
    return size(id).then((native) => {
      const width = Math.max(1, Math.round(native.width * factor));
      const height = Math.max(1, Math.round(native.height * factor));
      targets.set(id, { width, height, native });
      const regions = regionsOnly.get(id);
      const params = { width, height, quality: preset.quality, regions, v: 3 };
      return cached(id, params, '.avif', async (source) => {
        let image = sharp(source, svg ? { density: 72 * factor } : {}).resize(
          width,
          height,
          { fit: 'fill', kernel: 'lanczos3' },
        );
        if (regions) {
          const { data, info } = await image
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          // A small margin keeps lossy blocks at the region edge intact.
          const keep = regions.map((r) => ({
            x0: Math.floor((r.x * width) / native.width) - 4,
            y0: Math.floor((r.y * height) / native.height) - 4,
            x1: Math.ceil(((r.x + r.width) * width) / native.width) + 4,
            y1: Math.ceil(((r.y + r.height) * height) / native.height) + 4,
          }));
          for (let y = 0; y < info.height; y++)
            for (let x = 0; x < info.width; x++)
              if (
                !keep.some(
                  (k) => x >= k.x0 && x < k.x1 && y >= k.y0 && y < k.y1,
                )
              )
                data.fill(
                  0,
                  (y * info.width + x) * 4,
                  (y * info.width + x + 1) * 4,
                );
          image = sharp(data, { raw: info });
        }
        return image.avif({ quality: preset.quality, effort: 4 }).toBuffer();
      });
    });
  }
  function audioJob(id) {
    const params = { ...preset, scale: undefined, quality: undefined, v: 2 };
    return cached(id, params, '.mp3', (source) => {
      let wav = readWav(source);
      if (wav.channels === 2 && preset.downmix) {
        const [left, right] = wav.planes;
        const mono = new Int16Array(wav.samples);
        for (let i = 0; i < mono.length; i++)
          mono[i] = (left[i] + right[i]) >> 1;
        wav = { ...wav, channels: 1, planes: [mono] };
      }
      const kbps = id.startsWith('speech/')
        ? preset.speech
        : wav.sampleRate < 32000
          ? preset.ambient
          : wav.channels === 2
            ? preset.stereo
            : Math.max(32, preset.stereo);
      return encodeMp3(wav, kbps);
    });
  }
  function copyJob(id, minifyJson) {
    return cached(id, { v: 1 }, '', (source) =>
      minifyJson ? Buffer.from(JSON.stringify(JSON.parse(source))) : source,
    );
  }

  const queue = [...used, ...staticAssets].map((id) => {
    const ext = path.extname(id).toLowerCase();
    if (needs.has(id)) return () => imageJob(id);
    if (ext === '.wav') return () => audioJob(id);
    return () => copyJob(id, ext === '.json');
  });
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) await queue.shift()();
    }),
  );

  // 5. Regions are source pixels: move edges with the resized canvas. Rounding
  // edges (not sizes) keeps neighbouring regions from overlapping.
  const content = structuredClone(release);
  for (const clip of content.animations ?? []) {
    if (!clip.region) continue;
    const t = targets.get(clip.source);
    if (!t) continue;
    const sx = t.width / t.native.width;
    const sy = t.height / t.native.height;
    const x = Math.round(clip.region.x * sx);
    const y = Math.round(clip.region.y * sy);
    clip.region = {
      x,
      y,
      width: Math.max(
        1,
        Math.round((clip.region.x + clip.region.width) * sx) - x,
      ),
      height: Math.max(
        1,
        Math.round((clip.region.y + clip.region.height) * sy) - y,
      ),
    };
  }

  fs.writeFileSync(path.join(work, 'project.json'), JSON.stringify(content));
  fs.writeFileSync(
    path.join(work, 'assetFiles.ts'),
    `// Generated by scripts/build-release.mjs.
const urls = import.meta.glob<string>('./assets/**/*', {
  eager: true,
  query: '?url',
  import: 'default',
});
const manifest: Record<string, string> = ${JSON.stringify(manifest, null, 2)};
export const files: Record<string, string> = Object.fromEntries(
  Object.entries(manifest).map(([id, file]) => [id, urls['./assets/' + file]!]),
);
`,
  );
  fs.writeFileSync(
    path.join(work, 'manifest.json'),
    JSON.stringify({ preset, manifest, staticAssets }, null, 2),
  );
  return stats;
}

// 6. Vite build of the game only (no editor plugin, no dev middleware).
function viteBuild() {
  const vite = spawnSync(
    process.execPath,
    [
      path.join(root, 'node_modules/vite/bin/vite.js'),
      'build',
      '--config',
      'vite.release.config.ts',
      '--logLevel',
      'warn',
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (vite.status !== 0) process.exit(vite.status ?? 1);
}

// Deflated size plus local/central zip headers per file.
function zipSize(dir) {
  let total = 22;
  for (const entry of fs.readdirSync(dir, {
    withFileTypes: true,
    recursive: true,
  })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const data = fs.readFileSync(file);
    const name = path.relative(dir, file).length;
    total +=
      Math.min(data.length, deflateRawSync(data, { level: 9 }).length) +
      76 +
      2 * name;
  }
  return total;
}

console.log(
  `Animace: ${usedAnimations.length}/${animations.length} použitých.`,
);
const order = FIXED >= 0 ? [FIXED] : PRESETS.map((_, i) => i);
for (const index of order) {
  const preset = PRESETS[index];
  const stats = await encodeAssets(preset);
  viteBuild();
  const zip = zipSize(path.join(root, 'dist-release'));
  console.log(
    `Preset ${index} (scale ${preset.scale}, AVIF ${preset.quality}, ` +
      `hudba ${preset.stereo} kbps${preset.downmix ? ' mono' : ''}): ` +
      `${stats.files} assetů ${mb(stats.before)} -> ${mb(stats.after)}, zip ~${mb(zip)}`,
  );
  if (!BUDGET || zip <= BUDGET * 1e6) process.exit(0);
}
console.error(`Žádný preset se nevejde do ${BUDGET} MB.`);
process.exit(1);

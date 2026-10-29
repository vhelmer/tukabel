// Frontend-only release build: bundles just the assets the game content really
// references, resized to their largest on-screen size and re-encoded
// (PNG/JPG -> WebP, WAV -> gapless MP3). Sources in src/assets stay untouched.
//
//   npm run build:release [-- --scale 1.5] [-- --quality 82]
//
// --scale is the largest zoom (canvas px per location unit) kept in detail.
import { createHash } from 'node:crypto';
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
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`--${name} expects a positive number`);
  return value;
}
const SCALE = option('scale', 1.5);
const QUALITY = option('quality', 82);
// Item icons are drawn into ~52 unit HUD slots and a slightly larger drag ghost.
const ITEM_BOX = 128;
const CURSOR_DEFAULT = 40;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']);
// SVGs wrapping big embedded rasters are cheaper as a sized WebP.
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
// Statically imported WAVs are swapped for MP3 by the Vite plugin as well.
const staticWavs = [];
(function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'editor') scan(file);
    } else if (/\.tsx?$/.test(entry.name)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const [, spec] of text.matchAll(
        /from '((?:\.\.?\/)+assets\/[^']+\.wav)'/g,
      )) {
        const id = path.relative(assetsDir, path.resolve(dir, spec));
        if (!staticWavs.includes(id)) staticWavs.push(id);
      }
    }
  }
})(path.join(root, 'src'));

// 3. Largest needed scale factor per image, relative to its native pixels.
const meta = new Map();
async function size(id) {
  if (!meta.has(id)) {
    const m = await sharp(path.join(assetsDir, id)).metadata();
    meta.set(id, { width: m.width, height: m.height });
  }
  return meta.get(id);
}
const factors = new Map();
function need(id, factor) {
  if (!id || !(IMAGE_EXT.has(path.extname(id).toLowerCase()) || rasterSvg(id)))
    return;
  factors.set(id, Math.max(factors.get(id) ?? 0, factor));
}
async function cover(id, width, height) {
  if (!id || !isFile(id)) return;
  const s = await size(id);
  need(id, Math.max(width / s.width, height / s.height) * SCALE);
}
async function contain(id, width, height, scale = SCALE) {
  if (!id || !isFile(id)) return;
  const s = await size(id);
  need(id, Math.min(width / s.width, height / s.height) * scale);
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
      await contain(id, cursor, cursor, 1);
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
for (const id of used) if (!factors.has(id)) need(id, 1);

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
  if (!members.some((id) => factors.has(id))) continue;
  if (!members.every((id) => factors.has(id)))
    throw new Error(`Clip images of ${members[0]} mix raster and vector`);
  const factor = Math.max(...members.map((id) => factors.get(id)));
  for (const id of members) factors.set(id, factor);
}

// 4. Encode. Outputs are cached by source hash + parameters.
fs.mkdirSync(cacheDir, { recursive: true });
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
  // Vector wrappers may render above their nominal size, rasters never upscale.
  const factor = Math.min(svg ? 2 : 1, factors.get(id));
  if (!(factor > 0)) throw new Error(`No display size for ${id}`);
  return size(id).then((native) => {
    const width = Math.max(1, Math.round(native.width * factor));
    const height = Math.max(1, Math.round(native.height * factor));
    targets.set(id, { width, height, native });
    // Already-WebP sources that keep their size are not re-encoded.
    if (factor === 1 && path.extname(id).toLowerCase() === '.webp')
      return copyJob(id, false);
    return cached(id, { width, height, QUALITY, v: 1 }, '.webp', (source) =>
      sharp(source, svg ? { density: 72 * factor } : {})
        .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
        .webp({
          quality: QUALITY,
          alphaQuality: 90,
          effort: 6,
          smartSubsample: true,
        })
        .toBuffer(),
    );
  });
}
function audioJob(id) {
  return cached(id, { v: 1 }, '.mp3', (source) => {
    const wav = readWav(source);
    const kbps = wav.sampleRate >= 32000 ? 64 * wav.channels : 48;
    return encodeMp3(wav, kbps);
  });
}
function copyJob(id, minifyJson) {
  return cached(id, { v: 1 }, '', (source) =>
    minifyJson ? Buffer.from(JSON.stringify(JSON.parse(source))) : source,
  );
}

const jobs = [...used, ...staticWavs].map((id) => {
  const ext = path.extname(id).toLowerCase();
  if (factors.has(id)) return () => imageJob(id);
  if (ext === '.wav') return () => audioJob(id);
  return () => copyJob(id, ext === '.json');
});
const queue = [...jobs];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) await queue.shift()();
  }),
);

// 5. Regions are source pixels: move edges with the resized canvas. Rounding
// edges (not sizes) keeps neighbouring regions from overlapping.
for (const clip of release.animations ?? []) {
  if (!clip.region) continue;
  const t = targets.get(clip.source);
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

fs.writeFileSync(path.join(work, 'project.json'), JSON.stringify(release));
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
  JSON.stringify(
    { scale: SCALE, quality: QUALITY, manifest, staticWavs },
    null,
    2,
  ),
);

const mb = (bytes) => (bytes / 1e6).toFixed(1) + ' MB';
console.log(
  `Animace: ${usedAnimations.length}/${animations.length} použitých. ` +
    `Assety: ${stats.files} souborů, ${mb(stats.before)} -> ${mb(stats.after)}.`,
);

// 6. Vite build of the game only (no editor plugin, no dev middleware).
const vite = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules/vite/bin/vite.js'),
    'build',
    '--config',
    'vite.release.config.ts',
  ],
  { cwd: root, stdio: 'inherit' },
);
if (vite.status !== 0) process.exit(vite.status ?? 1);

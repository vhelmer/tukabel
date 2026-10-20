import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const output = path.resolve(
  process.argv[2] || '.local-tools/matting-comparison',
);
await mkdir(output, { recursive: true });
const room = await readFile('src/assets/demo-room.svg', 'utf8');
const router = room
  .split('<!-- Router:')[1]
  .split('-->')[1]
  .split('<!-- A mug')[0];
const w = 640,
  h = 400;
const outline =
  '<g stroke="#262b34" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">';
const cartoon = `${outline}<path d="M95 115Q68 46 134 43Q181 7 228 51Q304 18 350 80L321 125Z" fill="#97669c"/><path d="M109 112Q213 84 320 116L331 292Q217 335 104 288Z" fill="#d7b56c"/><path d="M330 141Q439 121 422 216Q410 258 336 250L337 225Q398 231 394 181Q388 153 333 172Z" fill="#d7b56c"/><ellipse cx="175" cy="176" rx="17" ry="23" fill="#f5eed8"/><ellipse cx="258" cy="173" rx="17" ry="23" fill="#f5eed8"/><circle cx="180" cy="179" r="7" fill="#262b34"/><circle cx="253" cy="176" r="7" fill="#262b34"/><path d="M174 253Q215 280 267 246" fill="none"/><path d="M126 100Q79 65 63 97Q37 136 48 220" stroke-width="2.5" fill="none"/></g>`;
const svg = (body, width = w, height = h) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`;
const fixtures = [
  {
    id: 'router',
    width: 1280,
    height: 720,
    foreground: svg(
      `<g stroke="#383b32" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${router}</g>`,
      1280,
      720,
    ),
    background: room.replace(router, ''),
    box: [317, 326, 598, 543],
    crop: [305, 330, 290, 200],
  },
  {
    id: 'cartoon',
    width: w,
    height: h,
    foreground: svg(cartoon),
    background: svg(
      '<rect width="640" height="400" fill="#b6d6bc"/><path d="M0 330Q180 300 640 335V400H0Z" fill="#95b1a7"/><path d="M470 50v220m45-245v210" stroke="#76968a" stroke-width="4"/>',
    ),
    box: [30, 20, 445, 340],
    crop: [30, 20, 420, 320],
  },
];
for (const fixture of fixtures) {
  const folder = path.join(output, fixture.id);
  await mkdir(folder, { recursive: true });
  const foreground = await sharp(Buffer.from(fixture.foreground))
    .png()
    .toBuffer();
  const background = await sharp(Buffer.from(fixture.background))
    .png()
    .toBuffer();
  await writeFile(path.join(folder, 'truth.png'), foreground);
  await writeFile(path.join(folder, 'background.png'), background);
  // Known straight-alpha foreground composited over the exact scenery provides
  // ground truth for alpha and color fringing, independently of any model.
  await sharp(background)
    .composite([{ input: foreground }])
    .png()
    .toFile(path.join(folder, 'source.png'));
  const pixels = Buffer.alloc(fixture.width * fixture.height);
  const [x0, y0, x1, y1] = fixture.box;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) pixels[y * fixture.width + x] = 255;
  await sharp(pixels, {
    raw: { width: fixture.width, height: fixture.height, channels: 1 },
  })
    .png()
    .toFile(path.join(folder, 'prior.png'));
  await sharp(Buffer.alloc(pixels.length), {
    raw: { width: fixture.width, height: fixture.height, channels: 1 },
  })
    .png()
    .toFile(path.join(folder, 'seeds.png'));
}
await writeFile(
  path.join(output, 'fixtures.json'),
  JSON.stringify(
    fixtures.map(({ id, crop }) => ({ id, crop })),
    null,
    2,
  ),
);
execFileSync(
  path.resolve('.local-tools/segmentation/bin/python'),
  ['experiments/object-matting/compare.py', output],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      HF_HOME: path.resolve('.local-tools/huggingface'),
      HF_HUB_OFFLINE: '1',
      NUMBA_NUM_THREADS: '4',
      TUKABEL_SAM2_CHECKPOINT:
        process.env.SAM2_CHECKPOINT ||
        path.resolve('.local-tools/models/sam2.1_hiera_large.pt'),
      TUKABEL_SAM2_CONFIG:
        process.env.SAM2_CONFIG || 'configs/sam2.1/sam2.1_hiera_l.yaml',
    },
  },
);

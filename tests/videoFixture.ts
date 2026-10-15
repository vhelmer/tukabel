import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { runFFmpeg } from '../dev/animationVideo';

// A clearly controlled local video, never presented as output from a live model.
// Altering the full SVG's expression exercises MP4 decoding and complete frames.
export async function fixtureVideo() {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-video-fixture-'));
  try {
    const original = await readFile('src/assets/caretaker.svg', 'utf8');
    for (let frame = 0; frame < 24; frame++) {
      const svg =
        frame >= 8 && frame < 16
          ? original.replace('M70 66h5m30 0h5', 'M64 66h18m16 0h18')
          : original;
      await writeFile(
        path.join(root, `input-${String(frame).padStart(3, '0')}.png`),
        await sharp(Buffer.from(svg))
          .flatten({ background: '#ff00ff' })
          .extend({
            left: 55,
            right: 55,
            top: 0,
            bottom: 0,
            background: '#ff00ff',
          })
          .png()
          .toBuffer(),
      );
    }
    const target = path.join(root, 'fixture.mp4');
    await runFFmpeg([
      '-framerate',
      '12',
      '-i',
      path.join(root, 'input-%03d.png'),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '18',
      '-movflags',
      '+faststart',
      target,
    ]);
    return await readFile(target);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

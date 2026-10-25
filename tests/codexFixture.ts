import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { CodexRun } from '../dev/codexAgent';

// Deterministic fake agent outputs for integration tests; never used in the app.
export async function writeCodexFixture(request: CodexRun) {
  const input = JSON.parse(
    await readFile(path.join(request.directory, 'request.json'), 'utf8'),
  );
  const source = await sharp(path.join(request.directory, 'source.png'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = source.info;
  const kinds =
    input.task === 'blink-talk'
      ? ['blink', 'talk']
      : [
          input.task === 'ambient'
            ? 'idle'
            : input.task === 'gesture'
              ? 'expression'
              : input.task,
        ];
  const clips = [];
  for (const kind of kinds) {
    const frames = [];
    for (let f = 0; f < input.count; f++) {
      const raw = Buffer.from(source.data);
      const amount =
        kind === 'blink'
          ? [0, 1, 2, 1, 0][f % 5]!
          : kind === 'expression' && (f === 0 || f === input.count - 1)
            ? 0
            : f;
      const x0 = Math.floor(width * (kind === 'expression' ? 0.1 : 0.45));
      const y0 = Math.floor(
        height * (kind === 'expression' ? 0.6 : kind === 'talk' ? 0.4 : 0.2),
      );
      for (
        let y = y0;
        y <
        Math.min(
          height,
          y0 +
            Math.max(
              1,
              Math.floor(height * (kind === 'expression' ? 0.1 : 0.01)),
            ),
        );
        y++
      )
        for (
          let x = x0;
          x <
          Math.min(
            width,
            x0 +
              Math.max(
                1,
                Math.floor(width * (kind === 'expression' ? 0.25 : 0.03)),
              ),
          );
          x++
        ) {
          const i = (y * width + x) * 4;
          raw[i] = (raw[i]! + amount * 40) % 256;
          if (kind === 'expression' && amount) raw[i + 3] = 200;
        }
      const file = kind + '-' + f + '.png';
      await sharp(raw, { raw: { width, height, channels: 4 } })
        .png()
        .toFile(path.join(request.directory, file));
      frames.push(file);
    }
    clips.push({
      kind,
      label:
        kind === 'blink'
          ? 'Testovací oči'
          : kind === 'talk'
            ? 'Testovací ústa'
            : 'Testovací smyčka',
      fps: input.fps,
      frames,
    });
  }
  await writeFile(
    path.join(request.directory, 'generate.py'),
    '# Mock agent fixture; app never invokes this script.\n',
  );
  const result = {
    notes: 'Testovací agent dokončil snímky.',
    scripts: ['generate.py'],
    clips,
  };
  await writeFile(
    path.join(request.directory, 'result.json'),
    JSON.stringify(result),
  );
  return result;
}

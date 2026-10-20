import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Explicit installation only. Runtime inference is always offline.
execFileSync(process.execPath, ['scripts/setup-segmentation.mjs'], {
  stdio: 'inherit',
});
const python = path.resolve('.local-tools/segmentation/bin/python');
try {
  execFileSync(python, ['-c', 'import torch, torchvision'], {
    stdio: 'ignore',
  });
} catch {
  execFileSync(
    python,
    [
      '-m',
      'pip',
      'install',
      '--no-cache-dir',
      'torch==2.5.1',
      'torchvision==0.20.1',
      '--index-url',
      'https://download.pytorch.org/whl/cpu',
    ],
    { stdio: 'inherit' },
  );
}
execFileSync(
  python,
  [
    '-m',
    'pip',
    'install',
    '--no-cache-dir',
    '-r',
    'scripts/segmentation/requirements-matting.txt',
  ],
  { stdio: 'inherit' },
);
const directory = path.resolve('.local-tools/models/vitmatte-small');
const revision = '6a58ad7646403c1df626fbd746900aec7361ea1d';
const hash = 'bda9289db1bb6762d978b42d1c62ae3f34daf7497171a347a1d09657efd788cb';
await mkdir(directory, { recursive: true });
for (const name of [
  'config.json',
  'preprocessor_config.json',
  'model.safetensors',
]) {
  const target = path.join(directory, name);
  if (name === 'model.safetensors') {
    const existing = await readFile(target).catch(() => undefined);
    if (
      existing &&
      createHash('sha256').update(existing).digest('hex') === hash
    )
      continue;
  }
  const response = await fetch(
    `https://huggingface.co/hustvl/vitmatte-small-composition-1k/resolve/${revision}/${name}`,
    { signal: AbortSignal.timeout(300000) },
  );
  if (!response.ok)
    throw Error(`Cannot download ${name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    name === 'model.safetensors' &&
    createHash('sha256').update(bytes).digest('hex') !== hash
  )
    throw Error('ViTMatte checksum mismatch');
  await writeFile(`${target}.download`, bytes);
  await rename(`${target}.download`, target);
}
process.stdout.write(
  'Local ViTMatte and closed-form matting are ready. Restart Vite.\n',
);

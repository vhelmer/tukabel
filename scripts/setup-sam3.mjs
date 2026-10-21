import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { loadEnv } from 'vite';
const env = loadEnv('development', process.cwd(), '');
const root = path.resolve('.local-tools/sam3');
const python = path.join(root, 'bin/python');
// An isolated environment keeps the existing SAM 2 and ViTMatte working.
execFileSync('python3', ['-m', 'venv', root], { stdio: 'inherit' });
execFileSync(
  python,
  [
    '-m',
    'pip',
    'install',
    'torch==2.7.1',
    'torchvision==0.22.1',
    '--index-url',
    'https://download.pytorch.org/whl/cpu',
  ],
  { stdio: 'inherit' },
);
execFileSync(
  python,
  ['-m', 'pip', 'install', '-r', 'scripts/segmentation/requirements-sam3.txt'],
  { stdio: 'inherit' },
);
if (!process.argv.includes('--runtime-only')) {
  // Do not print tokens or remote error bodies. Access is approved by the user
  // on the official gated model page; this command never accepts terms for them.
  execFileSync(
    python,
    [
      '-c',
      `
from huggingface_hub import snapshot_download
try:
    snapshot_download('facebook/sam3', local_dir=${JSON.stringify(path.resolve('.local-tools/models/sam3'))}, allow_patterns=['*.json', '*.safetensors'])
except Exception:
    print('Váhy SAM 3 nejsou dostupné. Schval přístup na https://huggingface.co/facebook/sam3, nastav HF_TOKEN a spusť npm run setup:sam3 znovu.')
    raise SystemExit(1)
`,
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        HF_TOKEN: process.env.HF_TOKEN || env.HF_TOKEN,
        HF_HOME: path.resolve('.local-tools/huggingface'),
      },
    },
  );
}

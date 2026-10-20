import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve('.local-tools/segmentation');
execFileSync('python3', ['-m', 'venv', root], { stdio: 'inherit' });
execFileSync(
  path.join(root, 'bin/python'),
  ['-m', 'pip', 'install', '-r', 'scripts/segmentation/requirements.txt'],
  { stdio: 'inherit' },
);

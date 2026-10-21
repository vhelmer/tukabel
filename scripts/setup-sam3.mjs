import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const project = fileURLToPath(new URL('../', import.meta.url));
const env = loadEnv('development', project, '');
const root = path.join(project, '.local-tools/sam3');
const python = path.join(root, 'bin/python');
const helper = path.join(project, 'scripts/segmentation/setup_sam3.py');
const flags = process.argv.slice(2);
const runtimeOnly = flags.includes('--runtime-only');
const checkAccess = flags.includes('--check-access');

function setup() {
  if (
    flags.some(
      (flag) => !['--runtime-only', '--check-access'].includes(flag),
    ) ||
    (runtimeOnly && checkAccess)
  ) {
    console.error(
      'Použij buď --runtime-only, nebo --check-access, případně žádný přepínač.',
    );
    return 1;
  }
  let stage = 'příprava prostředí';
  let downloadStarted = false;
  try {
    // Leave the working SAM 2 / ViTMatte environment untouched.
    if (!existsSync(python))
      execFileSync('python3', ['-m', 'venv', root], { stdio: 'inherit' });
    let ready = false;
    try {
      execFileSync(python, [helper, '--runtime-check'], { stdio: 'ignore' });
      ready = true;
    } catch {
      // Install only if versions/imports differ, not on every credential check.
    }
    if (!ready) {
      stage = 'instalace závislostí';
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
        [
          '-m',
          'pip',
          'install',
          '-r',
          path.join(project, 'scripts/segmentation/requirements-sam3.txt'),
        ],
        { stdio: 'inherit' },
      );
      stage = 'ověření runtime';
      execFileSync(python, [helper, '--runtime-check'], { stdio: 'inherit' });
    }
    console.log('Lokální runtime SAM 3 je připravený.');
    if (runtimeOnly) {
      console.log(
        'Váhy se nestahovaly. Pro celý model spusť npm run setup:sam3.',
      );
    } else {
      const directory = path.resolve(
        project,
        process.env.SAM3_MODEL || env.SAM3_MODEL || '.local-tools/models/sam3',
      );
      stage = 'ověření přístupu a stažení modelu';
      downloadStarted = true;
      execFileSync(
        python,
        [helper, directory, ...(checkAccess ? ['--check-access'] : [])],
        {
          stdio: 'inherit',
          env: {
            ...process.env,
            HF_TOKEN: process.env.HF_TOKEN || env.HF_TOKEN,
            HF_HOME: path.join(project, '.local-tools/huggingface'),
          },
        },
      );
    }
    return 0;
  } catch (error) {
    // The helper explains HTTP/auth failures without tokens or remote bodies.
    // Never dump Node's full command, credentials or an embedded Python program.
    if (!downloadStarted || !Number.isInteger(error.status))
      console.error(
        `SAM 3: ${stage} selhala. Zkontroluj předchozí výstup a dostupnost Pythonu 3.12.`,
      );
    return 1;
  }
}
process.exitCode = setup();

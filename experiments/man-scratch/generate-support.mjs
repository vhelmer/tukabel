// Explicit paid action only. Rendering generate.py never invokes this command.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const env = loadEnv('development', root, '');
const apiKey = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY;
if (!apiKey) throw Error('Chybí OPENAI_API_KEY v .env.local.');
const model =
  process.env.OPENAI_IMAGE_MODEL ||
  env.OPENAI_IMAGE_MODEL ||
  'gpt-image-2.5-sunburst';
const python =
  process.env.ARM_STUDY_PYTHON ||
  path.join(root, '.local-tools/arm-study/bin/python');
const cli =
  process.env.IMAGE_GEN_CLI ||
  path.join(
    process.env.CODEX_HOME || path.join(homedir(), '.codex'),
    'skills/.system/imagegen/scripts/image_gen.py',
  );
const output = path.join(directory, 'output/provider-clean-plate.png');
if (existsSync(output))
  throw Error('Výstup již existuje; původní generaci nepřepisuji.');

// Use the skill's unchanged CLI, configuring the SDK's retry/timeout defaults.
// This wrapper contains no image API implementation and never sends secrets in argv.
const bootstrap = `import sys, runpy, openai
OriginalClient = openai.OpenAI
def single_request_client(**kwargs):
    kwargs.setdefault('max_retries', 0)
    kwargs.setdefault('timeout', 240)
    return OriginalClient(**kwargs)
openai.OpenAI = single_request_client
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name='__main__')
`;
const args = [
  '-c',
  bootstrap,
  cli,
  'edit',
  '--model',
  model,
  '--image',
  path.join(directory, 'output/api-input.png'),
  '--mask',
  path.join(directory, 'output/api-mask.png'),
  '--prompt-file',
  path.join(directory, 'clean-plate.txt'),
  '--size',
  '1024x1536',
  '--quality',
  'high',
  '--background',
  'transparent',
  '--output-format',
  'png',
  '--no-augment',
  '--out',
  output,
];
console.log(`OpenAI edit · ${model} · high · 1 požadavek, bez retry`);
const result = spawnSync(python, args, {
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    OPENAI_API_KEY: apiKey,
  },
  cwd: root,
  encoding: 'utf8',
  timeout: 270000,
  maxBuffer: 1024 * 1024,
});
const log = String(result.stderr || '').replaceAll(apiKey, '[redacted]');
if (result.status !== 0) {
  console.error(log.slice(-3500));
  process.exitCode = 1;
} else {
  const hash = (file) =>
    createHash('sha256')
      .update(readFileSync(path.join(directory, file)))
      .digest('hex');
  writeFileSync(
    path.join(directory, 'output/generation.json'),
    JSON.stringify(
      {
        provider: 'OpenAI Image API via imagegen skill CLI',
        model,
        quality: 'high',
        size: [1024, 1536],
        createdAt: new Date().toISOString(),
        retries: 0,
        prompt: 'clean-plate.txt',
        promptSha256: hash('clean-plate.txt'),
        inputSha256: hash('output/api-input.png'),
        maskSha256: hash('output/api-mask.png'),
        outputSha256: hash('output/provider-clean-plate.png'),
      },
      null,
      2,
    ) + '\n',
  );
  const formatter = path.join(root, 'node_modules/.bin/prettier');
  if (existsSync(formatter)) {
    const formatted = spawnSync(
      formatter,
      ['--write', path.join(directory, 'output/generation.json')],
      { stdio: 'ignore' },
    );
    if (formatted.status !== 0)
      throw Error('Formátování záznamu generace selhalo.');
  }
  console.log(
    'Uloženo: experiments/man-scratch/output/provider-clean-plate.png',
  );
}

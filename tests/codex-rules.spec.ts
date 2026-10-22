import { test, expect } from '@playwright/test';
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { codexInput, createCodexAnimation, runCodex } from '../dev/codexAgent';
import type { CodexRun } from '../dev/codexAgent';
import type { CodexContext } from '../src/editor/codex';
import { createEditorJobs } from '../dev/editorJobs';
import { writeCodexFixture } from './codexFixture';

const context: CodexContext = {
  mode: 'character',
  sceneId: 'scene',
  targetId: 'actor',
  label: 'Postava',
  source: 'actor.png',
  fingerprint: 'snapshot',
  placement: { bounds: { x: 0, y: 0, width: 32, height: 24 } },
};
const input = {
  context,
  prompt: 'Oči a ústa',
  task: 'blink-talk',
  count: 5,
  fps: 12,
  confirmed: true,
};
async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-codex-test-'));
  await sharp({
    create: { width: 32, height: 24, channels: 4, background: '#789abc' },
  })
    .png()
    .toFile(path.join(root, 'actor.png'));
  return root;
}
test('Codex results publish atomically, retain exact pixels, detect disjoint regions and archive recipes without editing the project', async () => {
  const root = await workspace();
  try {
    const stages: string[] = [];
    const result = await createCodexAnimation(
      root,
      input,
      {
        run: async (r) => {
          expect(r.prompt).toContain('source.png');
          await writeCodexFixture(r);
        },
      },
      (s) => stages.push(s),
    );
    expect(result.clips.map((c) => c.kind)).toEqual(['blink', 'talk']);
    expect(result.clips[0]!.region!.y).toBeLessThan(result.clips[1]!.region!.y);
    const raw = (name: string) =>
      sharp(path.join(root, name)).ensureAlpha().raw().toBuffer();
    expect(await raw(result.clips[0]!.frames[0]!)).toEqual(
      await raw('actor.png'),
    );
    expect(await raw(result.clips[0]!.frames[4]!)).toEqual(
      await raw('actor.png'),
    );
    const recipe = JSON.parse(
      await readFile(path.join(root, result.manifest), 'utf8'),
    );
    expect(recipe).toMatchObject({
      model: 'gpt-6.1-sol',
      effort: 'high',
      sourceSha256: result.sourceSha256,
    });
    expect(recipe.scripts).toEqual(['generate.py']);
    expect(stages.at(-1)).toContain('Ověřuji snímky');
    expect(
      (await readdir(path.join(root, 'codex'))).some((f) => f.startsWith('.')),
    ).toBe(false);
    expect(await readdir(root)).toEqual(['actor.png', 'codex']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid dimensions, alpha, blink endpoints, selection escape, overlap, paths and changed sources never publish partial results', async () => {
  for (const mode of [
    'size',
    'alpha',
    'endpoint',
    'selection',
    'overlap',
    'identical',
    'path',
    'symlink',
    'stale',
  ]) {
    const root = await workspace();
    try {
      const request =
        mode === 'selection'
          ? {
              ...input,
              context: {
                ...context,
                selection: [
                  { x: 0, y: 0 },
                  { x: 2, y: 0 },
                  { x: 2, y: 2 },
                ],
              },
            }
          : input;
      const run = async (r: CodexRun) => {
        const manifest = await writeCodexFixture(r);
        const blink = manifest.clips[0]!;
        if (mode === 'size')
          await sharp({
            create: { width: 2, height: 2, channels: 4, background: '#000' },
          })
            .png()
            .toFile(path.join(r.directory, blink.frames[1]!));
        if (mode === 'alpha') {
          const file = path.join(r.directory, blink.frames[1]!);
          const data = await sharp(file).raw().toBuffer();
          data[3] = 0;
          await sharp(data, { raw: { width: 32, height: 24, channels: 4 } })
            .png()
            .toFile(file);
        }
        if (mode === 'endpoint') blink.frames[0] = blink.frames[1]!;
        if (mode === 'overlap') {
          manifest.clips[1]!.frames = manifest.clips[1]!.frames.map(
            (_, i) => 'talk-' + i + '.png',
          );
          for (let f = 0; f < 5; f++) {
            const data = await sharp(path.join(r.directory, 'source.png'))
              .raw()
              .toBuffer();
            data[(4 * 32 + 14) * 4] = f * 30;
            await sharp(data, { raw: { width: 32, height: 24, channels: 4 } })
              .png()
              .toFile(path.join(r.directory, 'talk-' + f + '.png'));
          }
        }
        if (mode === 'identical') blink.frames.fill('source.png');
        if (mode === 'path') blink.frames[1] = '../outside.png';
        if (mode === 'symlink') {
          await symlink(
            path.join(root, 'actor.png'),
            path.join(r.directory, 'link.png'),
          );
          blink.frames[1] = 'link.png';
        }
        if (mode === 'stale')
          await writeFile(
            path.join(root, 'actor.png'),
            await sharp({
              create: {
                width: 32,
                height: 24,
                channels: 4,
                background: '#fff',
              },
            })
              .png()
              .toBuffer(),
          );
        await writeFile(
          path.join(r.directory, 'result.json'),
          JSON.stringify(manifest),
        );
      };
      await expect(
        createCodexAnimation(root, request, { run }),
      ).rejects.toThrow();
      expect(await readdir(path.join(root, 'codex'))).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('ambient output masks only the captured polygon and uses a separate aligned base asset', async () => {
  const root = await workspace();
  try {
    const result = await createCodexAnimation(
      root,
      {
        ...input,
        task: 'ambient',
        context: {
          ...context,
          mode: 'scene',
          targetId: '',
          selection: [
            { x: 10, y: 2 },
            { x: 20, y: 2 },
            { x: 20, y: 9 },
            { x: 10, y: 9 },
          ],
        },
      },
      {
        run: async (r) => {
          await writeCodexFixture(r);
        },
      },
    );
    expect(result.clips[0]!.source).toBe(result.image);
    expect(result.clips[0]!.region).toBeUndefined();
    const pixels = await sharp(path.join(root, result.image!)).raw().toBuffer();
    expect(pixels[3]).toBe(0);
    expect(pixels[(4 * 32 + 14) * 4 + 3]).toBe(255);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI runs with fixed arguments, bounded JSONL messages, no shell or inherited API keys and reports timeout/failure without leaking diagnostics', async () => {
  const root = await workspace();
  try {
    const bin = path.join(root, 'mock-codex');
    const script =
      '#!/usr/bin/env node\n' +
      [
        "const fs = require('node:fs');",
        "fs.writeFileSync('argv.json', JSON.stringify({ args: process.argv.slice(2), key: !!process.env.OPENAI_API_KEY }));",
        "console.error('sk-private-do-not-expose');",
        "console.log(JSON.stringify({ type: 'thread.started' }));",
        "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Hotovo sk-private-do-not-expose' } }));",
        'process.stdin.resume();',
      ].join('\n');
    await writeFile(bin, script);
    await chmod(bin, 0o700);
    const stages: string[] = [];
    const request = {
      directory: root,
      prompt: 'Text $(do-not-execute)',
      signal: new AbortController().signal,
      onStage: (s: string) => stages.push(s),
    };
    await runCodex(request, { bin });
    const argv = JSON.parse(
      await readFile(path.join(root, 'argv.json'), 'utf8'),
    );
    expect(argv.args).toContain('gpt-6.1-sol');
    expect(argv.args).toContain('model_reasoning_effort="high"');
    expect(argv.args).toContain('workspace-write');
    expect(argv.args).not.toContain(request.prompt);
    expect(argv.key).toBe(false);
    expect(stages.join(' ')).toContain('Hotovo [skryto]');
    expect(stages.join(' ')).not.toContain('sk-private');
    await writeFile(bin, script + '\nsetInterval(() => {}, 1000);\n');
    await expect(runCodex(request, { bin, timeoutMs: 60 })).rejects.toThrow(
      'časový limit',
    );
    await writeFile(bin, script + '\nprocess.exitCode = 1;\n');
    await expect(runCodex(request, { bin })).rejects.toThrow('nedokončil');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('only deliberate valid jobs start; active Codex cancellation aborts the runner and preserves the serial queue', async () => {
  expect(() => codexInput({ ...input, confirmed: false })).toThrow('výslovně');
  expect(() => codexInput({ ...input, task: 'arbitrary-shell' })).toThrow();
  const jobs = createEditorJobs();
  let aborted = false;
  const first = jobs.submit(
    { kind: 'codex', context },
    'Stop',
    async (_stage, signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            resolve();
          },
          { once: true },
        ),
      );
      throw Error('aborted');
    },
  );
  await expect.poll(() => first.status).toBe('running');
  jobs.cancel(first.id);
  const second = jobs.submit({ kind: 'codex', context }, 'Next', async () => {
    throw Error('next ran');
  });
  await expect.poll(() => second.status).toBe('failed');
  expect(aborted).toBe(true);
  expect(first.status).toBe('cancelled');
  expect(first.error).toBeUndefined();
  expect(second.error).toBe('next ran');
  jobs.close();
});

import { test, expect } from '@playwright/test';
import { createEditorJobs } from '../dev/editorJobs';
import {
  directionInput,
  proposeAnimation,
  validateDirection,
} from '../dev/animationDirection';
import { directedBinding, artFingerprint } from '../src/editor/jobs';
import type { AnimationContext, AnimationDirection } from '../src/editor/jobs';

const context: AnimationContext = {
  sceneId: 'scene',
  targetId: 'actor',
  source: 'woman.png',
  binding: {
    blink: 'eyes',
    talk: 'mouth',
    mouthShapes: { A: 0, B: 1 },
    onClick: 'eyes',
    motion: 'sway',
  },
  clips: [
    {
      id: 'eyes',
      source: 'woman.png',
      label: 'Oči',
      kind: 'blink',
      frames: ['woman.png', 'closed.png'],
      fps: 12,
      region: { x: 10, y: 10, width: 20, height: 10 },
    },
    {
      id: 'mouth',
      source: 'woman.png',
      label: 'Ústa',
      kind: 'talk',
      frames: ['woman.png', 'mouth.png'],
      fps: 12,
      region: { x: 10, y: 35, width: 20, height: 10 },
    },
  ],
};
const plan: AnimationDirection = {
  blink: 'eyes',
  talk: 'mouth',
  idle: null,
  minMs: 1000,
  maxMs: 2200,
  motion: 'breath',
  notes: 'Použité hotové oči a ústa; pohyb celé postavy.',
};
const submit = { kind: 'animation' as const, context };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test('jobs return queued immediately, serialize expensive calls, cancel queued work and continue after failure without retries', async () => {
  const jobs = createEditorJobs(),
    gate = deferred();
  let calls = 0;
  const first = jobs.submit(submit, 'First', async (stage) => {
    calls++;
    stage('Provider pending');
    await gate.promise;
    return plan;
  });
  expect(first.status).toBe('queued');
  await expect.poll(() => first.status).toBe('running');
  expect(first.stage).toBe('Provider pending');
  const cancelled = jobs.submit(submit, 'Cancelled', async () => {
    calls++;
    return plan;
  });
  jobs.cancel(cancelled.id);
  const failed = jobs.submit(submit, 'Failure', async () => {
    calls++;
    throw Error('Mock failure');
  });
  const last = jobs.submit(submit, 'Last', async () => {
    calls++;
    return plan;
  });
  jobs.dismiss(cancelled.id);
  expect(() => jobs.cancel(first.id)).toThrow('pouze čekající');
  gate.resolve();
  await expect.poll(() => last.status).toBe('succeeded');
  expect(first.status).toBe('succeeded');
  expect(failed.status).toBe('failed');
  expect(failed.error).toBe('Mock failure');
  expect(calls).toBe(3);
  jobs.dismiss(first.id);
  expect(jobs.list().map((j) => j.label)).toEqual(['Failure', 'Last']);
  jobs.close();
});

test('removing completed jobs while another is running never strands queued work; queue is bounded', async () => {
  const jobs = createEditorJobs(),
    gate = deferred();
  const first = jobs.submit(submit, 'First', async () => plan);
  const second = jobs.submit(submit, 'Second', async () => {
    await gate.promise;
    return plan;
  });
  const third = jobs.submit(submit, 'Third', async () => plan);
  await expect.poll(() => second.status).toBe('running');
  jobs.dismiss(first.id);
  gate.resolve();
  await expect.poll(() => third.status).toBe('succeeded');
  for (let i = jobs.list().length; i < 20; i++)
    jobs.submit(submit, 'Queued', async () => plan);
  expect(() => jobs.submit(submit, 'Too many', async () => plan)).toThrow('20');
  jobs.close();
});

test('structured AI direction only configures available non-overlapping clips and preserves speech mapping', async () => {
  let calls = 0;
  const result = await proposeAnimation(
    { prompt: 'Nervózně mrkání a mluvení', context, confirmed: true },
    {
      apiKey: 'secret',
      fetch: (async (url, init) => {
        calls++;
        expect(url).toBe('https://api.openai.com/v1/responses');
        const body = JSON.parse(init!.body as string);
        expect(body.store).toBe(false);
        expect(body.text.format.strict).toBe(true);
        expect(body.text.format.schema.properties.talk.enum).toEqual([
          null,
          'mouth',
        ]);
        expect(body.input).not.toContain('mouth.png');
        return Response.json({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify(plan) }],
            },
          ],
        });
      }) as typeof fetch,
    },
  );
  expect(calls).toBe(1);
  expect(directedBinding(context, result)).toMatchObject({
    blink: 'eyes',
    talk: 'mouth',
    mouthShapes: { A: 0, B: 1 },
    onClick: 'eyes',
    motion: 'breath',
    blinkIntervalMs: [1000, 2200],
  });
  expect(
    directedBinding(context, { ...plan, talk: null }).mouthShapes,
  ).toBeUndefined();
  expect(() =>
    validateDirection({ ...plan, talk: 'invented' }, context),
  ).toThrow();
  expect(() =>
    validateDirection({ ...plan, motion: 'execute code' }, context),
  ).toThrow();
  expect(() => validateDirection({ ...plan, minMs: 0 }, context)).toThrow();
  expect(() => validateDirection({ ...plan, extra: 'no' }, context)).toThrow();
  const overlap = {
    ...context,
    clips: context.clips.map((c) => ({
      ...c,
      region: { x: 0, y: 0, width: 100, height: 100 },
    })),
  };
  expect(() => validateDirection(plan, overlap)).toThrow('překrývají');
  expect(() =>
    validateDirection(plan, {
      ...context,
      clips: context.clips.map((c) => ({ ...c, region: undefined })),
    }),
  ).toThrow('lokální klipy');
  expect(() =>
    directionInput({ context, prompt: 'Do it', confirmed: false }),
  ).toThrow();
});

test('provider failure, refusal and incomplete proposals never retry or expose provider details', async () => {
  const input = { context, prompt: 'Speak', confirmed: true };
  let calls = 0;
  await expect(
    proposeAnimation(input, {
      apiKey: 'secret',
      fetch: (async () => {
        calls++;
        return new Response('secret-provider-debug', { status: 429 });
      }) as typeof fetch,
    }),
  ).rejects.toThrow('HTTP 429');
  expect(calls).toBe(1);
  for (const data of [
    { status: 'incomplete', output: [] },
    {
      status: 'completed',
      output: [{ content: [{ type: 'refusal', refusal: 'no' }] }],
    },
    {
      status: 'completed',
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({ ...plan, talk: 'missing' }),
            },
          ],
        },
      ],
    },
  ])
    await expect(
      proposeAnimation(input, {
        apiKey: 'secret',
        fetch: (async () => Response.json(data)) as typeof fetch,
      }),
    ).rejects.toThrow('Nic se nepoužilo');
  await expect(proposeAnimation(input, {})).rejects.toThrow('OPENAI_API_KEY');
});

test('artwork target snapshots tolerate unrelated editing and reject changed geometry or source', () => {
  const scene = {
    id: 'scene',
    title: 'Title',
    width: 1280,
    height: 720,
    background: 'background.png',
    hotspots: [
      {
        id: 'actor',
        label: 'Actor',
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        image: 'woman.png',
        onClick: [],
      },
    ],
  };
  expect(artFingerprint(scene, '')).toBe(
    artFingerprint({ ...scene, title: 'New title' }, ''),
  );
  expect(artFingerprint(scene, 'actor')).toBe(
    artFingerprint({ ...scene, background: 'new.png' }, 'actor'),
  );
  expect(artFingerprint(scene, '')).not.toBe(
    artFingerprint({ ...scene, width: 1300 }, ''),
  );
  expect(artFingerprint(scene, 'actor')).not.toBe(
    artFingerprint({ ...scene, hotspots: [] }, 'actor'),
  );
});

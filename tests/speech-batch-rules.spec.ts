import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  runSpeechBatch,
  abandonSpeechBatch,
  type SpeechBatchClient,
} from '../dev/speechBatch';
import {
  createSpeech,
  designVoice,
  saveDesignedVoice,
  publishSpeechArchive,
  readSpeechAsset,
  validateSpeechAssets,
} from '../dev/speech';
import { retireDesignedVoice } from '../dev/voiceRotation';
import { defaultVoice } from '../src/game/speech';
import type { GameContent, VoiceSettings } from '../src/game/types';

const execute = promisify(execFile);
const hash = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const roots: string[] = [];
test.afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const pcm = () => {
  const data = Buffer.alloc(44100);
  for (let i = 0; i < data.length / 2; i++)
    data.writeInt16LE(Math.round(Math.sin(i * 0.1) * 4000), i * 2);
  return data;
};

async function fixture(rotating = false, modelId = 'eleven_v4') {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-batch-run-'));
  roots.push(root);
  const assets = path.join(root, 'src/assets');
  await mkdir(assets, { recursive: true });
  const calls: string[] = [];
  let serial = 0;
  const fetchMock: typeof fetch = async (url, init) => {
    const endpoint = String(url);
    const input = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (endpoint.endsWith('/models'))
      return Response.json([
        {
          model_id: modelId,
          can_do_text_to_speech: true,
          languages: [{ language_id: 'sk' }],
        },
      ]);
    if (endpoint.includes('/text-to-voice/design')) {
      calls.push('design');
      const generation = serial++;
      const frame = Buffer.alloc(417);
      frame.set([0xff, 0xfb, 0x90, 0x64]);
      return Response.json({
        previews: [0, 1, 2].map((i) => ({
          generated_voice_id: `generated-${generation}-${i}`,
          audio_base_64: Buffer.concat([frame, frame]).toString('base64'),
          media_type: 'audio/mpeg',
          duration_secs: 1,
        })),
      });
    }
    if (endpoint.endsWith('/text-to-voice')) {
      calls.push('register');
      return Response.json({ voice_id: input.generated_voice_id });
    }
    if (init?.method === 'DELETE') {
      calls.push('delete');
      return Response.json({ status: 'ok' });
    }
    if (endpoint.includes('/text-to-speech/')) {
      calls.push('tts');
      return Response.json({
        audio_base64: pcm().toString('base64'),
        alignment: null,
      });
    }
    throw new Error('Unexpected mock endpoint');
  };
  const tools = { apiKey: 'private-batch-test-key', fetch: fetchMock };
  let voice: VoiceSettings = {
    ...defaultVoice,
    voiceId: 'static-voice',
    modelId,
    slot: 'static',
  };
  const profile = 'Native Slovak, rough comic character, clear natural words.';
  if (rotating) {
    const design = await designVoice(
      assets,
      {
        description: profile,
        text: 'Počúvaj ma pozorne! Ten kábel sa nemohol len tak vypariť. Niekto tu niečo tají a ja sa pravdu dozviem.',
        confirmed: true,
      },
      tools,
    );
    const registration = await saveDesignedVoice(
      assets,
      {
        manifest: design.manifest,
        previewIndex: 0,
        name: 'Test',
        confirmed: true,
      },
      tools,
    );
    voice = {
      ...voice,
      voiceId: registration.voiceId,
      designRegistration: registration.manifest,
      slot: 'rotating',
    };
  }
  let content: GameContent = {
    id: 'batch-game',
    startScene: 'scene',
    initialMessage: '',
    flags: [],
    items: [],
    combinations: [],
    scenes: [
      {
        id: 'scene',
        title: 'Scéna',
        width: 100,
        height: 100,
        background: 'background.svg',
        hotspots: [
          {
            id: 'actor',
            label: 'Postava',
            image: 'background.svg',
            bounds: { x: 10, y: 10, width: 20, height: 40 },
            onClick: [],
            animation: { voice },
          },
        ],
      },
    ],
    dialogues: [
      {
        id: 'speech',
        start: 'one',
        entry: 'speech',
        nodes: [
          {
            id: 'one',
            speaker: 'Postava',
            text: 'Ahoj.',
            actor: { sceneId: 'scene', hotspotId: 'actor' },
            choices: [],
          },
          {
            id: 'two',
            speaker: 'Postava',
            text: 'Ďalšia veta.',
            actor: { sceneId: 'scene', hotspotId: 'actor' },
            choices: [],
          },
        ],
      },
    ],
  };
  const analyze = async (audio: string) => {
    calls.push('lipsync');
    const bytes = await readSpeechAsset(assets, audio, 'wav');
    const folder = await publishSpeechArchive(assets, {
      'track.lipsync.json': JSON.stringify({
        metadata: { duration: 1, audioSha256: hash(bytes) },
        mouthCues: [
          { start: 0, end: 0.4, value: 'X' },
          { start: 0.4, end: 1, value: 'B' },
        ],
      }),
    });
    return { lipSync: `${folder}/track.lipsync.json` };
  };
  for (const node of content.dialogues[0]!.nodes) {
    const generated = await createSpeech(
      assets,
      {
        text: node.text,
        voice,
        ...(modelId === 'eleven_multilingual_v2' ? {} : { languageCode: 'sk' }),
        confirmed: true,
      },
      tools,
    );
    const speech = {
      ...generated,
      lipSync: (await analyze(generated.audio)).lipSync,
    };
    content = {
      ...content,
      dialogues: content.dialogues.map((d) => ({
        ...d,
        nodes: d.nodes.map((n) => (n.id === node.id ? { ...n, speech } : n)),
      })),
    };
  }
  if (rotating) {
    const retirement = await retireDesignedVoice(
      assets,
      content,
      { sceneId: 'scene', hotspotId: 'actor', confirmed: true },
      tools,
    );
    content = {
      ...content,
      scenes: content.scenes.map((s) => ({
        ...s,
        hotspots: s.hotspots.map((h) => ({
          ...h,
          animation: { ...h.animation, voice: retirement.voice },
        })),
      })),
    };
  }
  content = {
    ...content,
    dialogues: content.dialogues.map((d) => ({
      ...d,
      nodes: d.nodes.map((n) =>
        n.id === 'two' ? { ...n, text: 'Zmenená veta.' } : n,
      ),
    })),
  };
  let revision = 0;
  calls.length = 0;
  const client: SpeechBatchClient = {
    readProject: async () => ({
      content: structuredClone(content),
      revision: String(revision),
    }),
    writeProject: async (next, rev) => {
      expect(rev).toBe(String(revision));
      await validateSpeechAssets(assets, next);
      content = structuredClone(next);
      revision++;
      calls.push('save');
    },
    generate: (input) => createSpeech(assets, input, tools),
    analyze,
    design: (input) => designVoice(assets, input, tools),
    register: (input) => saveDesignedVoice(assets, input, tools),
    retire: async (input) => {
      expect(input.expectedVoice.slot).toBe('rotating');
      expect(
        content.dialogues[0]!.nodes.every(
          (n) => n.speech?.text === n.text && n.speech.lipSync,
        ),
      ).toBe(true);
      return retireDesignedVoice(assets, content, input, tools);
    },
    status: async () => ({ elevenLabs: true, rhubarb: true }),
    catalog: async () => ({ models: [{ id: modelId, languages: ['sk'] }] }),
  };
  const pending = async () =>
    (await readdir(path.join(root, '.local-tools/speech-batches'))).find(
      (id) => id !== '.lock',
    )!;
  return {
    root,
    assets,
    calls,
    client,
    get content() {
      return content;
    },
    update(fn: (p: GameContent) => GameContent) {
      content = fn(content);
    },
    pending,
  };
}

test('batch regenerates only stale TTS, recalculates every lip-sync, and saves verified data', async () => {
  const f = await fixture();
  const old = f.content.dialogues[0]!.nodes[0]!.speech!;
  const result = await runSpeechBatch(f.root, f.client, { confirmed: true });
  expect(result.complete).toBe(true);
  expect(f.calls.filter((x) => x === 'tts')).toHaveLength(1);
  expect(f.calls.filter((x) => x === 'lipsync')).toHaveLength(2);
  expect(f.calls).not.toContain('delete');
  expect(f.content.dialogues[0]!.nodes[0]!.speech!.audio).toBe(old.audio);
  expect(f.content.dialogues[0]!.nodes[0]!.speech!.lipSync).not.toBe(
    old.lipSync,
  );
  expect(
    f.content.dialogues[0]!.nodes.every((n) => n.speech?.text === n.text),
  ).toBe(true);
  expect(
    await readFile(
      path.join(f.root, '.local-tools/speech-batches', result.id, 'state.json'),
      'utf8',
    ),
  ).not.toContain('private-batch-test-key');
});

test('resume after a local analysis failure never regenerates already paid audio', async () => {
  const f = await fixture();
  const original = f.client.analyze;
  let analyses = 0;
  f.client.analyze = async (audio) => {
    if (++analyses === 2) throw new Error('Local analysis failed');
    return original(audio);
  };
  await expect(
    runSpeechBatch(f.root, f.client, { confirmed: true }),
  ).rejects.toThrow('Local analysis failed');
  const id = await f.pending();
  expect(f.calls.filter((x) => x === 'tts')).toHaveLength(1);
  await expect(
    runSpeechBatch(f.root, f.client, { confirmed: true, resume: id }),
  ).rejects.toThrow('--retry-failed');
  await runSpeechBatch(f.root, f.client, {
    confirmed: true,
    resume: id,
    retryFailed: true,
  });
  expect(f.calls.filter((x) => x === 'tts')).toHaveLength(1);
  expect(
    f.content.dialogues[0]!.nodes.every((n) => n.speech?.text === n.text),
  ).toBe(true);
});

test('restored rotating voice generates all actor lines and is retired only after verified project save', async () => {
  const f = await fixture(true);
  const beforeVoice =
    f.content.scenes[0]!.hotspots[0]!.animation!.voice!.voiceId;
  await runSpeechBatch(f.root, f.client, { confirmed: true });
  expect(f.calls.filter((x) => x === 'tts')).toHaveLength(2);
  expect(f.calls.filter((x) => x === 'lipsync')).toHaveLength(2);
  expect(f.calls.filter((x) => x === 'design')).toHaveLength(1);
  expect(f.calls.filter((x) => x === 'register')).toHaveLength(1);
  expect(f.calls.filter((x) => x === 'delete')).toHaveLength(1);
  expect(f.calls.indexOf('save')).toBeLessThan(f.calls.indexOf('delete'));
  const voice = f.content.scenes[0]!.hotspots[0]!.animation!.voice!;
  expect(voice.retired).toBe(true);
  expect(voice.voiceId).not.toBe(beforeVoice);
  expect(voice.retirementManifest).toBeTruthy();
});

for (const scenario of [
  { name: 'static audio', rotating: false, lostSave: 1 },
  { name: 'restored rotating audio', rotating: true, lostSave: 1 },
  { name: 'retirement metadata', rotating: true, lostSave: 2 },
])
  test(`resume reconciles a committed ${scenario.name} save with a lost response`, async () => {
    const f = await fixture(scenario.rotating);
    const source = path.join(f.root, 'src/game/content/project.json');
    await mkdir(path.dirname(source), { recursive: true });
    const write = f.client.writeProject;
    let saves = 0;
    f.client.writeProject = async (content, revision) => {
      await write(content, revision);
      await writeFile(source, JSON.stringify(f.content));
      if (++saves === scenario.lostSave) throw new Error('PUT response lost');
    };
    await expect(
      runSpeechBatch(f.root, f.client, { confirmed: true }),
    ).rejects.toThrow('PUT response lost');
    const saved = JSON.parse(await readFile(source, 'utf8')) as GameContent;
    expect(
      saved.dialogues[0]!.nodes.every((n) => n.speech?.text === n.text),
    ).toBe(true);
    const id = await f.pending();
    const paidCalls = f.calls.filter((x) => x !== 'save');
    f.update((p) => ({
      ...p,
      initialMessage: 'Souběžná nesouvisející úprava.',
    }));
    await runSpeechBatch(f.root, f.client, { confirmed: true, resume: id });
    expect(f.calls.filter((x) => x !== 'save')).toEqual(
      scenario.rotating && scenario.lostSave === 1
        ? [...paidCalls, 'delete']
        : paidCalls,
    );
    expect(f.content.initialMessage).toBe('Souběžná nesouvisející úprava.');
    if (scenario.rotating)
      expect(f.content.scenes[0]!.hotspots[0]!.animation!.voice!.retired).toBe(
        true,
      );
  });

test('resume refuses a conflicting edit after a committed save lost its response', async () => {
  const f = await fixture();
  const write = f.client.writeProject;
  f.client.writeProject = async (content, revision) => {
    await write(content, revision);
    throw new Error('PUT response lost');
  };
  await expect(
    runSpeechBatch(f.root, f.client, { confirmed: true }),
  ).rejects.toThrow('PUT response lost');
  const id = await f.pending();
  const calls = [...f.calls];
  f.update((p) => ({
    ...p,
    dialogues: p.dialogues.map((d) => ({
      ...d,
      nodes: d.nodes.map((n) =>
        n.id === 'two' ? { ...n, text: 'Nová ruční replika.' } : n,
      ),
    })),
  }));
  await expect(
    runSpeechBatch(f.root, f.client, { confirmed: true, resume: id }),
  ).rejects.toThrow('mezitím upravena');
  expect(f.calls).toEqual(calls);
  expect(f.content.dialogues[0]!.nodes[1]!.text).toBe('Nová ruční replika.');
});

test('resume safely retries a project save that failed before committing without repeating paid steps', async () => {
  const f = await fixture();
  const write = f.client.writeProject;
  f.client.writeProject = async () => {
    throw new Error('PUT failed before save');
  };
  await expect(
    runSpeechBatch(f.root, f.client, { confirmed: true }),
  ).rejects.toThrow('PUT failed before save');
  const id = await f.pending();
  const calls = [...f.calls];
  f.client.writeProject = write;
  await runSpeechBatch(f.root, f.client, { confirmed: true, resume: id });
  expect(f.calls).toEqual([...calls, 'save']);
  expect(f.content.dialogues[0]!.nodes[1]!.speech!.text).toBe('Zmenená veta.');
});

test('concurrent text edit is preserved and failed batch can be abandoned without remote operations', async () => {
  const f = await fixture();
  const generate = f.client.generate;
  f.client.generate = async (input) => {
    const result = await generate(input);
    f.update((p) => ({
      ...p,
      dialogues: p.dialogues.map((d) => ({
        ...d,
        nodes: d.nodes.map((n) =>
          n.id === 'two' ? { ...n, text: 'Ruční editace během TTS.' } : n,
        ),
      })),
    }));
    return result;
  };
  await expect(
    runSpeechBatch(f.root, f.client, { confirmed: true }),
  ).rejects.toThrow('mezitím upravena');
  expect(f.content.dialogues[0]!.nodes[1]!.text).toBe(
    'Ruční editace během TTS.',
  );
  expect(f.calls).not.toContain('save');
  const id = await f.pending();
  const count = f.calls.length;
  await abandonSpeechBatch(f.root, id);
  expect(f.calls).toHaveLength(count);
  await expect(
    runSpeechBatch(f.root, f.client, { confirmed: true, resume: id }),
  ).rejects.toThrow('opuštěna');
});

test('preflight and explicit confirmation prevent any TTS or deletion when Rhubarb is unavailable', async () => {
  const f = await fixture();
  await expect(
    runSpeechBatch(f.root, f.client, { confirmed: false }),
  ).rejects.toThrow('--confirm');
  f.client.status = async () => ({ elevenLabs: true, rhubarb: false });
  await expect(
    runSpeechBatch(f.root, f.client, { confirmed: true }),
  ).rejects.toThrow('Rhubarb');
  expect(f.calls).toEqual([]);
});

test('Multilingual v2 regenerates audio without unsupported forced language', async () => {
  const f = await fixture(false, 'eleven_multilingual_v2');
  await runSpeechBatch(f.root, f.client, { confirmed: true });
  expect(f.calls.filter((x) => x === 'tts')).toHaveLength(1);
  expect(f.content.dialogues[0]!.nodes[1]!.speech!.text).toBe('Zmenená veta.');
});

for (const scenario of [
  { name: 'unavailable model', models: [], error: 'není dostupný' },
  {
    name: 'missing Slovak support',
    models: [{ id: 'eleven_v4', languages: ['en'] }],
    error: 'slovenštinu',
  },
  {
    name: 'provider text limit',
    models: [{ id: 'eleven_v4', languages: ['sk'], maxCharacters: 2 }],
    error: 'znaků',
  },
])
  test(`catalog preflight blocks ${scenario.name} before restoring a paid voice`, async () => {
    const f = await fixture(true);
    f.client.catalog = async () => ({ models: scenario.models });
    await expect(
      runSpeechBatch(f.root, f.client, { confirmed: true }),
    ).rejects.toThrow(scenario.error);
    expect(f.calls).toEqual([]);
  });

test('batch preflight enforces the local 5000-character TTS limit before paid design', async () => {
  const f = await fixture(true);
  f.update((p) => ({
    ...p,
    dialogues: p.dialogues.map((d) => ({
      ...d,
      nodes: d.nodes.map((n) =>
        n.id === 'two' ? { ...n, text: 'A'.repeat(5001) } : n,
      ),
    })),
  }));
  f.client.catalog = async () => ({
    models: [{ id: 'eleven_v4', languages: ['sk'], maxCharacters: 10000 }],
  });
  await expect(
    runSpeechBatch(f.root, f.client, { confirmed: true }),
  ).rejects.toThrow('5000 znaků');
  expect(f.calls).toEqual([]);
});

test('CLI dry-run is read-only and confirmed CLI uses the existing local editor API with mocked provider', async () => {
  test.setTimeout(60000);
  const f = await fixture();
  const target = await mkdtemp(path.join(tmpdir(), 'tukabel-cli-'));
  roots.push(target);
  await cp('src', path.join(target, 'src'), {
    recursive: true,
    filter: (source) => path.resolve(source) !== path.resolve('src/assets'),
  });
  await cp('dev', path.join(target, 'dev'), { recursive: true });
  await mkdir(path.join(target, 'scripts'));
  await cp(
    'scripts/regenerate-speech.mjs',
    path.join(target, 'scripts/regenerate-speech.mjs'),
  );
  for (const file of ['vite.config.ts', 'package.json', 'tsconfig.json'])
    await cp(file, path.join(target, file));
  await cp(f.assets, path.join(target, 'src/assets'), { recursive: true });
  await writeFile(
    path.join(target, 'src/assets/background.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="black"/></svg>',
  );
  const source = path.join(target, 'src/game/content/project.json');
  await writeFile(source, JSON.stringify(f.content));
  await symlink(
    path.resolve('node_modules'),
    path.join(target, 'node_modules'),
    'dir',
  );
  const bin = path.join(target, 'rhubarb');
  await writeFile(
    bin,
    `#!${process.execPath}\nif(process.argv.includes('--version'))process.stdout.write('Mock Rhubarb');else process.stdout.write(JSON.stringify({metadata:{duration:1},mouthCues:[{start:0,end:.4,value:'X'},{start:.4,end:1,value:'B'}]}));\n`,
    { mode: 0o755 },
  );
  const hook = path.join(target, 'mock-fetch.mjs');
  await writeFile(
    hook,
    `import{appendFile}from'node:fs/promises';const original=globalThis.fetch;globalThis.fetch=async(url,init)=>{const parsed=new URL(String(url));if(parsed.hostname==='api.elevenlabs.io'){await appendFile(${JSON.stringify(path.join(target, 'provider.jsonl'))},JSON.stringify({path:parsed.pathname})+String.fromCharCode(10));if(parsed.pathname.endsWith('/models'))return Response.json([{model_id:'eleven_v4',can_do_text_to_speech:true,languages:[{language_id:'sk'}]}]);if(parsed.pathname==='/v2/voices')return Response.json({voices:[]});if(parsed.pathname.includes('/text-to-speech/'))return Response.json({audio_base64:Buffer.alloc(44100,1).toString('base64'),alignment:null});throw Error('Unexpected provider operation');}if(parsed.hostname!=='127.0.0.1')throw Error('External network blocked by test');return original(url,init);};\n`,
  );
  const env = {
    ...process.env,
    NODE_OPTIONS: '',
    ELEVENLABS_API_KEY: 'fake-cli-key-never-exposed',
    RHUBARB_BIN: bin,
  };
  const args = [
    '--import',
    hook,
    path.join(target, 'scripts/regenerate-speech.mjs'),
  ];
  const before = await readFile(source);
  const dry = await execute(process.execPath, args, {
    cwd: target,
    env,
    timeout: 30000,
  });
  expect(dry.stdout).toContain('1/2 TTS');
  expect(await readFile(source)).toEqual(before);
  expect(await readdir(target)).not.toContain('provider.jsonl');
  const run = await execute(process.execPath, [...args, '--confirm'], {
    cwd: target,
    env,
    timeout: 45000,
  });
  expect(run.stdout).toContain('Hotovo: 2');
  expect(run.stdout + run.stderr).not.toContain(env.ELEVENLABS_API_KEY);
  const requests = (await readFile(path.join(target, 'provider.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(
    requests.filter((r) => r.path.includes('/text-to-speech/')),
  ).toHaveLength(1);
  const after = JSON.parse(await readFile(source, 'utf8')) as GameContent;
  expect(
    after.dialogues[0]!.nodes.every(
      (n) => n.speech?.text === n.text && n.speech.lipSync,
    ),
  ).toBe(true);
});

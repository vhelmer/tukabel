import { expect, test } from '@playwright/test';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  analyzeSpeech,
  createSpeech,
  pcmWave,
  speechCatalog,
  validateSpeechAssets,
  waveDuration,
} from '../dev/speech';
import {
  lipSyncIssue,
  mouthFrame,
  mouthShapeAt,
  defaultVoice,
  voiceIssue,
} from '../src/game/speech';
import { validateProject } from '../src/game/validateProject';
import type { GameContent, LipSyncTrack } from '../src/game/types';

const track: LipSyncTrack = {
  metadata: { duration: 1 },
  mouthCues: [
    { start: 0, end: 0.1, value: 'X' },
    { start: 0.1, end: 0.3, value: 'D' },
    { start: 0.4, end: 1, value: 'A' },
  ],
};
test('Rhubarb timing uses exact audio boundaries, silence and deterministic missing-shape fallbacks', () => {
  expect(lipSyncIssue(track)).toBeUndefined();
  expect(
    [0, 100, 299, 300, 400, 1000].map((t) => mouthShapeAt(track, t)),
  ).toEqual(['X', 'D', 'D', 'X', 'A', 'X']);
  const binding = { mouthShapes: { X: 0, B: 1, C: 2 } };
  expect(
    ['X', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((s) =>
      mouthFrame(binding, s as 'X'),
    ),
  ).toEqual([0, 0, 1, 2, 2, 2, 2, 2, 2]);
  expect(mouthFrame({}, 'D')).toBe(0);
  expect(
    lipSyncIssue({ ...track, mouthCues: [{ start: 0, end: 2, value: 'D' }] }),
  ).toBeTruthy();
  expect(
    lipSyncIssue({
      ...track,
      mouthCues: [track.mouthCues[1], track.mouthCues[0]],
    }),
  ).toBeTruthy();
  expect(voiceIssue({})).toBeTruthy();
});

test('ElevenLabs requires deliberate confirmation, sends server-only credentials and archives valid WAV without retries', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-speech-'));
  const voice = { ...defaultVoice, voiceId: 'voice-123' };
  let calls = 0;
  const mock: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/v1/models'))
      return new Response(
        JSON.stringify([
          {
            model_id: voice.modelId,
            can_do_text_to_speech: true,
            can_use_style: true,
            can_use_speaker_boost: true,
          },
        ]),
      );
    calls++;
    expect(String(input)).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice-123?output_format=pcm_22050',
    );
    expect((init!.headers as Record<string, string>)['xi-api-key']).toBe(
      'secret-for-test',
    );
    expect(JSON.parse(String(init!.body))).toMatchObject({
      text: 'Ahoj',
      model_id: voice.modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0,
        speed: 1,
        use_speaker_boost: true,
      },
    });
    return new Response(new Uint8Array(44100), { status: 200 });
  };
  try {
    await expect(
      createSpeech(
        root,
        { text: 'Ahoj', voice },
        { apiKey: 'secret-for-test', fetch: mock },
      ),
    ).rejects.toThrow('potvrdenie');
    expect(calls).toBe(0);
    const result = await createSpeech(
      root,
      { text: 'Ahoj', voice, confirmed: true },
      { apiKey: 'secret-for-test', fetch: mock },
    );
    expect(waveDuration(await readFile(path.join(root, result.audio)))).toBe(1);
    expect(
      await readFile(
        path.join(root, path.dirname(result.audio), 'record.json'),
        'utf8',
      ),
    ).not.toContain('secret-for-test');
    expect(calls).toBe(1);
    await expect(
      createSpeech(
        root,
        { text: 'Ahoj', voice, confirmed: true },
        {
          apiKey: 'secret-for-test',
          fetch: async () => {
            calls++;
            return new Response('secret-for-test', { status: 422 });
          },
        },
      ),
    ).rejects.toThrow('HTTP 422');
    expect(calls).toBe(2);
    expect((await readdir(path.join(root, 'speech'))).length).toBe(1);
    await expect(
      createSpeech(root, { text: 'Ahoj', voice, confirmed: true }, {}),
    ).rejects.toThrow('ELEVENLABS_API_KEY');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('uploaded WAV runs the phonetic CLI without shell interpolation and publishes verified cue files atomically', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-rhubarb-test-'));
  try {
    const wav = pcmWave(Buffer.alloc(44100));
    const speech = await createSpeech(
      root,
      { text: 'Ahoj', data: wav.toString('base64') },
      {},
    );
    const binary = path.join(root, 'fake rhubarb');
    await writeFile(
      binary,
      `#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(path.join(root, 'args.json'))},JSON.stringify(process.argv.slice(2)));process.stdout.write(${JSON.stringify(JSON.stringify(track))});\n`,
      { mode: 0o755 },
    );
    const result = await analyzeSpeech(
      root,
      { audio: speech.audio },
      { rhubarbBin: binary },
    );
    const args = JSON.parse(
      await readFile(path.join(root, 'args.json'), 'utf8'),
    );
    expect(args.slice(0, 6)).toEqual([
      '-r',
      'phonetic',
      '-f',
      'json',
      '--threads',
      '2',
    ]);
    const saved = JSON.parse(
      await readFile(path.join(root, result.lipSync), 'utf8'),
    );
    expect(saved.metadata.audioSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(saved).not.toHaveProperty('metadata.soundFile');
    const project = {
      dialogues: [
        {
          id: 'test',
          nodes: [{ id: 'line', speech: { ...speech, ...result } }],
        },
      ],
    } as unknown as GameContent;
    await expect(validateSpeechAssets(root, project)).resolves.toBeUndefined();
    await writeFile(
      path.join(root, speech.audio),
      pcmWave(Buffer.alloc(44100, 2)),
    );
    await expect(validateSpeechAssets(root, project)).rejects.toThrow(
      'nezodpovedá',
    );
    await expect(
      analyzeSpeech(
        root,
        { audio: '../../secret.wav' },
        { rhubarbBin: binary },
      ),
    ).rejects.toThrow('lokálny');
    await symlink(path.join(root, speech.audio), path.join(root, 'link.wav'));
    await expect(
      analyzeSpeech(root, { audio: 'link.wav' }, { rhubarbBin: binary }),
    ).rejects.toThrow('lokálny');
    await expect(
      analyzeSpeech(
        root,
        { audio: speech.audio },
        { rhubarbBin: '/missing/rhubarb' },
      ),
    ).rejects.toThrow('RHUBARB_BIN');
    expect(
      (await readdir(path.join(root, 'speech'))).some((n) =>
        n.endsWith('.tmp'),
      ),
    ).toBe(false);
    await expect(
      createSpeech(
        root,
        { text: 'bad', data: Buffer.from('no wav').toString('base64') },
        {},
      ),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('speech content validates actor, local media references and regional mouth frame indices', async () => {
  const original = JSON.parse(
    await readFile('src/game/content/project.json', 'utf8'),
  ) as GameContent;
  expect(validateProject(original)).toEqual([]);
  const bad = JSON.parse(JSON.stringify(original)); // Deliberately invalid JSON boundary.
  const actor = bad.scenes
    .find((s: GameContent['scenes'][number]) => s.id === 'animation-lab')
    .hotspots.find(
      (h: GameContent['scenes'][number]['hotspots'][number]) =>
        h.id === 'blink-character',
    );
  actor.animation.mouthShapes.D = 200;
  const node = bad.dialogues.find(
    (d: GameContent['dialogues'][number]) => d.id === 'animation-demo',
  ).nodes[0];
  node.actor.hotspotId = 'missing';
  node.speech.audio = 'https://example.com/file.wav';
  expect(validateProject(bad).join(' ')).toContain('expected local');
  node.speech.audio = 'speech/animation-demo/audio.wav';
  expect(validateProject(bad).join(' ')).toContain('unknown speaking actor');
  expect(validateProject(bad).join(' ')).toContain('mouth shape index');
  const root = path.resolve('src/assets');
  await expect(validateSpeechAssets(root, original)).resolves.toBeUndefined();
});

test('ElevenLabs catalog returns only non-secret voice and TTS model metadata', async () => {
  const result = await speechCatalog({
    apiKey: 'private',
    fetch: async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes('/voices')
            ? {
                voices: [{ voice_id: 'id', name: 'Hlas', secret: 'private' }],
                has_more: true,
              }
            : [
                {
                  model_id: 'model',
                  name: 'Model',
                  can_do_text_to_speech: true,
                  can_use_style: true,
                  can_use_speaker_boost: false,
                  languages: [{ language_id: 'sk' }],
                },
              ],
        ),
      ),
  });
  expect(result).toEqual({
    voices: [{ id: 'id', label: 'Hlas' }],
    hasMore: true,
    models: [
      {
        id: 'model',
        label: 'Model',
        style: true,
        speakerBoost: false,
        languages: ['sk'],
      },
    ],
  });
  expect(JSON.stringify(result)).not.toContain('private');
});

test('ElevenLabs auth errors identify the required permission without echoing provider secrets', async () => {
  const secret = 'private-key-must-never-appear';
  for (const [failingPath, permission] of [
    ['/v1/models', 'models_read'],
    ['/v2/voices', 'voices_read'],
  ]) {
    let message = '';
    try {
      await speechCatalog({
        apiKey: secret,
        fetch: async (url) =>
          String(url).includes(failingPath!)
            ? new Response(
                JSON.stringify({
                  detail: {
                    status: 'missing_permissions',
                    message: `Key ${secret} lacks permission`,
                  },
                }),
                { status: 401 },
              )
            : new Response(
                JSON.stringify(
                  String(url).includes('/voices') ? { voices: [] } : [],
                ),
              ),
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('HTTP 401');
    expect(message).toContain(permission!);
    expect(message).not.toContain(secret);
  }
  for (const body of [
    JSON.stringify({ detail: { status: 'invalid_api_key', message: secret } }),
    JSON.stringify({ detail: { status: secret, message: secret } }),
    secret,
  ]) {
    let message = '';
    try {
      await speechCatalog({
        apiKey: secret,
        fetch: async () => new Response(body, { status: 401 }),
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('HTTP 401');
    expect(message).toContain(
      body.includes('invalid_api_key') ? 'neplatný' : 'Over API kľúč',
    );
    expect(message).not.toContain(secret);
  }
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-tts-permission-'));
  try {
    await expect(
      createSpeech(
        root,
        {
          text: 'Ahoj',
          voice: { ...defaultVoice, voiceId: 'voice' },
          confirmed: true,
        },
        {
          apiKey: secret,
          fetch: async (url) =>
            String(url).endsWith('/models')
              ? new Response(
                  JSON.stringify([
                    {
                      model_id: defaultVoice.modelId,
                      can_do_text_to_speech: true,
                    },
                  ]),
                )
              : new Response(
                  JSON.stringify({
                    detail: { status: 'missing_permissions', message: secret },
                  }),
                  { status: 401 },
                ),
        },
      ),
    ).rejects.toThrow('text_to_speech');
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ElevenLabs payment errors explain plan and quota limits without retries or leaked secrets', async () => {
  const secret = 'private-payment-details-must-never-appear';
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-tts-payment-'));
  try {
    for (const [body, expected] of [
      [
        JSON.stringify({
          detail: { status: 'paid_plan_required', message: secret },
        }),
        'vyžaduje platený tarif',
      ],
      [
        JSON.stringify({
          detail: { status: 'payment_required', message: secret },
        }),
        'vyžaduje platbu',
      ],
      [
        JSON.stringify({
          detail: { status: 'quota_exceeded', message: secret },
        }),
        'kreditný limit',
      ],
      [
        JSON.stringify({ detail: { status: secret, message: secret } }),
        'vyžaduje platbu',
      ],
      [secret, 'vyžaduje platbu'],
    ]) {
      let generationCalls = 0;
      let message = '';
      try {
        await createSpeech(
          root,
          {
            text: 'Ahoj',
            voice: { ...defaultVoice, voiceId: 'voice' },
            confirmed: true,
          },
          {
            apiKey: secret,
            fetch: async (url) => {
              if (String(url).endsWith('/models'))
                return new Response(
                  JSON.stringify([
                    {
                      model_id: defaultVoice.modelId,
                      can_do_text_to_speech: true,
                    },
                  ]),
                );
              generationCalls += 1;
              return new Response(body, { status: 402 });
            },
          },
        );
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('HTTP 402');
      expect(message).toContain(expected!);
      expect(message).not.toContain(secret);
      expect(generationCalls).toBe(1);
      expect(await readdir(root)).toEqual([]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createSpeech,
  designVoice,
  pcmWave,
  saveDesignedVoice,
  validateSpeechAssets,
} from '../dev/speech';
import { retireDesignedVoice } from '../dev/voiceRotation';
import { defaultVoice, voiceIssue } from '../src/game/speech';
import { buildSubtitles } from '../src/game/subtitles';
import type { GameContent, VoiceSettings } from '../src/game/types';

const hash = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const target = {
  sceneId: 'scene',
  hotspotId: 'actor',
  confirmed: true,
} as const;
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-voice-rotation-'));
  let deletes = 0;
  const fetchMock: typeof fetch = async (url, init) => {
    if (init?.method === 'DELETE') {
      deletes++;
      expect(String(url)).toBe('https://api.elevenlabs.io/v1/voices/own-voice');
      return new Response(null, { status: 204 });
    }
    if (String(url).includes('/design?')) {
      const mp3 = Buffer.alloc(417);
      mp3.writeUInt32BE(0xfffb9000);
      return Response.json({
        previews: [0, 1, 2].map((i) => ({
          audio_base_64: Buffer.concat([mp3, mp3]).toString('base64'),
          generated_voice_id: `preview-${i}`,
          media_type: 'audio/mpeg',
          duration_secs: 1,
        })),
      });
    }
    return Response.json({ voice_id: 'own-voice' });
  };
  const options = { apiKey: 'never-expose-test-secret', fetch: fetchMock };
  const design = await designVoice(
    root,
    {
      confirmed: true,
      description:
        'A friendly elderly cartoon character with clear, warm and expressive delivery.',
      text: 'Tento kábel patrí mne! A teraz mi pozorne vysvetli, prečo sa celá dedina tvári, že o ňom nikdy nepočula. Ja na to prídem!',
      seed: 42,
    },
    options,
  );
  const saved = await saveDesignedVoice(
    root,
    {
      confirmed: true,
      name: 'Own test voice',
      manifest: design.manifest,
      generatedVoiceId: 'preview-0',
      previewIndex: 0,
    },
    options,
  );
  const voice: VoiceSettings = {
    ...defaultVoice,
    voiceId: saved.voiceId,
    designRegistration: saved.manifest,
    slot: 'rotating',
  };
  const pcm = Buffer.alloc(44100);
  for (let i = 0; i < pcm.length; i += 2)
    pcm.writeInt16LE(Math.round(Math.sin(i / 20) * 2000), i);
  const wav = pcmWave(pcm);
  const directory = 'speech/11111111-1111-1111-1111-111111111111';
  await mkdir(path.join(root, directory));
  await writeFile(path.join(root, directory, 'audio.wav'), wav);
  await writeFile(
    path.join(root, directory, 'record.json'),
    JSON.stringify({
      provider: 'elevenlabs',
      voice,
      text: 'Ahoj.',
      duration: 1,
      audioSha256: hash(wav),
    }),
  );
  await writeFile(
    path.join(root, directory, 'track.json'),
    JSON.stringify({
      metadata: { duration: 1, audioSha256: hash(wav) },
      mouthCues: [{ start: 0, end: 1, value: 'C' }],
    }),
  );
  const speech = {
    text: 'Ahoj.',
    audio: `${directory}/audio.wav`,
    lipSync: `${directory}/track.json`,
    subtitles: buildSubtitles('Ahoj.', 1),
  };
  const project = {
    id: 'rotation-test',
    scenes: [
      { id: 'scene', hotspots: [{ id: 'actor', animation: { voice } }] },
    ],
    dialogues: [
      {
        id: 'dialogue',
        start: 'menu',
        nodes: [
          {
            id: 'menu',
            actor: { sceneId: 'scene', hotspotId: 'actor' },
            text: 'Unplayed topic menu',
            choices: [{ id: 'start', next: 'line' }],
          },
          {
            id: 'line',
            actor: { sceneId: 'scene', hotspotId: 'actor' },
            text: 'Ahoj.',
            speech,
            choices: [],
          },
        ],
      },
    ],
  } as unknown as GameContent;
  return {
    root,
    voice,
    project,
    speech,
    directory,
    options,
    deletes: () => deletes,
  };
}
function withVoice(project: GameContent, voice: VoiceSettings): GameContent {
  return {
    ...project,
    scenes: project.scenes.map((scene) => ({
      ...scene,
      hotspots: scene.hotspots.map((actor) => ({
        ...actor,
        animation: { ...actor.animation, voice },
      })),
    })),
  };
}

test('static, legacy, partial, stale and forged voice archives never delete a provider voice', async () => {
  const f = await fixture();
  try {
    for (const voice of [
      { ...f.voice, slot: 'static' as const },
      { ...f.voice, slot: undefined },
      { ...f.voice, designRegistration: undefined },
    ])
      await expect(
        retireDesignedVoice(
          f.root,
          withVoice(f.project, voice),
          target,
          f.options,
        ),
      ).rejects.toThrow();
    const updateLine = (changes: Record<string, unknown>) =>
      ({
        ...f.project,
        dialogues: f.project.dialogues.map((dialogue) => ({
          ...dialogue,
          nodes: dialogue.nodes.map((node) =>
            node.id === 'line' ? { ...node, ...changes } : node,
          ),
        })),
      }) as GameContent;
    for (const speech of [
      undefined,
      { ...f.speech, text: 'Old text' },
      { ...f.speech, lipSync: undefined },
      {
        ...f.speech,
        subtitles: { ...f.speech.subtitles, text: 'Old subtitles' },
      },
    ])
      await expect(
        retireDesignedVoice(f.root, updateLine({ speech }), target, f.options),
      ).rejects.toThrow();
    const trackPath = path.join(f.root, f.directory, 'track.json');
    const originalTrack = await readFile(trackPath);
    await writeFile(
      trackPath,
      originalTrack
        .toString()
        .replace(
          hash(await readFile(path.join(f.root, f.speech.audio))),
          '0'.repeat(64),
        ),
    );
    await expect(
      retireDesignedVoice(f.root, f.project, target, f.options),
    ).rejects.toThrow();
    await writeFile(trackPath, originalTrack);
    const registrationPath = path.join(f.root, f.voice.designRegistration!);
    const registration = await readFile(registrationPath);
    await writeFile(
      registrationPath,
      registration.toString().replace('own-voice', 'someone-elses-voice'),
    );
    await expect(
      retireDesignedVoice(f.root, f.project, target, f.options),
    ).rejects.toThrow();
    await writeFile(registrationPath, registration);
    const sharedStatic = {
      ...f.project,
      scenes: f.project.scenes.map((scene) => ({
        ...scene,
        hotspots: [
          ...scene.hotspots,
          {
            ...scene.hotspots[0]!,
            id: 'protected-main-actor',
            animation: { voice: { ...f.voice, slot: 'static' as const } },
          },
        ],
      })),
    };
    await expect(
      retireDesignedVoice(f.root, sharedStatic, target, f.options),
    ).rejects.toThrow('statická');
    expect(f.deletes()).toBe(0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('silence, different TTS provenance and escaped audio symlinks never delete voices', async () => {
  const f = await fixture();
  const outside = await mkdtemp(
    path.join(tmpdir(), 'tukabel-rotation-outside-'),
  );
  try {
    const recordPath = path.join(f.root, f.directory, 'record.json');
    const record = await readFile(recordPath);
    await writeFile(
      recordPath,
      record.toString().replace('own-voice', 'legacy-voice'),
    );
    await expect(
      retireDesignedVoice(f.root, f.project, target, f.options),
    ).rejects.toThrow('archiv');
    await writeFile(recordPath, record);
    const audioPath = path.join(f.root, f.speech.audio);
    const original = await readFile(audioPath);
    const silence = pcmWave(Buffer.alloc(44100));
    await writeFile(audioPath, silence);
    await writeFile(
      path.join(f.root, f.directory, 'track.json'),
      JSON.stringify({
        metadata: { duration: 1, audioSha256: hash(silence) },
        mouthCues: [{ start: 0, end: 1, value: 'X' }],
      }),
    );
    await expect(
      retireDesignedVoice(f.root, f.project, target, f.options),
    ).rejects.toThrow('zvuk');
    await writeFile(path.join(outside, 'audio.wav'), original);
    await rm(audioPath);
    await symlink(path.join(outside, 'audio.wav'), audioPath);
    await expect(
      retireDesignedVoice(f.root, f.project, target, f.options),
    ).rejects.toThrow('lokální');
    expect(f.deletes()).toBe(0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('every played line across a shared cast must be verified; successful retirement archives proof and deletes exactly once', async () => {
  const f = await fixture();
  try {
    const secondActor = { sceneId: 'scene', hotspotId: 'second-actor' };
    const project = {
      ...f.project,
      scenes: f.project.scenes.map((scene) => ({
        ...scene,
        hotspots: [
          ...scene.hotspots,
          { ...scene.hotspots[0]!, id: secondActor.hotspotId },
        ],
      })),
      dialogues: [
        ...f.project.dialogues,
        {
          id: 'handoff',
          entry: 'speech' as const,
          start: 'reply',
          nodes: [
            {
              ...f.project.dialogues[0]!.nodes[1]!,
              id: 'reply',
              actor: secondActor,
            },
          ],
        },
      ],
    };
    const partial = {
      ...project,
      dialogues: project.dialogues.map((dialogue) =>
        dialogue.id === 'handoff'
          ? {
              ...dialogue,
              nodes: dialogue.nodes.map((node) => ({
                ...node,
                speech: undefined,
              })),
            }
          : dialogue,
      ),
    };
    await expect(
      retireDesignedVoice(f.root, partial, target, f.options),
    ).rejects.toThrow('chybí');
    const registration = await readFile(
      path.join(f.root, f.voice.designRegistration!),
    );
    const result = await retireDesignedVoice(
      f.root,
      project,
      target,
      f.options,
    );
    expect(result.verifiedLines).toBe(2);
    expect(f.deletes()).toBe(1);
    expect(result.voice.retired).toBe(true);
    expect(result.voice.retirementManifest).toBe(result.manifest);
    expect(voiceIssue(result.voice)).toBeUndefined();
    const receiptText = await readFile(
      path.join(f.root, result.manifest),
      'utf8',
    );
    const receipt = JSON.parse(receiptText);
    expect(receipt).toMatchObject({
      operation: 'voice-retirement',
      voiceId: f.voice.voiceId,
      verifiedLines: 2,
    });
    const verification = await readFile(
      path.join(f.root, receipt.verification),
    );
    expect(hash(verification)).toBe(receipt.verificationSha256);
    expect(
      JSON.parse(verification.toString()).lines.map(
        (line: { nodeId: string }) => line.nodeId,
      ),
    ).toEqual(['line', 'reply']);
    expect(receiptText).not.toContain(f.options.apiKey);
    expect(
      await readFile(path.join(f.root, f.voice.designRegistration!)),
    ).toEqual(registration);
    await expect(
      retireDesignedVoice(f.root, project, target, f.options),
    ).rejects.toThrow();
    let providerCalls = 0;
    await expect(
      createSpeech(
        f.root,
        { confirmed: true, text: 'New line', voice: result.voice },
        {
          apiKey: 'secret',
          fetch: async () => {
            providerCalls++;
            return Response.json({});
          },
        },
      ),
    ).rejects.toThrow('uvolněn');
    await expect(
      createSpeech(
        f.root,
        { confirmed: true, text: 'Stale draft line', voice: f.voice },
        {
          apiKey: 'secret',
          fetch: async () => {
            providerCalls++;
            return Response.json({});
          },
        },
      ),
    ).rejects.toThrow('uvolněn');
    const imported = await createSpeech(
      f.root,
      {
        text: 'Imported replacement',
        voice: result.voice,
        data: (await readFile(path.join(f.root, f.speech.audio))).toString(
          'base64',
        ),
      },
      {},
    );
    expect(imported.text).toBe('Imported replacement');
    expect(providerCalls).toBe(0);
    expect(f.deletes()).toBe(1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('a topic-free start played through Porozprávať sa needs verified audio before retirement', async () => {
  const f = await fixture();
  try {
    const project = {
      ...f.project,
      dialogues: [
        ...f.project.dialogues,
        {
          id: 'one-line',
          start: 'intro',
          nodes: [
            {
              id: 'intro',
              speaker: 'Postava',
              actor: { sceneId: 'scene', hotspotId: 'actor' },
              text: 'Ešte niečo poviem.',
              choices: [{ id: 'bye', text: 'Dovidenia.', effects: [] }],
            },
          ],
        },
      ],
    };
    await expect(
      retireDesignedVoice(f.root, project, target, f.options),
    ).rejects.toThrow('one-line/intro');
    expect(f.deletes()).toBe(0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('retirement errors expose only safe known provider messages and do not retry', async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const result = retireDesignedVoice(f.root, f.project, target, {
      apiKey: 'private-secret',
      fetch: async () => {
        calls++;
        return Response.json(
          {
            detail: {
              status: 'missing_permissions',
              message: 'private-secret and sensitive provider message',
            },
          },
          { status: 403 },
        );
      },
    });
    await expect(result).rejects.toThrow('voices_write');
    await expect(result).rejects.not.toThrow('private-secret');
    expect(calls).toBe(1);
    expect(voiceIssue({ ...f.voice, retired: true })).toBeDefined();
    expect(
      voiceIssue({
        ...f.voice,
        slot: 'static',
        retired: true,
        retirementManifest:
          'speech/11111111-1111-1111-1111-111111111111/retirement.json',
      }),
    ).toBeDefined();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('saved retired voices require the exact receipt and intact historical proof even after dialogue edits', async () => {
  const f = await fixture();
  try {
    const result = await retireDesignedVoice(
      f.root,
      f.project,
      target,
      f.options,
    );
    const project = { ...withVoice(f.project, result.voice), dialogues: [] };
    await expect(
      validateSpeechAssets(f.root, project),
    ).resolves.toBeUndefined();
    const missingReceipt = {
      ...result.voice,
      retirementManifest:
        'speech/22222222-2222-2222-2222-222222222222/retirement.json',
    };
    await expect(
      validateSpeechAssets(f.root, withVoice(project, missingReceipt)),
    ).rejects.toThrow();
    const mixed = {
      ...project,
      scenes: project.scenes.map((scene) => ({
        ...scene,
        hotspots: [
          ...scene.hotspots,
          { id: 'stale-actor', animation: { voice: missingReceipt } },
        ],
      })),
    } as GameContent;
    await expect(validateSpeechAssets(f.root, mixed)).rejects.toThrow();
    const receiptFile = path.join(f.root, result.manifest);
    const receiptBytes = await readFile(receiptFile);
    const receipt = JSON.parse(receiptBytes.toString());
    await writeFile(
      receiptFile,
      JSON.stringify({ ...receipt, voiceId: 'other' }),
    );
    await expect(validateSpeechAssets(f.root, project)).rejects.toThrow();
    await writeFile(receiptFile, receiptBytes);
    for (const asset of [
      receipt.verification,
      f.voice.designRegistration!,
      `${f.directory}/record.json`,
      f.speech.lipSync,
      f.speech.audio,
    ]) {
      const filename = path.join(f.root, asset);
      const original = await readFile(filename);
      await writeFile(
        filename,
        asset.endsWith('.wav')
          ? pcmWave(Buffer.alloc(44100, 4))
          : Buffer.concat([original, Buffer.from(' ')]),
      );
      await expect(validateSpeechAssets(f.root, project)).rejects.toThrow();
      await writeFile(filename, original);
    }
    await expect(
      validateSpeechAssets(f.root, project),
    ).resolves.toBeUndefined();
    expect(f.deletes()).toBe(1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('an ambiguous deletion keeps its proof and blocks both retry and stale TTS', async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const options = {
      apiKey: 'secret',
      fetch: (async () => {
        calls++;
        throw new Error('secret provider internals');
      }) as typeof fetch,
    };
    await expect(
      retireDesignedVoice(f.root, f.project, target, options),
    ).rejects.toThrow('nedostupný');
    await expect(
      retireDesignedVoice(f.root, f.project, target, options),
    ).rejects.toThrow('archivované');
    await expect(
      createSpeech(
        f.root,
        { confirmed: true, text: 'Stale text', voice: f.voice },
        options,
      ),
    ).rejects.toThrow('uvolněn');
    expect(calls).toBe(1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

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
  designVoice,
  saveDesignedVoice,
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
  modelFeatures,
} from '../src/game/speech';
import {
  alignmentIssue,
  buildSubtitles,
  stripAudioTags,
  subtitleText,
  subtitleAt,
  subtitleTrackIssue,
  splitSubtitle,
} from '../src/game/subtitles';
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
      'https://api.elevenlabs.io/v1/text-to-speech/voice-123/with-timestamps?output_format=pcm_22050',
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
    return new Response(
      JSON.stringify({
        audio_base64: Buffer.alloc(44100).toString('base64'),
        alignment: null,
      }),
    );
  };
  try {
    await expect(
      createSpeech(
        root,
        { text: 'Ahoj', voice },
        { apiKey: 'secret-for-test', fetch: mock },
      ),
    ).rejects.toThrow('potvrzení');
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
      'neodpovídá',
    );
    await expect(
      analyzeSpeech(
        root,
        { audio: '../../secret.wav' },
        { rhubarbBin: binary },
      ),
    ).rejects.toThrow('lokální');
    await symlink(path.join(root, speech.audio), path.join(root, 'link.wav'));
    await expect(
      analyzeSpeech(root, { audio: 'link.wav' }, { rhubarbBin: binary }),
    ).rejects.toThrow('lokální');
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
    await readFile('tests/fixtures/demo-project.json', 'utf8'),
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
        audioTags: false,
        speed: true,
        maxCharacters: null,
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
      body.includes('invalid_api_key') ? 'neplatný' : 'Ověř API klíč',
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
        'vyžaduje placený tarif',
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
        'kreditní limit',
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

test('subtitles remove nested audio directions and follow actual character timing including pauses', () => {
  const text =
    '[laughs] První veta je pomerne dlhá. [whispers] Druhá veta už príde oveľa později.';
  const chars = [...text],
    next = text.indexOf('Druhá');
  const starts = chars.map((_, i) =>
    i < next ? i * 0.03 : 8 + (i - next) * 0.06,
  );
  const alignment = {
    metadata: { duration: 15 },
    characters: chars,
    character_start_times_seconds: starts,
    character_end_times_seconds: starts.map((t) => t + 0.03),
  };
  expect(alignmentIssue(alignment)).toBeUndefined();
  expect(stripAudioTags(' A [smích [nahlas]]  veta [crying]. ')).toBe(
    'A veta.',
  );
  expect(stripAudioTags('[laughs][crying]')).toBe('');
  const clean = subtitleText({ text });
  expect(subtitleText({ text, subtitle: 'Vlastní preklad.' })).toBe(
    'Vlastní preklad.',
  );
  expect(subtitleText({ text, subtitle: '  ' })).toBe(clean);
  const track = buildSubtitles(clean, 15, alignment);
  expect(track.timing).toBe('alignment');
  expect(track.cues).toHaveLength(2);
  expect(track.cues[0]!.end).toBeLessThan(3);
  expect(track.cues[1]!.start).toBe(8);
  expect(subtitleAt(track.cues, 5)).toBe('');
  expect(subtitleAt(track.cues, 8)).toContain('Druhá');
  expect(subtitleAt(track.cues, track.cues[1]!.end)).toBe('');
  expect(subtitleTrackIssue(track, 15)).toBeUndefined();
  expect(
    buildSubtitles('Iný preklad s iným počtom slov.', 15, alignment).timing,
  ).toBe('estimated');
  expect(buildSubtitles('', 15).cues).toEqual([]);
  const estimate = buildSubtitles('Toto je oveľa dlhší text. '.repeat(10), 15);
  expect(estimate.cues.length).toBeGreaterThan(3);
  expect(estimate.cues.at(-1)!.end).toBeCloseTo(15);
  const split = splitSubtitle({
    start: 1,
    end: 5,
    text: 'První polovica druhá polovica',
  });
  expect(split).toHaveLength(2);
  expect(split[0]!.end).toBe(split[1]!.start);
  expect(split[0]!.text + ' ' + split[1]!.text).toBe(
    'První polovica druhá polovica',
  );
  expect(
    subtitleTrackIssue({ ...track, cues: [{ start: 2, end: 1, text: 'Zle' }] }),
  ).toBeTruthy();
  expect(
    subtitleTrackIssue(
      { ...track, cues: [{ start: 0, end: 16, text: 'Zle' }] },
      15,
    ),
  ).toBeTruthy();
  expect(
    subtitleTrackIssue({ ...track, cues: [track.cues[0], track.cues[0]] }),
  ).toBeTruthy();
  expect(
    alignmentIssue({ ...alignment, character_end_times_seconds: [1] }),
  ).toBeTruthy();
  expect(
    alignmentIssue({
      ...alignment,
      character_start_times_seconds: starts.map(() => -1),
    }),
  ).toBeTruthy();
});

test('expressive TTS preserves tags, omits unsupported settings and archives verifiable timing without another paid request', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-tts-alignment-'));
  const text = '[laughs] Ahoj!',
    characters = [...text];
  let paidCalls = 0;
  try {
    const speech = await createSpeech(
      root,
      {
        text,
        voice: { ...defaultVoice, voiceId: 'voice', modelId: 'eleven_v3' },
        confirmed: true,
      },
      {
        apiKey: 'private',
        fetch: async (url, init) => {
          if (String(url).endsWith('/models'))
            return Response.json([
              {
                model_id: 'eleven_v3',
                can_do_text_to_speech: true,
                maximum_text_length_per_request: 5000,
                can_use_style: false,
                can_use_speaker_boost: false,
              },
            ]);
          paidCalls++;
          const body = JSON.parse(String(init!.body));
          expect(body.text).toBe(text);
          expect(body.voice_settings).toEqual({
            stability: 0.5,
            similarity_boost: 0.75,
          });
          return Response.json({
            audio_base64: Buffer.alloc(44100).toString('base64'),
            alignment: {
              characters,
              character_start_times_seconds: characters.map((_, i) => i * 0.05),
              character_end_times_seconds: characters.map(
                (_, i) => i * 0.05 + 0.04,
              ),
            },
          });
        },
      },
    );
    expect(paidCalls).toBe(1);
    expect(speech.text).toBe(text);
    expect(speech.subtitles?.text).toBe('Ahoj!');
    expect(speech.subtitles?.timing).toBe('alignment');
    expect(speech.alignment).toBeTruthy();
    const project = {
      dialogues: [{ id: 'test', nodes: [{ id: 'one', speech }] }],
    } as unknown as GameContent;
    await validateSpeechAssets(root, project);
    await expect(
      validateSpeechAssets(root, {
        dialogues: [
          {
            id: 'test',
            nodes: [
              {
                id: 'one',
                speech: {
                  ...speech,
                  subtitles: {
                    ...speech.subtitles!,
                    cues: [{ start: 0, end: 2, text: 'Zle' }],
                  },
                },
              },
            ],
          },
        ],
      } as unknown as GameContent),
    ).rejects.toThrow('subtitle');
    const alignmentFile = path.join(root, speech.alignment!);
    const data = JSON.parse(await readFile(alignmentFile, 'utf8'));
    data.metadata.audioSha256 = 'wrong';
    await writeFile(alignmentFile, JSON.stringify(data));
    await expect(validateSpeechAssets(root, project)).rejects.toThrow(
      'zarovnání',
    );
    expect(modelFeatures('eleven_v4').audioTags).toBe(true);
    expect(modelFeatures('eleven_v4_turbo').speed).toBe(false);
    expect(modelFeatures('eleven_flash_v2_5').audioTags).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function designMp3(fill = 0) {
  const frame = Buffer.alloc(417, fill);
  frame.writeUInt32BE(0xfffb9000);
  return Buffer.concat([frame, frame]);
}

test('designed voice provenance accepts only a local registration archive and preserves legacy voices', async () => {
  const voice = { ...defaultVoice, voiceId: 'custom-voice' };
  const designRegistration =
    'speech/12345678-1234-1234-1234-123456789abc/registration.json';
  expect(voiceIssue(voice)).toBeUndefined();
  expect(
    voiceIssue({
      ...voice,
      designRegistration,
    }),
  ).toBeUndefined();
  for (const designRegistration of [
    '../registration.json',
    'https://example.com/registration.json',
    'speech/12345678-1234-1234-1234-123456789abc/design.json',
    'speech/../registration.json',
    42,
  ])
    expect(voiceIssue({ ...voice, designRegistration })).toBeDefined();
  const original = JSON.parse(
    await readFile('tests/fixtures/demo-project.json', 'utf8'),
  ) as GameContent;
  const project = {
    ...original,
    scenes: original.scenes.map((scene) => ({
      ...scene,
      hotspots: scene.hotspots.map((hotspot) =>
        hotspot.id === 'blink-character'
          ? {
              ...hotspot,
              animation: {
                ...hotspot.animation,
                voice: { ...voice, designRegistration },
              },
            }
          : hotspot,
      ),
    })),
  };
  expect(validateProject(project)).toEqual([]);
});

test('Voice Design archives all three MP3 previews and registers only the selected verified preview without mutating the design', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-design-'));
  const description =
    'A cartoon villain with an absurdly deep gravelly voice, perfectly intelligible.';
  const text =
    'Tento kábel patrí mne! A teraz mi pozorne vysvetli, prečo sa celá dedina tvári, že o ňom nikdy nepočula. Ja na to prídem!';
  const options = {
    apiKey: 'design-test-secret',
    fetch: (async (url, init) => {
      expect((init?.headers as Record<string, string>)['xi-api-key']).toBe(
        'design-test-secret',
      );
      if (String(url).includes('/design?')) {
        expect(String(url)).toBe(
          'https://api.elevenlabs.io/v1/text-to-voice/design?output_format=mp3_44100_128',
        );
        expect(JSON.parse(String(init?.body))).toEqual({
          voice_description: description,
          model_id: 'eleven_ttv_v3',
          text,
          auto_generate_text: false,
          seed: 42,
        });
        return new Response(
          JSON.stringify({
            previews: [0, 1, 2].map((i) => ({
              audio_base_64: designMp3(i).toString('base64'),
              generated_voice_id: `generated-${i}`,
              media_type: 'audio/mpeg',
              duration_secs: 1,
            })),
          }),
        );
      }
      expect(String(url)).toBe('https://api.elevenlabs.io/v1/text-to-voice');
      expect(JSON.parse(String(init?.body))).toEqual({
        voice_name: 'Káblový zloduch',
        voice_description: description,
        generated_voice_id: 'generated-1',
      });
      return new Response(
        JSON.stringify({
          voice_id: 'persistent-designed-voice',
          preview_url: 'secret-provider-url',
          private: 'do-not-copy',
        }),
      );
    }) as typeof fetch,
  };
  try {
    const design = await designVoice(
      root,
      { description, text, seed: 42, confirmed: true },
      options,
    );
    expect(design.previews).toHaveLength(3);
    const before = await readFile(path.join(root, design.manifest));
    expect(JSON.parse(before.toString())).toMatchObject({
      operation: 'voice-design',
      model: 'eleven_ttv_v3',
      seed: 42,
      guidanceScale: 5,
      outputFormat: 'mp3_44100_128',
      textSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    for (const preview of design.previews)
      expect(
        (await readFile(path.join(root, preview.audio))).equals(
          designMp3(design.previews.indexOf(preview)),
        ),
      ).toBe(true);
    const saved = await saveDesignedVoice(
      root,
      {
        manifest: design.manifest,
        previewIndex: 1,
        generatedVoiceId: 'generated-1',
        name: 'Káblový zloduch',
        confirmed: true,
      },
      options,
    );
    expect(saved.voiceId).toBe('persistent-designed-voice');
    expect(path.dirname(saved.manifest)).not.toBe(
      path.dirname(design.manifest),
    );
    expect(await readFile(path.join(root, design.manifest))).toEqual(before);
    const registration = await readFile(
      path.join(root, saved.manifest),
      'utf8',
    );
    expect(JSON.parse(registration)).toMatchObject({
      designManifest: design.manifest,
      generatedVoiceId: 'generated-1',
      voiceId: saved.voiceId,
    });
    expect(registration).not.toContain('secret');
    expect(registration).not.toContain('do-not-copy');
    const voice = {
      ...defaultVoice,
      voiceId: saved.voiceId,
      designRegistration: saved.manifest,
    };
    const project = {
      scenes: [{ hotspots: [{ animation: { voice } }] }],
      dialogues: [],
    } as unknown as GameContent;
    await expect(validateSpeechAssets(root, project)).resolves.toBeUndefined();
    const speech = await createSpeech(
      root,
      { text: 'Kde je môj kábel?', voice, confirmed: true },
      {
        apiKey: 'test-key',
        fetch: async (url) =>
          new Response(
            JSON.stringify(
              String(url).endsWith('/models')
                ? [
                    {
                      model_id: 'eleven_multilingual_v2',
                      can_do_text_to_speech: true,
                    },
                  ]
                : {
                    audio_base64: Buffer.alloc(44100).toString('base64'),
                    alignment: null,
                  },
            ),
          ),
      },
    );
    const speechRecord = JSON.parse(
      await readFile(
        path.join(root, path.dirname(speech.audio), 'record.json'),
        'utf8',
      ),
    );
    expect(speechRecord.voice.designRegistration).toBe(saved.manifest);
    await expect(
      validateSpeechAssets(root, {
        ...project,
        scenes: [
          {
            hotspots: [
              { animation: { voice: { ...voice, voiceId: 'other-voice' } } },
            ],
          },
        ],
      } as unknown as GameContent),
    ).rejects.toThrow('hlas');
    await writeFile(path.join(root, design.manifest), `${before.toString()} `);
    await expect(validateSpeechAssets(root, project)).rejects.toThrow('změněn');
    await writeFile(path.join(root, design.manifest), before);
    await writeFile(path.join(root, design.previews[1]!.audio), designMp3(9));
    await expect(validateSpeechAssets(root, project)).rejects.toThrow(
      'změněna',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Voice Design validates before charging, rejects incomplete output and never retries or leaks provider errors', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-design-invalid-'));
  const input = {
    description: 'A very squeaky hysterical cartoon character.',
    text: 'A sufficiently long example of speech for designing a cartoon character. Every syllable must remain clear and easy to understand.',
    confirmed: true,
  };
  let calls = 0;
  const options = {
    apiKey: 'private-key',
    fetch: (async () => {
      calls++;
      return new Response(
        JSON.stringify({
          detail: { status: 'missing_permissions', message: 'private-key' },
        }),
        { status: 403 },
      );
    }) as typeof fetch,
  };
  try {
    for (const invalid of [
      { ...input, confirmed: false },
      { ...input, description: 'short' },
      { ...input, text: 'short' },
      { ...input, seed: -1 },
      { ...input, seed: 1.2 },
      { ...input, guidanceScale: 101 },
    ])
      await expect(designVoice(root, invalid, options)).rejects.toThrow();
    expect(calls).toBe(0);
    await expect(designVoice(root, input, options)).rejects.toThrow(
      'voice_generation',
    );
    expect(calls).toBe(1);
    await expect(
      designVoice(root, input, {
        ...options,
        fetch: async () => new Response(JSON.stringify({ previews: [] })),
      }),
    ).rejects.toThrow('tři');
    expect(await readdir(root)).toEqual([]);
    const error = await designVoice(root, input, options).catch((e) =>
      String(e),
    );
    expect(error).not.toContain('private-key');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Voice registration rejects paths, substitutions and altered audio before provider requests', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-design-integrity-'));
  const input = {
    description: 'A very squeaky hysterical cartoon character.',
    text: 'A sufficiently long example of speech for designing a cartoon character. Every syllable must remain clear and easy to understand.',
    confirmed: true,
  };
  let calls = 0;
  const options = {
    apiKey: 'private-key',
    fetch: (async (url) => {
      calls++;
      if (String(url).includes('/design?'))
        return new Response(
          JSON.stringify({
            previews: [0, 1, 2].map((i) => ({
              audio_base_64: designMp3().toString('base64'),
              generated_voice_id: `design-${i}`,
              media_type: 'audio/mpeg',
              duration_secs: 1,
            })),
          }),
        );
      return new Response(
        JSON.stringify({
          detail: { status: 'missing_permissions', message: 'private-key' },
        }),
        { status: 403 },
      );
    }) as typeof fetch,
  };
  try {
    const design = await designVoice(root, input, options);
    const selection = {
      manifest: design.manifest,
      previewIndex: 0,
      name: 'Character',
      confirmed: true,
    };
    for (const invalid of [
      { ...selection, confirmed: false },
      { ...selection, manifest: '../design.json' },
      { ...selection, previewIndex: 3 },
      { ...selection, generatedVoiceId: 'forged' },
    ])
      await expect(saveDesignedVoice(root, invalid, options)).rejects.toThrow();
    expect(calls).toBe(1);
    await expect(saveDesignedVoice(root, selection, options)).rejects.toThrow(
      'voices_write',
    );
    expect(calls).toBe(2);
    await writeFile(path.join(root, design.previews[0]!.audio), designMp3(1));
    await expect(saveDesignedVoice(root, selection, options)).rejects.toThrow(
      'změněna',
    );
    expect(calls).toBe(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('TTS rejects explicit language enforcement on Multilingual v2 before charging even when it supports the language', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-tts-language-v2-'));
  let generated = 0;
  try {
    await expect(
      createSpeech(
        root,
        {
          text: 'Kde je môj kábel?',
          voice: { ...defaultVoice, voiceId: 'designed-character' },
          languageCode: 'sk',
          confirmed: true,
        },
        {
          apiKey: 'test-key',
          fetch: async (url) => {
            if (String(url).endsWith('/models'))
              return new Response(
                JSON.stringify([
                  {
                    model_id: 'eleven_multilingual_v2',
                    can_do_text_to_speech: true,
                    languages: [{ language_id: 'sk' }],
                  },
                ]),
              );
            generated++;
            return new Response(
              JSON.stringify({
                audio_base64: Buffer.alloc(44100).toString('base64'),
                alignment: null,
              }),
            );
          },
        },
      ),
    ).rejects.toThrow('nepodporuje vynucení jazyka');
    expect(generated).toBe(0);
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('TTS validates an explicit language against model metadata before charging and records the chosen language', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-tts-language-'));
  let requests = 0;
  let generated = 0;
  const options = {
    apiKey: 'test-key',
    fetch: (async (url, init) => {
      requests++;
      if (String(url).endsWith('/models'))
        return new Response(
          JSON.stringify([
            {
              model_id: 'eleven_v4',
              can_do_text_to_speech: true,
              languages: [{ language_id: 'sk' }],
            },
          ]),
        );
      generated++;
      expect(JSON.parse(String(init?.body)).language_code).toBe('sk');
      return new Response(
        JSON.stringify({
          audio_base64: Buffer.alloc(44100).toString('base64'),
          alignment: null,
        }),
      );
    }) as typeof fetch,
  };
  const input = {
    text: 'Kde je môj kábel?',
    voice: {
      ...defaultVoice,
      voiceId: 'designed-character',
      modelId: 'eleven_v4',
    },
    confirmed: true,
  };
  try {
    await expect(
      createSpeech(root, { ...input, languageCode: 'Slovak' }, options),
    ).rejects.toThrow('Kód jazyka');
    expect(requests).toBe(0);
    await expect(
      createSpeech(root, { ...input, languageCode: 'cs' }, options),
    ).rejects.toThrow('podporu');
    expect(generated).toBe(0);
    const result = await createSpeech(
      root,
      { ...input, languageCode: 'sk' },
      options,
    );
    expect(generated).toBe(1);
    const record = JSON.parse(
      await readFile(
        path.join(root, path.dirname(result.audio), 'record.json'),
        'utf8',
      ),
    );
    expect(record.languageCode).toBe('sk');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Voice Design refuses invalid MP3, MIME, duration and duplicate IDs without publishing partial archives', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-design-mp3-'));
  const input = {
    description: 'A very squeaky hysterical cartoon character.',
    text: 'A sufficiently long example of speech for designing a cartoon character. Every syllable must remain clear and easy to understand.',
    confirmed: true,
  };
  const preview = {
    audio_base_64: designMp3().toString('base64'),
    generated_voice_id: 'generated',
    media_type: 'audio/mpeg',
    duration_secs: 1,
  };
  try {
    for (const invalid of [
      {
        ...preview,
        audio_base_64: Buffer.from('ID3-not-an-mp3').toString('base64'),
      },
      {
        ...preview,
        audio_base_64: designMp3().subarray(0, 500).toString('base64'),
      },
      { ...preview, media_type: 'audio/pcm' },
      { ...preview, duration_secs: 181 },
      { ...preview, duration_secs: null },
    ]) {
      await expect(
        designVoice(root, input, {
          apiKey: 'test-key',
          fetch: async () =>
            new Response(
              JSON.stringify({ previews: [invalid, preview, preview] }),
            ),
        }),
      ).rejects.toThrow();
      expect(await readdir(root)).toEqual([]);
    }
    await expect(
      designVoice(root, input, {
        apiKey: 'test-key',
        fetch: async () =>
          new Response(
            JSON.stringify({ previews: [preview, preview, preview] }),
          ),
      }),
    ).rejects.toThrow('duplicitní');
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { planSpeechBatch, voiceSignature } from '../dev/speechBatchPlan';
import { pcmWave } from '../dev/speech';
import { defaultVoice, voiceIssue } from '../src/game/speech';
import type { GameContent, VoiceSettings } from '../src/game/types';
import { validateProject } from '../src/game/validateProject';

const hash = (bytes: Buffer | string) =>
  createHash('sha256').update(bytes).digest('hex');
const archive = 'speech/11111111-1111-1111-1111-111111111111';
const description = 'A warm elderly Slovak cartoon voice with clear delivery.';
const actor = { sceneId: 'scene', hotspotId: 'actor' };
const roots: string[] = [];
test.afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-speech-batch-'));
  roots.push(root);
  const voice: VoiceSettings = {
    ...defaultVoice,
    voiceId: 'own-voice',
    slot: 'static',
  };
  const wav = pcmWave(Buffer.alloc(44100, 1));
  await mkdir(path.join(root, archive), { recursive: true });
  await writeFile(path.join(root, archive, 'audio.wav'), wav);
  const record = {
    provider: 'elevenlabs',
    voice,
    text: 'Ahoj.',
    duration: 1,
    audioSha256: hash(wav),
  };
  const writeRecord = (next: unknown = record) =>
    writeFile(path.join(root, archive, 'record.json'), JSON.stringify(next));
  await writeRecord();
  const speech = { text: record.text, audio: `${archive}/audio.wav` };
  const project = {
    id: 'batch-test',
    scenes: [
      {
        id: 'scene',
        hotspots: [{ id: 'actor', label: 'Dedo', animation: { voice } }],
      },
    ],
    dialogues: [
      {
        id: 'dialogue',
        start: 'menu',
        nodes: [
          {
            id: 'menu',
            actor,
            text: 'Unplayed menu',
            choices: [{ id: 'speak', next: 'line' }],
          },
          { id: 'line', actor, text: record.text, speech, choices: [] },
        ],
      },
    ],
  };
  const plan = (options = {}) =>
    planSpeechBatch(root, project as unknown as GameContent, options);
  return { root, voice, record, writeRecord, speech, project, plan };
}

async function designRegistration(root: string) {
  const mp3Frame = Buffer.alloc(417);
  mp3Frame.writeUInt32BE(0xfffb9000);
  const mp3 = Buffer.concat([mp3Frame, mp3Frame]);
  await writeFile(path.join(root, archive, 'preview-1.mp3'), mp3);
  const design = JSON.stringify({
    version: 1,
    operation: 'voice-design',
    provider: 'elevenlabs',
    model: 'eleven_ttv_v3',
    outputFormat: 'mp3_44100_128',
    description,
    text: 'Ahoj.',
    textSha256: hash('Ahoj.'),
    previews: [0, 1, 2].map((index) => ({
      generatedVoiceId: `preview-${index}`,
      audio: `preview-${index + 1}.mp3`,
      duration: 1,
      audioSha256: hash(mp3),
    })),
  });
  await writeFile(path.join(root, archive, 'design.json'), design);
  await writeFile(
    path.join(root, archive, 'registration.json'),
    JSON.stringify({
      version: 1,
      operation: 'voice-registration',
      provider: 'elevenlabs',
      voiceId: 'own-voice',
      generatedVoiceId: 'preview-0',
      designManifest: `${archive}/design.json`,
      designSha256: hash(design),
      previewIndex: 0,
      description,
    }),
  );
  return `${archive}/registration.json`;
}

test('unchanged played WAV is preserved while every played line gets new Rhubarb', async () => {
  const f = await fixture();
  const before = await readFile(path.join(f.root, archive, 'record.json'));
  const plan = await f.plan();
  expect(plan.errors).toEqual([]);
  expect(plan.lines.map((line) => line.key)).toEqual(['dialogue/line']);
  expect(plan.generateCount).toBe(0);
  expect(plan.lipSyncCount).toBe(1);
  expect(plan.characters).toBe(0);
  expect(plan.actors[0]?.restore).toBe(false);
  expect(await readFile(path.join(f.root, archive, 'record.json'))).toEqual(
    before,
  );
  const all = await f.plan({ all: true });
  expect(all.generateCount).toBe(1);
  expect(all.characters).toBe('Ahoj.'.length);
  expect(all.lines[0]?.reasons).toEqual(['all']);
});

test('missing WAV, invalid hash, stale text and unknown imported provenance are explicit', async () => {
  const f = await fixture();
  f.speech.text = 'Old line';
  expect((await f.plan()).lines[0]?.reasons).toEqual(['changed-text']);
  f.speech.text = 'Ahoj.';
  await f.writeRecord({ ...f.record, audioSha256: 'wrong' });
  expect((await f.plan()).lines[0]?.reasons).toEqual(['invalid-audio']);
  await f.writeRecord({ ...f.record, provider: 'upload' });
  expect((await f.plan()).lines[0]?.reasons).toEqual(['unknown-voice']);
  await f.writeRecord({ ...f.record, text: 'Old line' });
  expect((await f.plan()).lines[0]?.reasons).toEqual(['changed-text']);
  await rm(path.join(f.root, archive, 'audio.wav'));
  expect((await f.plan()).lines[0]?.reasons).toEqual(['missing-audio']);
});

test('synthesis signature checks voice, model and every sound parameter, ignoring lifecycle metadata', async () => {
  const f = await fixture();
  for (const change of [
    { voiceId: 'other' },
    { modelId: 'eleven_v4' },
    { stability: 0.8 },
    { similarityBoost: 0.3 },
    { style: 0.2 },
    { speed: 0.9 },
    { useSpeakerBoost: false },
  ]) {
    await f.writeRecord({ ...f.record, voice: { ...f.voice, ...change } });
    expect((await f.plan()).lines[0]?.reasons).toContain('changed-voice');
  }
  expect(voiceSignature({ ...f.voice, slot: 'rotating', retired: true })).toBe(
    voiceSignature(f.voice),
  );
  expect(voiceSignature({ ...f.voice, designPrompt: description })).toBe(
    voiceSignature(f.voice),
  );
});

test('single-line intro, incoming start and speech entry are played; actorless narration is omitted', async () => {
  const f = await fixture();
  const [menu, line] = f.project.dialogues[0]!.nodes;
  expect(menu).toBeDefined();
  f.project.dialogues[0]!.nodes = [line!];
  f.project.dialogues[0]!.start = 'line';
  expect((await f.plan()).lipSyncCount).toBe(1);
  f.project.dialogues[0]!.nodes = [menu!, line!];
  f.project.dialogues[0]!.start = 'menu';
  line!.choices = [{ id: 'back', next: 'menu' }];
  expect((await f.plan()).lipSyncCount).toBe(2);
  line!.choices = [];
  const speechEntry = structuredClone(f.project) as unknown as GameContent;
  const entryPlan = await planSpeechBatch(f.root, {
    ...speechEntry,
    dialogues: [{ ...speechEntry.dialogues[0]!, entry: 'speech' }],
  });
  expect(entryPlan.lipSyncCount).toBe(2);
  const noActor = await planSpeechBatch(f.root, {
    ...speechEntry,
    dialogues: [
      {
        ...speechEntry.dialogues[0]!,
        nodes: speechEntry.dialogues[0]!.nodes.map((node) => ({
          ...node,
          actor: undefined,
        })),
      },
    ],
  });
  expect(noActor.lines).toEqual([]);
});

test('restoring a retired actor regenerates every line with the new voice and current tag-free preview', async () => {
  const f = await fixture();
  const registration = await designRegistration(f.root);
  const voice: VoiceSettings = {
    ...f.voice,
    slot: 'rotating',
    retired: true,
    designRegistration: registration,
    retirementManifest: `${archive}/retirement.json`,
  };
  f.project.scenes[0]!.hotspots[0]!.animation.voice = voice;
  await f.writeRecord({ ...f.record, voice });
  const unchanged = await f.plan();
  expect(unchanged.errors).toEqual([]);
  expect(unchanged.actors[0]?.restore).toBe(false);
  expect(unchanged.generateCount).toBe(0);
  const current = f.project.dialogues[0]!.nodes[1]!;
  f.project.dialogues[0]!.nodes.push({
    ...current,
    id: 'new-line',
    text: '[laughs] Kábel je preč.',
  });
  const plan = await f.plan();
  expect(plan.errors).toEqual([]);
  expect(plan.generateCount).toBe(2);
  expect(plan.actors[0]?.restore).toBe(true);
  expect(plan.actors[0]?.description).toBe(description);
  expect(plan.lines[0]?.reasons).toEqual(['restored-voice']);
  expect(plan.actors[0]?.previewText.length).toBeGreaterThanOrEqual(100);
  expect(plan.actors[0]?.previewText).not.toContain('[laughs]');
  expect(plan.actors[0]?.previewText).toContain('Kábel je preč.');
});

test('designPrompt override is validated, compared separately, and cannot silently redesign active voices', async () => {
  const f = await fixture();
  const registration = await designRegistration(f.root);
  const voice: VoiceSettings = {
    ...f.voice,
    designRegistration: registration,
    designPrompt: description,
  };
  f.project.scenes[0]!.hotspots[0]!.animation.voice = voice;
  expect((await f.plan()).generateCount).toBe(0);
  f.project.scenes[0]!.hotspots[0]!.animation.voice = {
    ...voice,
    designPrompt: 'A completely different deep and booming cartoon character.',
  };
  const changed = await f.plan();
  expect(changed.lines[0]?.reasons).toContain('changed-design-prompt');
  expect(changed.errors.join(' ')).toContain('aktivního hlasu');
  expect(voiceIssue({ ...voice, designPrompt: 'short' })).toContain('20–1000');
  expect(voiceIssue({ ...voice, designPrompt: 42 })).toContain('20–1000');
  expect(voiceIssue({ ...voice, designPrompt: 'x'.repeat(1001) })).toContain(
    '20–1000',
  );
  expect(voiceIssue(voice)).toBeUndefined();
});

test('lipSyncOnly rejects required TTS without scheduling generation or restoration', async () => {
  const f = await fixture();
  f.speech.text = 'Old line';
  const plan = await f.plan({ lipSyncOnly: true });
  expect(plan.generateCount).toBe(0);
  expect(plan.characters).toBe(0);
  expect(plan.lipSyncCount).toBe(1);
  expect(plan.actors[0]?.restore).toBe(false);
  expect(plan.errors.join(' ')).toContain('vyžaduje nové TTS');
});

test('archived retirement protects stale drafts and a retired profile override restores the whole actor', async () => {
  const f = await fixture();
  const registration = await designRegistration(f.root);
  const voice: VoiceSettings = {
    ...f.voice,
    slot: 'rotating',
    designRegistration: registration,
  };
  f.project.scenes[0]!.hotspots[0]!.animation.voice = voice;
  await writeFile(
    path.join(f.root, archive, 'retirement.json'),
    JSON.stringify({
      version: 1,
      operation: 'voice-retirement',
      provider: 'elevenlabs',
      voiceId: voice.voiceId,
    }),
  );
  const unchanged = await f.plan();
  expect(unchanged.generateCount).toBe(0);
  const profile =
    'A young child with a natural, calm and clearly spoken Slovak voice.';
  f.project.scenes[0]!.hotspots[0]!.animation.voice = {
    ...voice,
    designPrompt: profile,
  };
  const plan = await f.plan();
  expect(plan.errors).toEqual([]);
  expect(plan.actors[0]?.restore).toBe(true);
  expect(plan.actors[0]?.description).toBe(profile);
  expect(plan.lines[0]?.reasons).toEqual([
    'changed-design-prompt',
    'restored-voice',
  ]);
  const lipSync = await f.plan({ lipSyncOnly: true });
  expect(lipSync.actors[0]?.restore).toBe(false);
  expect(lipSync.generateCount).toBe(0);
  expect(lipSync.errors).toHaveLength(1);
  f.project.scenes[0]!.hotspots[0]!.animation.voice = {
    ...voice,
    slot: 'static',
  };
  expect((await f.plan()).errors.join(' ')).toContain('nemá rotační slot');
});

test('restore without description or valid design provenance blocks before any generation', async () => {
  const f = await fixture();
  await writeFile(
    path.join(f.root, archive, 'retirement.json'),
    JSON.stringify({
      version: 1,
      operation: 'voice-retirement',
      provider: 'elevenlabs',
      voiceId: f.voice.voiceId,
    }),
  );
  f.project.scenes[0]!.hotspots[0]!.animation.voice = {
    ...f.voice,
    slot: 'rotating',
  };
  const plan = await f.plan({ all: true });
  expect(plan.errors.join(' ')).toContain('Obnova vyžaduje');
  const registration = await designRegistration(f.root);
  f.project.scenes[0]!.hotspots[0]!.animation.voice = {
    ...f.voice,
    slot: 'rotating',
    designRegistration: registration,
  };
  await writeFile(path.join(f.root, archive, 'preview-1.mp3'), 'broken');
  expect((await f.plan({ all: true })).errors.length).toBeGreaterThan(0);
});

test('project strict validation accepts only a valid optional Voice Design profile', async () => {
  const project: GameContent = JSON.parse(
    await readFile(
      new URL('../src/game/content/project.json', import.meta.url),
      'utf8',
    ),
  );
  const scene = project.scenes.find((entry) =>
    entry.hotspots.some((hotspot) => hotspot.animation?.voice),
  );
  const hotspot = scene!.hotspots.find((entry) => entry.animation?.voice)!;
  const withPrompt = (designPrompt: unknown) => ({
    ...project,
    scenes: project.scenes.map((entry) =>
      entry.id !== scene!.id
        ? entry
        : {
            ...entry,
            hotspots: entry.hotspots.map((object) =>
              object.id !== hotspot.id
                ? object
                : {
                    ...object,
                    animation: {
                      ...object.animation,
                      voice: { ...object.animation!.voice, designPrompt },
                    },
                  },
            ),
          },
    ),
  });
  expect(validateProject(withPrompt(description))).toEqual([]);
  expect(validateProject(withPrompt('short')).join(' ')).toContain('20–1000');
  expect(validateProject(withPrompt(42)).join(' ')).toContain('20–1000');
});

test('slot limits and shared rotating voices block the entire preflight', async () => {
  const f = await fixture();
  const content = f.project as unknown as GameContent;
  const base = content.scenes[0]!.hotspots[0]!;
  const withVoices = (voices: VoiceSettings[]) => ({
    ...content,
    scenes: [
      {
        ...content.scenes[0]!,
        hotspots: voices.map((voice, index) => ({
          ...base,
          id: index === 0 ? 'actor' : `actor-${index}`,
          animation: { voice },
        })),
      },
    ],
  });
  const fixed = await planSpeechBatch(
    f.root,
    withVoices(
      Array.from({ length: 9 }, (_, index) => ({
        ...f.voice,
        voiceId: `fixed-${index}`,
      })),
    ),
  );
  expect(fixed.errors.join(' ')).toContain('8 stálých');
  const rotating = await planSpeechBatch(
    f.root,
    withVoices(
      Array.from({ length: 3 }, (_, index) => ({
        ...f.voice,
        slot: 'rotating',
        voiceId: `rotate-${index}`,
      })),
    ),
  );
  expect(rotating.errors.join(' ')).toContain('2 aktivní');
  const shared = await planSpeechBatch(
    f.root,
    withVoices([
      { ...f.voice, slot: 'rotating' },
      { ...f.voice, slot: 'rotating' },
    ]),
  );
  expect(shared.errors.join(' ')).toContain('sdílí více postav');
  const mixed = await planSpeechBatch(
    f.root,
    withVoices([f.voice, { ...f.voice, slot: 'rotating' }]),
  );
  expect(mixed.errors.join(' ')).toContain('sdílí více postav');
});

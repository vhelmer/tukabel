import { createHash } from 'node:crypto';
import path from 'node:path';
import { voiceIssue } from '../src/game/speech.ts';
import type {
  DialogueNode,
  GameContent,
  VoiceSettings,
} from '../src/game/types.ts';
import {
  findVoiceRetirement,
  readSpeechAsset,
  validateDesignedVoice,
  waveDuration,
} from './speech.ts';

type Actor = { sceneId: string; hotspotId: string };
export interface BatchLine {
  key: string;
  dialogueId: string;
  nodeId: string;
  actor: Actor;
  text: string;
  subtitle?: string;
  voice: VoiceSettings;
  generate: boolean;
  reasons: string[];
}
export interface BatchActor {
  key: string;
  actor: Actor;
  name: string;
  voice: VoiceSettings;
  description?: string;
  previewText: string;
  restore: boolean;
  lines: BatchLine[];
}
export interface SpeechBatchPlan {
  projectId: string;
  all: boolean;
  lipSyncOnly: boolean;
  lines: BatchLine[];
  actors: BatchActor[];
  generateCount: number;
  lipSyncCount: number;
  characters: number;
  errors: string[];
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const digest = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const missing = (error: unknown) => object(error) && error.code === 'ENOENT';

/** Slot lifecycle metadata does not change the sound of an existing WAV. */
export function voiceSignature(voice: VoiceSettings): string {
  return JSON.stringify({
    voiceId: voice.voiceId,
    modelId: voice.modelId,
    stability: voice.stability,
    similarityBoost: voice.similarityBoost,
    style: voice.style,
    speed: voice.speed,
    useSpeakerBoost: voice.useSpeakerBoost,
  });
}

function previewText(lines: BatchLine[]): string {
  const text = lines
    .map((line) => line.text.replace(/\[[^\]]*\]/g, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
  if (!text) return '';
  return `${text} `
    .repeat(Math.ceil(100 / text.length))
    .trim()
    .slice(0, 1000);
}

async function lineReasons(
  root: string,
  node: DialogueNode,
  voice: VoiceSettings,
  registrationDescription?: string,
): Promise<string[]> {
  const reasons: string[] = [];
  const add = (reason: string) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  const speech = node.speech;
  if (!speech) return ['missing-audio'];
  if (speech.text !== node.text) add('changed-text');
  let bytes: Buffer;
  try {
    bytes = await readSpeechAsset(root, speech.audio, 'wav');
    waveDuration(bytes);
  } catch (error) {
    add(missing(error) ? 'missing-audio' : 'invalid-audio');
    return reasons;
  }
  let record: unknown;
  try {
    record = JSON.parse(
      (
        await readSpeechAsset(
          root,
          `${path.posix.dirname(speech.audio)}/record.json`,
          'json',
        )
      ).toString('utf8'),
    );
  } catch (error) {
    add(missing(error) ? 'unknown-voice' : 'invalid-audio');
    return reasons;
  }
  if (
    !object(record) ||
    record.audioSha256 !== digest(bytes) ||
    typeof record.duration !== 'number' ||
    !Number.isFinite(record.duration) ||
    Math.abs(record.duration - waveDuration(bytes)) > 0.1
  ) {
    add('invalid-audio');
    return reasons;
  }
  if (record.text !== node.text) add('changed-text');
  if (
    record.provider !== 'elevenlabs' ||
    !object(record.voice) ||
    voiceIssue(record.voice)
  ) {
    add('unknown-voice');
    return reasons;
  }
  const archivedVoice = record.voice as unknown as VoiceSettings;
  if (voiceSignature(archivedVoice) !== voiceSignature(voice))
    add('changed-voice');
  if (
    voice.designPrompt !== undefined &&
    voice.designPrompt !==
      (archivedVoice.designPrompt ?? registrationDescription)
  )
    add('changed-design-prompt');
  return reasons;
}

/** Read-only local preflight. Planning never generates audio or changes a voice. */
export async function planSpeechBatch(
  assetsRoot: string,
  project: GameContent,
  options: { all?: boolean; lipSyncOnly?: boolean } = {},
): Promise<SpeechBatchPlan> {
  const all = options.all === true;
  const lipSyncOnly = options.lipSyncOnly === true;
  const errors: string[] = [];
  const lines: BatchLine[] = [];
  const actors: BatchActor[] = [];
  const assigned = new Map<string, BatchActor>();
  const retired = new Map<string, boolean>();
  const description = new Map<string, string>();
  const staticIds = new Set<string>();
  const activeRotatingIds = new Set<string>();
  const rotatingOwners = new Map<string, string[]>();
  const allOwners = new Map<string, string[]>();

  for (const scene of project.scenes)
    for (const hotspot of scene.hotspots) {
      const voice = hotspot.animation?.voice;
      if (!voice) continue;
      const key = `${scene.id}/${hotspot.id}`;
      const actor: BatchActor = {
        key,
        actor: { sceneId: scene.id, hotspotId: hotspot.id },
        name: hotspot.label,
        voice,
        previewText: '',
        restore: false,
        lines: [],
      };
      assigned.set(key, actor);
      const owners = allOwners.get(voice.voiceId) ?? [];
      owners.push(key);
      allOwners.set(voice.voiceId, owners);
      const issue = voiceIssue(voice);
      if (issue) errors.push(`${key}: ${issue}`);
      let isRetired = voice.retired === true;
      try {
        isRetired ||= !!(await findVoiceRetirement(assetsRoot, voice.voiceId));
        await validateDesignedVoice(assetsRoot, voice);
        if (voice.designRegistration) {
          const registration: unknown = JSON.parse(
            (
              await readSpeechAsset(
                assetsRoot,
                voice.designRegistration,
                'json',
              )
            ).toString('utf8'),
          );
          if (
            object(registration) &&
            typeof registration.description === 'string' &&
            registration.description.trim().length >= 20 &&
            registration.description.length <= 1000
          )
            description.set(key, registration.description);
        }
      } catch (error) {
        errors.push(
          `${key}: ${error instanceof Error ? error.message : 'Neplatný archiv hlasu.'}`,
        );
      }
      retired.set(key, isRetired);
      actor.description = voice.designPrompt ?? description.get(key);
      if (
        !isRetired &&
        voice.designPrompt !== undefined &&
        voice.designPrompt !== description.get(key)
      )
        errors.push(
          `${key}: Zadání aktivního hlasu se změnilo. Nejprve výslovně vytvoř a přiřaď nový Voice Design.`,
        );
      if (voice.slot === 'static') staticIds.add(voice.voiceId);
      if (voice.slot === 'rotating') {
        if (!isRetired) activeRotatingIds.add(voice.voiceId);
        const owners = rotatingOwners.get(voice.voiceId) ?? [];
        owners.push(key);
        rotatingOwners.set(voice.voiceId, owners);
      }
      if (isRetired && voice.slot !== 'rotating')
        errors.push(`${key}: Uvolněný hlas nemá rotační slot.`);
    }

  if (staticIds.size > 8) errors.push('Projekt překračuje 8 stálých hlasů.');
  if (activeRotatingIds.size > 2)
    errors.push('Projekt překračuje 2 aktivní rotační hlasy.');
  for (const voiceId of rotatingOwners.keys()) {
    const owners = allOwners.get(voiceId)!;
    if (owners.length > 1)
      errors.push(
        `Rotační hlas sdílí více postav (${owners.join(', ')}). Před dávkou jim přiřaď samostatné hlasy.`,
      );
  }

  for (const dialogue of project.dialogues) {
    const incoming = new Set(
      dialogue.nodes.flatMap((node) =>
        node.choices.flatMap((choice) => (choice.next ? [choice.next] : [])),
      ),
    );
    for (const node of dialogue.nodes) {
      if (!node.actor) continue;
      if (
        dialogue.entry !== 'speech' &&
        node.id === dialogue.start &&
        node.choices.some((choice) => choice.next) &&
        !incoming.has(node.id)
      )
        continue;
      const actorKey = `${node.actor.sceneId}/${node.actor.hotspotId}`;
      const actor = assigned.get(actorKey);
      if (!actor) {
        errors.push(`${dialogue.id}/${node.id}: Postava nemá přiřazený hlas.`);
        continue;
      }
      const reasons = await lineReasons(
        assetsRoot,
        node,
        actor.voice,
        description.get(actorKey),
      );
      if (all) reasons.push('all');
      const line: BatchLine = {
        key: `${dialogue.id}/${node.id}`,
        dialogueId: dialogue.id,
        nodeId: node.id,
        actor: node.actor,
        text: node.text,
        ...(node.subtitle === undefined ? {} : { subtitle: node.subtitle }),
        voice: actor.voice,
        generate: reasons.length > 0,
        reasons,
      };
      actor.lines.push(line);
      lines.push(line);
    }
  }

  for (const actor of assigned.values()) {
    if (!actor.lines.length) continue;
    actors.push(actor);
    actor.previewText = previewText(actor.lines);
    if (retired.get(actor.key) && actor.lines.some((line) => line.generate)) {
      if (!lipSyncOnly) {
        actor.restore = true;
        if (!actor.description || actor.voice.slot !== 'rotating')
          errors.push(
            `${actor.key}: Obnova vyžaduje rotační slot a platné zadání Voice Design z registrace nebo designPrompt.`,
          );
        for (const line of actor.lines) {
          line.generate = true;
          if (!line.reasons.includes('restored-voice'))
            line.reasons.push('restored-voice');
        }
      }
    }
    if (lipSyncOnly)
      for (const line of actor.lines) {
        if (line.generate)
          errors.push(
            `${line.key}: Replika vyžaduje nové TTS (${line.reasons.join(', ')}); samotný lip-sync nelze obnovit.`,
          );
        line.generate = false;
      }
  }
  return {
    projectId: project.id,
    all,
    lipSyncOnly,
    lines,
    actors,
    generateCount: lines.filter((line) => line.generate).length,
    lipSyncCount: lines.length,
    characters: lines
      .filter((line) => line.generate)
      .reduce((count, line) => count + line.text.length, 0),
    errors,
  };
}

import { createHash } from 'node:crypto';
import { realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { lipSyncIssue, voiceIssue } from '../src/game/speech.ts';
import { subtitleText, subtitleTrackIssue } from '../src/game/subtitles.ts';
import type {
  GameContent,
  LipSyncTrack,
  VoiceSettings,
} from '../src/game/types.ts';
import {
  publishSpeechArchive,
  findVoiceRetirement,
  readSpeechAsset,
  validateDesignedVoice,
  validateSpeechAssets,
  waveDuration,
  type SpeechOptions,
} from './speech.ts';

const sha256 = (bytes: Buffer | string) =>
  createHash('sha256').update(bytes).digest('hex');
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Only PCM samples, never WAV headers, can demonstrate a non-silent line. */
function signalLevels(bytes: Buffer) {
  let count = 0,
    sum = 0,
    peak = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4),
      start = offset + 8;
    if (bytes.toString('ascii', offset, offset + 4) === 'data')
      for (let i = start; i + 1 < start + length; i += 2) {
        const sample = bytes.readInt16LE(i);
        count++;
        sum += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
    offset = start + length + (length % 2);
  }
  return { rms: Math.sqrt(sum / count), peak };
}

class VoiceDeletionRejected extends Error {}

async function deleteVoice(voiceId: string, options: SpeechOptions) {
  if (!options.apiKey)
    throw new Error('Nastav ELEVENLABS_API_KEY v .env.local a restartuj Vite.');
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(
      `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`,
      {
        method: 'DELETE',
        headers: { 'xi-api-key': options.apiKey },
        signal: AbortSignal.timeout(120000),
      },
    );
  } catch {
    throw new Error(
      'ElevenLabs je nedostupný. Uvolnění se automaticky neopakuje; ověř stav hlasu před dalším spuštěním.',
    );
  }
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const code =
      object(data) && object(data.detail) ? data.detail.status : undefined;
    let explanation =
      'Zkontroluj hlas a oprávnění Voices: Write (voices_write).';
    if (
      code === 'missing_permissions' ||
      code === 'insufficient_permissions' ||
      response.status === 403
    )
      explanation = 'Klíči chybí oprávnění Voices: Write (voices_write).';
    else if (code === 'invalid_api_key' || response.status === 401)
      explanation = 'API klíč je neplatný nebo nemá potřebná oprávnění.';
    else if (code === 'quota_exceeded')
      explanation = 'Byl překročený kreditní limit účtu nebo API klíče.';
    else if (response.status === 404)
      explanation = 'Hlas nebyl nalezen. Ověř stav účtu ručně.';
    const message = `ElevenLabs HTTP ${response.status}: ${explanation} Uvolnění se neopakuje.`;
    if (response.status < 500) throw new VoiceDeletionRejected(message);
    throw new Error(message);
  }
}

export interface VoiceRetirementResult {
  readonly voice: VoiceSettings;
  readonly voiceId: string;
  readonly manifest: string;
  readonly verifiedLines: number;
}

/** Explicitly release a designed rotating voice only after all its played lines are local and verified. */
async function retireVerifiedVoice(
  assetsRoot: string,
  project: GameContent,
  input: { sceneId: string; hotspotId: string; confirmed: true },
  options: SpeechOptions,
): Promise<VoiceRetirementResult> {
  if (!input || input.confirmed !== true)
    throw new Error('Uvolnění hlasu vyžaduje výslovné potvrzení.');
  const actor = project.scenes
    .find((scene) => scene.id === input.sceneId)
    ?.hotspots.find((hotspot) => hotspot.id === input.hotspotId);
  const voice = actor?.animation?.voice;
  if (!voice) throw new Error('Postava nemá přiřazený hlas.');
  if (voice.retired || voice.retirementManifest)
    throw new Error('Hlas už byl uvolněn.');
  if (voice.slot !== 'rotating')
    throw new Error('Statický nebo neoznačený hlas nelze uvolnit.');
  const issue = voiceIssue(voice);
  if (issue) throw new Error(issue);
  if (!voice.designRegistration)
    throw new Error('Uvolnit lze pouze vlastní archivovaný Voice Design.');
  await validateDesignedVoice(assetsRoot, voice);
  if (await findVoiceRetirement(assetsRoot, voice.voiceId))
    throw new Error('Hlas už má archivované uvolnění.');
  const registrationBytes = await readSpeechAsset(
    assetsRoot,
    voice.designRegistration,
    'json',
  );
  const registration: unknown = JSON.parse(registrationBytes.toString('utf8'));
  // validateDesignedVoice has bound this immutable registration to the selected ID.
  if (!object(registration) || registration.voiceId !== voice.voiceId)
    throw new Error('Neplatná registrace hlasu.');

  const actors = new Set<string>();
  for (const scene of project.scenes)
    for (const hotspot of scene.hotspots) {
      const other = hotspot.animation?.voice;
      if (other?.voiceId !== voice.voiceId) continue;
      if (
        other.slot !== 'rotating' ||
        other.retired ||
        other.designRegistration !== voice.designRegistration
      )
        throw new Error(
          'Hlas používá také statická, uvolněná nebo jinak registrovaná postava.',
        );
      actors.add(JSON.stringify([scene.id, hotspot.id]));
    }

  // Includes real WAV/alignment/lip-sync verification and all archived design provenance.
  await validateSpeechAssets(assetsRoot, project);
  const lines: Record<string, unknown>[] = [];
  for (const dialogue of project.dialogues) {
    const incoming = new Set(
      dialogue.nodes.flatMap((node) =>
        node.choices.flatMap((choice) => (choice.next ? [choice.next] : [])),
      ),
    );
    for (const node of dialogue.nodes) {
      if (
        !node.actor ||
        !actors.has(JSON.stringify([node.actor.sceneId, node.actor.hotspotId]))
      )
        continue;
      if (
        dialogue.entry !== 'speech' &&
        node.id === dialogue.start &&
        node.choices.some((choice) => choice.next) &&
        !incoming.has(node.id)
      )
        continue;
      const speech = node.speech;
      const label = `${dialogue.id}/${node.id}`;
      if (!speech || speech.text !== node.text || !speech.lipSync)
        throw new Error(`${label}: chybí aktuální WAV nebo lip-sync.`);
      const bytes = await readSpeechAsset(assetsRoot, speech.audio, 'wav');
      const duration = waveDuration(bytes),
        audioSha256 = sha256(bytes),
        levels = signalLevels(bytes);
      if (!Number.isFinite(levels.rms) || levels.rms < 8 || levels.peak < 32)
        throw new Error(`${label}: WAV neobsahuje použitelný zvuk.`);
      const lipSyncBytes = await readSpeechAsset(
        assetsRoot,
        speech.lipSync,
        'json',
      );
      const track = JSON.parse(lipSyncBytes.toString('utf8')) as LipSyncTrack;
      if (
        lipSyncIssue(track) ||
        track.metadata.audioSha256 !== audioSha256 ||
        Math.abs(track.metadata.duration - duration) > 0.1
      )
        throw new Error(`${label}: lip-sync neodpovídá ověřenému WAV.`);
      if (
        !speech.subtitles ||
        subtitleTrackIssue(speech.subtitles, duration) ||
        speech.subtitles.text !== subtitleText(node) ||
        (subtitleText(node) && !speech.subtitles.cues.length)
      )
        throw new Error(`${label}: chybí platné aktuální titulky.`);
      const recordPath = `${path.posix.dirname(speech.audio)}/record.json`;
      const recordBytes = await readSpeechAsset(assetsRoot, recordPath, 'json');
      const record: unknown = JSON.parse(recordBytes.toString('utf8'));
      if (
        !object(record) ||
        record.provider !== 'elevenlabs' ||
        !object(record.voice) ||
        record.voice.voiceId !== voice.voiceId ||
        record.voice.designRegistration !== voice.designRegistration ||
        record.text !== node.text ||
        record.audioSha256 !== audioSha256 ||
        typeof record.duration !== 'number' ||
        Math.abs(record.duration - duration) > 0.1
      )
        throw new Error(
          `${label}: archiv nahrávky nedokládá aktuální vlastní hlas a WAV.`,
        );
      lines.push({
        dialogueId: dialogue.id,
        nodeId: node.id,
        actor: node.actor,
        text: node.text,
        textSha256: sha256(node.text),
        audio: speech.audio,
        audioSha256,
        duration,
        ...levels,
        lipSync: speech.lipSync,
        lipSyncSha256: sha256(lipSyncBytes),
        subtitles: speech.subtitles,
        record: recordPath,
        recordSha256: sha256(recordBytes),
        ...(speech.alignment ? { alignment: speech.alignment } : {}),
      });
    }
  }
  if (!lines.length)
    throw new Error('Hlas nemá žádnou ověřenou hranou repliku.');
  if (!options.apiKey)
    throw new Error('Nastav ELEVENLABS_API_KEY v .env.local a restartuj Vite.');

  // Persist complete proof before the irreversible provider request. Failed or
  // ambiguous requests retain this evidence; there is deliberately no retry.
  const proof = {
    version: 1,
    operation: 'voice-retirement-verification',
    provider: 'elevenlabs',
    verifiedAt: new Date().toISOString(),
    projectId: project.id,
    actor: { sceneId: input.sceneId, hotspotId: input.hotspotId },
    voiceId: voice.voiceId,
    designRegistration: voice.designRegistration,
    registrationSha256: sha256(registrationBytes),
    registration,
    lines,
  };
  const proofText = JSON.stringify(proof);
  const directory = await publishSpeechArchive(assetsRoot, {
    'verification.json': proofText,
  });
  const manifest = `${directory}/retirement.json`;
  // Prepare the receipt before deletion so the only remaining local operation is
  // an atomic rename in the already verified private archive directory.
  const receipt = {
    version: 1,
    operation: 'voice-retirement',
    provider: 'elevenlabs',
    voiceId: voice.voiceId,
    designRegistration: voice.designRegistration,
    verification: `${directory}/verification.json`,
    verificationSha256: sha256(
      await readSpeechAsset(
        assetsRoot,
        `${directory}/verification.json`,
        'json',
      ),
    ),
    verifiedLines: lines.length,
    deleteRequestedAt: new Date().toISOString(),
  };
  const pending = path.join(assetsRoot, directory, '.retirement.pending.json');
  await writeFile(pending, JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx',
  });
  try {
    await deleteVoice(voice.voiceId, options);
  } catch (error) {
    // A timeout or server error can happen after the remote deletion. Retain
    // the pending receipt so a stale draft cannot retry or generate new TTS.
    if (error instanceof VoiceDeletionRejected)
      await rm(pending, { force: true });
    throw error;
  }
  await rename(pending, path.join(assetsRoot, manifest));
  return {
    voice: { ...voice, retired: true, retirementManifest: manifest },
    voiceId: voice.voiceId,
    manifest,
    verifiedLines: lines.length,
  };
}

const runningRetirements = new Set<string>();
const completedRetirements = new Set<string>();
export async function retireDesignedVoice(
  assetsRoot: string,
  project: GameContent,
  input: { sceneId: string; hotspotId: string; confirmed: true },
  options: SpeechOptions,
): Promise<VoiceRetirementResult> {
  const voiceId = project.scenes
    .find((scene) => scene.id === input?.sceneId)
    ?.hotspots.find((hotspot) => hotspot.id === input?.hotspotId)?.animation
    ?.voice?.voiceId;
  const key = JSON.stringify([await realpath(assetsRoot), voiceId]);
  if (runningRetirements.has(key) || completedRetirements.has(key))
    throw new Error('Uvolnění stejného hlasu už běží nebo bylo dokončeno.');
  runningRetirements.add(key);
  try {
    const result = await retireVerifiedVoice(
      assetsRoot,
      project,
      input,
      options,
    );
    completedRetirements.add(key);
    return result;
  } finally {
    runningRetirements.delete(key);
  }
}

import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type {
  DialogueNode,
  DialogueSpeech,
  GameContent,
  VoiceSettings,
} from '../src/game/types.ts';
import type {
  SavedDesignVoice,
  VoiceDesignResult,
} from '../src/editor/voiceDesign.ts';
import type { VoiceRetirementResult } from './voiceRotation.ts';
import {
  alignmentIssue,
  buildSubtitles,
  subtitleText,
} from '../src/game/subtitles.ts';
import { lipSyncIssue } from '../src/game/speech.ts';
import { readSpeechAsset, waveDuration } from './speech.ts';
import {
  planSpeechBatch,
  type BatchActor,
  type SpeechBatchPlan,
} from './speechBatchPlan.ts';

export interface SpeechBatchClient {
  readProject(): Promise<{ content: GameContent; revision: string }>;
  writeProject(content: GameContent, revision: string): Promise<unknown>;
  generate(input: {
    text: string;
    subtitle?: string;
    voice: VoiceSettings;
    languageCode?: string;
    confirmed: true;
  }): Promise<DialogueSpeech>;
  analyze(audio: string): Promise<{ lipSync: string }>;
  design(input: {
    description: string;
    text: string;
    confirmed: true;
  }): Promise<VoiceDesignResult>;
  register(input: {
    manifest: string;
    previewIndex: number;
    generatedVoiceId: string;
    name: string;
    confirmed: true;
  }): Promise<SavedDesignVoice>;
  retire(input: {
    sceneId: string;
    hotspotId: string;
    expectedVoice: VoiceSettings;
    confirmed: true;
  }): Promise<VoiceRetirementResult>;
  status(): Promise<{ elevenLabs: boolean; rhubarb: boolean }>;
  catalog(): Promise<{
    models: {
      id: string;
      languages: string[];
      maxCharacters?: number | null;
    }[];
  }>;
}
export interface SpeechBatchOptions {
  confirmed: boolean;
  all?: boolean;
  lipSyncOnly?: boolean;
  resume?: string;
  retryFailed?: boolean;
  previewIndex?: number;
  progress?: (message: string) => void;
  shouldStop?: () => boolean;
}
interface Step {
  hash: string;
  status: 'started' | 'done' | 'failed';
  result?: unknown;
  error?: string;
}
interface Journal {
  version: 1;
  id: string;
  status: 'running' | 'failed' | 'complete' | 'abandoned';
  plan: SpeechBatchPlan;
  expected: GameContent;
  previewIndex: number;
  steps: Record<string, Step>;
  pendingApply?: {
    actorKey: string;
    voice: VoiceSettings;
    speeches: Record<string, DialogueSpeech>;
  };
  error?: string;
}
const digest = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
async function readJournal(parent: string, id: string): Promise<Journal> {
  if (!uuid.test(id)) throw new Error('Neplatné ID dávky.');
  const directory = path.join(parent, id);
  const file = path.join(directory, 'state.json');
  const stat = await lstat(file);
  if (
    (await lstat(directory)).isSymbolicLink() ||
    !stat.isFile() ||
    stat.isSymbolicLink()
  )
    throw new Error('Archiv dávky musí být běžný místní soubor.');
  let journal: Journal;
  try {
    journal = JSON.parse(await readFile(file, 'utf8')) as Journal;
  } catch {
    throw new Error('Poškozený archiv dávky.');
  }
  if (
    journal.version !== 1 ||
    journal.id !== id ||
    !journal.plan ||
    !journal.expected ||
    !journal.steps ||
    !['running', 'failed', 'complete', 'abandoned'].includes(journal.status)
  )
    throw new Error('Poškozený archiv dávky.');
  return journal;
}

/** Close a stopped plan without touching the project or any provider. */
export async function abandonSpeechBatch(root: string, id: string) {
  const parent = path.join(root, '.local-tools', 'speech-batches');
  if (
    (await realpath(parent)) !==
    path.join(await realpath(root), '.local-tools', 'speech-batches')
  )
    throw new Error('Složka dávek nesmí být symlink.');
  try {
    await lstat(path.join(parent, '.lock'));
    throw new Error('Nejprve ukonči běžící dávku a zkontroluj její zámek.');
  } catch (error) {
    if (!(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ))
      throw error;
  }
  const journal = await readJournal(parent, id);
  journal.status = 'abandoned';
  const temporary = path.join(parent, id, `${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(journal, null, 2) + '\n', {
    flag: 'wx',
  });
  await rename(temporary, path.join(parent, id, 'state.json'));
}
const actorOf = (p: GameContent, actor: BatchActor) =>
  p.scenes
    .find((s) => s.id === actor.actor.sceneId)
    ?.hotspots.find((h) => h.id === actor.actor.hotspotId);
const nodeOf = (p: GameContent, dialogueId: string, nodeId: string) =>
  p.dialogues
    .find((d) => d.id === dialogueId)
    ?.nodes.find((n) => n.id === nodeId);
const nodeTarget = (n: DialogueNode | undefined) =>
  n && { text: n.text, subtitle: n.subtitle, actor: n.actor, speech: n.speech };

function assertTarget(
  current: GameContent,
  expected: GameContent,
  actor: BatchActor,
) {
  if (current.id !== expected.id)
    throw new Error(
      'Projekt se během dávky změnil. Výsledky jsou uložené, projekt se nepřepíše.',
    );
  if (
    !same(
      actorOf(current, actor)?.animation?.voice,
      actorOf(expected, actor)?.animation?.voice,
    )
  )
    throw new Error(
      `${actor.name}: Hlas byl mezitím upraven. Obnov návrh nebo použij uložené výsledky ručně.`,
    );
  const keys = (p: GameContent) =>
    p.dialogues
      .flatMap((d) =>
        d.nodes
          .filter(
            (n) =>
              n.actor?.sceneId === actor.actor.sceneId &&
              n.actor.hotspotId === actor.actor.hotspotId,
          )
          .map((n) => `${d.id}/${n.id}`),
      )
      .sort();
  if (!same(keys(current), keys(expected)))
    throw new Error(`${actor.name}: Během dávky se změnil seznam replik.`);
  for (const line of actor.lines)
    if (
      !same(
        nodeTarget(nodeOf(current, line.dialogueId, line.nodeId)),
        nodeTarget(nodeOf(expected, line.dialogueId, line.nodeId)),
      )
    )
      throw new Error(
        `${line.key}: Replika byla mezitím upravena. Uložené výsledky ji nepřepíší.`,
      );
}

function applyActor(
  project: GameContent,
  actor: BatchActor,
  voice: VoiceSettings,
  speeches: Map<string, DialogueSpeech>,
): GameContent {
  return {
    ...project,
    scenes: project.scenes.map((s) =>
      s.id !== actor.actor.sceneId
        ? s
        : {
            ...s,
            hotspots: s.hotspots.map((h) =>
              h.id !== actor.actor.hotspotId
                ? h
                : { ...h, animation: { ...h.animation, voice } },
            ),
          },
    ),
    dialogues: project.dialogues.map((d) => ({
      ...d,
      nodes: d.nodes.map((n) => {
        const speech = speeches.get(`${d.id}/${n.id}`);
        return speech ? { ...n, speech } : n;
      }),
    })),
  };
}

async function retime(
  assetsRoot: string,
  node: DialogueNode,
  speech: DialogueSpeech,
): Promise<DialogueSpeech> {
  const bytes = await readSpeechAsset(assetsRoot, speech.audio, 'wav');
  const duration = waveDuration(bytes);
  const track = JSON.parse(
    (await readSpeechAsset(assetsRoot, speech.lipSync, 'json')).toString(
      'utf8',
    ),
  );
  const problem = lipSyncIssue(track);
  if (
    problem ||
    track.metadata.audioSha256 !== digest(bytes) ||
    Math.abs(track.metadata.duration - duration) > 0.1
  )
    throw new Error('Nový lip-sync neodpovídá WAV; hlas se neuvolní.');
  let alignment;
  if (speech.alignment) {
    const value = JSON.parse(
      (await readSpeechAsset(assetsRoot, speech.alignment, 'json')).toString(
        'utf8',
      ),
    );
    if (
      alignmentIssue(value) ||
      value.metadata.audioSha256 !== digest(bytes) ||
      Math.abs(value.metadata.duration - duration) > 0.1
    )
      throw new Error('Zarovnání neodpovídá WAV.');
    alignment = value;
  }
  return {
    ...speech,
    subtitles: buildSubtitles(subtitleText(node), duration, alignment),
  };
}

/** Explicit local batch; all project writes go through the existing editor API. */
export async function runSpeechBatch(
  root: string,
  client: SpeechBatchClient,
  options: SpeechBatchOptions,
) {
  if (!options.confirmed)
    throw new Error(
      'Pro placené generování použij --confirm. Bez něj spusť pouze náhled.',
    );
  if (options.resume && !uuid.test(options.resume))
    throw new Error('--resume vyžaduje ID dávky (UUID).');
  const parent = path.join(root, '.local-tools', 'speech-batches');
  await mkdir(parent, { recursive: true });
  if (
    (await realpath(parent)) !==
    path.join(await realpath(root), '.local-tools', 'speech-batches')
  )
    throw new Error('Složka dávek nesmí být symlink.');
  const lock = path.join(parent, '.lock');
  const id = options.resume ?? randomUUID();
  let ownsLock = false;
  let journal: Journal | undefined;
  let directory = '';
  const flush = async () => {
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(journal, null, 2) + '\n', {
      flag: 'wx',
    });
    await rename(temporary, path.join(directory, 'state.json'));
  };
  try {
    try {
      await writeFile(lock, JSON.stringify({ pid: process.pid, id }), {
        flag: 'wx',
      });
    } catch (error) {
      if (!(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'EEXIST'
      ))
        throw error;
      const previous = JSON.parse(await readFile(lock, 'utf8'));
      if (!Number.isSafeInteger(previous.pid) || previous.pid < 1)
        throw new Error(
          'Neplatný zámek dávky; zkontroluj .local-tools/speech-batches/.lock.',
          { cause: error },
        );
      let dead = false;
      try {
        process.kill(previous.pid, 0);
      } catch (e) {
        dead = Boolean(
          e && typeof e === 'object' && 'code' in e && e.code === 'ESRCH',
        );
      }
      if (!dead)
        throw new Error('Jiná dávka dabingu už běží.', { cause: error });
      await unlink(lock);
      await writeFile(lock, JSON.stringify({ pid: process.pid, id }), {
        flag: 'wx',
      });
    }
    ownsLock = true;
    if (options.resume) {
      directory = path.join(parent, id);
      journal = await readJournal(parent, id);
      if (journal.status === 'abandoned')
        throw new Error('Tato dávka byla opuštěna. Spusť nový náhled.');
      if (journal.status === 'complete')
        return { id, plan: journal.plan, complete: true };
    } else {
      const current = await client.readProject();
      for (const entry of await readdir(parent, { withFileTypes: true })) {
        if (!entry.isDirectory() || !uuid.test(entry.name)) continue;
        const other = await readJournal(parent, entry.name);
        if (
          other.status !== 'complete' &&
          other.status !== 'abandoned' &&
          other.plan.projectId === current.content.id
        )
          throw new Error(
            `Existuje nedokončená dávka ${entry.name}. Pokračuj přes --resume ${entry.name}, aby se hotové TTS neplatilo znovu.`,
          );
      }
      const plan = await planSpeechBatch(
        path.join(root, 'src/assets'),
        current.content,
        options,
      );
      if (plan.errors.length) throw new Error(plan.errors.join('\n'));
      const previewIndex = options.previewIndex ?? 0;
      if (
        !Number.isInteger(previewIndex) ||
        previewIndex < 0 ||
        previewIndex > 2
      )
        throw new Error('Vyber ukázku Voice Design 1–3.');
      journal = {
        version: 1,
        id,
        status: 'running',
        plan,
        expected: current.content,
        previewIndex,
        steps: {},
      };
      directory = path.join(parent, id);
      await mkdir(directory);
      await flush();
    }
    const state = journal;
    const assetsRoot = path.join(root, 'src/assets');
    const status = await client.status();
    if (!status.rhubarb)
      throw new Error(
        'Rhubarb není dostupný. Nastav RHUBARB_BIN nebo --rhubarb /cesta/rhubarb; žádné TTS se nespustilo.',
      );
    if (state.plan.generateCount && !status.elevenLabs)
      throw new Error('Chybí ELEVENLABS_API_KEY; žádné TTS se nespustilo.');
    if (state.plan.generateCount) {
      const catalog = await client.catalog();
      for (const line of state.plan.lines.filter((entry) => entry.generate)) {
        const model = catalog.models.find(
          (entry) => entry.id === line.voice.modelId,
        );
        if (!model)
          throw new Error(
            `${line.key}: Model ${line.voice.modelId} není dostupný pro TTS; žádné placené generování se nespustilo.`,
          );
        if (!model.languages.includes('sk'))
          throw new Error(
            `${line.key}: Model neuvádí slovenštinu; žádné placené generování se nespustilo.`,
          );
        const limit = Math.min(5000, model.maxCharacters ?? 5000);
        if (!line.text.trim() || line.text.length > limit)
          throw new Error(
            `${line.key}: Replika musí mít 1–${limit} znaků; žádné placené generování se nespustilo.`,
          );
      }
    }
    options.progress?.(
      `Dávka ${id}: ${state.plan.generateCount} TTS, ${state.plan.lipSyncCount} lip-sync, ${state.plan.characters} znaků.`,
    );
    state.status = 'running';
    delete state.error;
    await flush();
    async function step<T>(
      key: string,
      input: unknown,
      task: () => Promise<T>,
    ): Promise<T> {
      if (options.shouldStop?.())
        throw new Error(
          'Dávka byla přerušena na bezpečné hranici. Pokračuj přes --resume.',
        );
      const hash = digest(JSON.stringify(input));
      const old = state.steps[key];
      if (old && old.hash !== hash)
        throw new Error(
          `${key}: Zachycené zadání se změnilo; nebudu opakovat požadavek.`,
        );
      if (old?.status === 'done') return old.result as T;
      if (old && !options.retryFailed)
        throw new Error(
          `${key}: Předchozí požadavek nemá potvrzený výsledek. Ověř archiv/účet; opakování vyžaduje výslovné --retry-failed.`,
        );
      state.steps[key] = { hash, status: 'started' };
      await flush();
      try {
        const result = await task();
        state.steps[key] = { hash, status: 'done', result };
        await flush();
        return result;
      } catch (e) {
        state.steps[key] = {
          hash,
          status: 'failed',
          error: e instanceof Error ? e.message : 'Úloha selhala.',
        };
        await flush();
        throw e;
      }
    }
    async function finishPendingApply() {
      const pending = state.pendingApply;
      if (!pending) return;
      const actor = state.plan.actors.find(
        (entry) => entry.key === pending.actorKey,
      );
      if (!actor)
        throw new Error('Archiv zápisu odkazuje na neznámou postavu.');
      const speeches = new Map(Object.entries(pending.speeches));
      const after = applyActor(state.expected, actor, pending.voice, speeches);
      const current = await client.readProject();
      let alreadyApplied = false;
      try {
        assertTarget(current.content, after, actor);
        alreadyApplied = true;
      } catch {
        // Only the exact original target can be retried; unrelated edits survive.
        assertTarget(current.content, state.expected, actor);
      }
      if (!alreadyApplied)
        await client.writeProject(
          applyActor(current.content, actor, pending.voice, speeches),
          current.revision,
        );
      state.expected = after;
      delete state.pendingApply;
      await flush();
    }
    async function persist(
      actor: BatchActor,
      voice: VoiceSettings,
      speeches: Map<string, DialogueSpeech>,
    ) {
      const current = await client.readProject();
      assertTarget(current.content, state.expected, actor);
      // Record both sides before PUT: its response may be lost after the save.
      state.pendingApply = {
        actorKey: actor.key,
        voice,
        speeches: Object.fromEntries(speeches),
      };
      await flush();
      await finishPendingApply();
    }
    await finishPendingApply();
    const actors = [...state.plan.actors].sort((a, b) => {
      const priority = (actor: BatchActor) =>
        actor.voice.slot === 'static'
          ? 0
          : !actor.restore
            ? 1
            : actor.voice.designPrompt
              ? 3
              : 2;
      return priority(a) - priority(b);
    });
    const needsRestore = actors.some((a) => a.restore);
    for (const actor of actors) {
      if (state.steps[`actor:${actor.key}:complete`]?.status === 'done')
        continue;
      const current = await client.readProject();
      assertTarget(current.content, state.expected, actor);
      options.progress?.(
        `${actor.name}: ${actor.lines.filter((l) => l.generate).length} nových nahrávek, ${actor.lines.length} lip-sync.`,
      );
      let voice = actor.voice;
      if (actor.restore) {
        const registrationKey = `register:${actor.key}`;
        const saved = state.steps[registrationKey];
        // A completed registration already has a real slot; never register it twice.
        if (!saved || saved.status !== 'done') {
          const voices = current.content.scenes.flatMap((s) =>
            s.hotspots.flatMap((h) =>
              h.animation?.voice ? [h.animation.voice] : [],
            ),
          );
          const rotating = new Set(
            voices
              .filter((v) => v.slot === 'rotating' && !v.retired)
              .map((v) => v.voiceId),
          );
          const owned = new Set(
            voices
              .filter(
                (v) =>
                  v.slot === 'static' || (v.slot === 'rotating' && !v.retired),
              )
              .map((v) => v.voiceId),
          );
          if (rotating.size >= 2 || owned.size >= 10)
            throw new Error(
              'Oba rotační sloty jsou obsazené. Žádný další návrh se nevygeneroval.',
            );
        }
        const designed = await step(
          `design:${actor.key}`,
          { description: actor.description, text: actor.previewText },
          () =>
            client.design({
              description: actor.description!,
              text: actor.previewText,
              confirmed: true,
            }),
        );
        const selected = designed.previews[state.previewIndex];
        if (!selected)
          throw new Error('Voice Design nevrátil vybranou ukázku.');
        const registration = await step(
          registrationKey,
          { manifest: designed.manifest, index: state.previewIndex },
          () =>
            client.register({
              manifest: designed.manifest,
              previewIndex: state.previewIndex,
              generatedVoiceId: selected.generatedVoiceId,
              name: `TUKABEL · ${actor.name}`.slice(0, 100),
              confirmed: true,
            }),
        );
        voice = {
          ...actor.voice,
          voiceId: registration.voiceId,
          designRegistration: registration.manifest,
          retired: undefined,
          retirementManifest: undefined,
        };
      }
      const speeches = new Map<string, DialogueSpeech>();
      for (const line of actor.lines) {
        let speech = nodeOf(
          state.expected,
          line.dialogueId,
          line.nodeId,
        )?.speech;
        if (line.generate) {
          const input = {
            text: line.text,
            subtitle: line.subtitle,
            voice,
            ...(voice.modelId === 'eleven_multilingual_v2'
              ? {}
              : { languageCode: 'sk' }),
            confirmed: true as const,
          };
          speech = await step(`tts:${line.key}`, input, () =>
            client.generate(input),
          );
        }
        if (!speech) throw new Error(`${line.key}: Chybí WAV pro lip-sync.`);
        const lip = await step(
          `lipsync:${line.key}`,
          { audio: speech.audio },
          () => client.analyze(speech!.audio),
        );
        speech = await retime(
          assetsRoot,
          {
            ...nodeOf(state.expected, line.dialogueId, line.nodeId)!,
            text: line.text,
            subtitle: line.subtitle,
          },
          { ...speech, lipSync: lip.lipSync },
        );
        speeches.set(line.key, speech);
      }
      // Persist before retirement: the guarded endpoint reads the saved project.
      if (!state.steps[`apply:${actor.key}`]) {
        await persist(actor, voice, speeches);
        state.steps[`apply:${actor.key}`] = { hash: 'saved', status: 'done' };
        await flush();
      }
      const shouldRetire =
        !state.plan.lipSyncOnly &&
        voice.slot === 'rotating' &&
        !voice.retired &&
        (actor.lines.some((l) => l.generate) || needsRestore);
      if (shouldRetire) {
        const input = {
          ...actor.actor,
          expectedVoice: voice,
          confirmed: true as const,
        };
        const result = await step(`retire:${actor.key}`, input, () =>
          client.retire(input),
        );
        await persist(actor, result.voice, speeches);
      }
      state.steps[`actor:${actor.key}:complete`] = {
        hash: 'complete',
        status: 'done',
      };
      await flush();
    }
    state.status = 'complete';
    await flush();
    options.progress?.(
      `Hotovo: ${state.plan.lipSyncCount} aktuálních lip-sync. Evidence: ${path.relative(root, directory)}/state.json`,
    );
    return { id, plan: state.plan, complete: true };
  } catch (e) {
    if (journal) {
      journal.status = 'failed';
      journal.error = e instanceof Error ? e.message : 'Dávka selhala.';
      await flush();
    }
    throw e;
  } finally {
    if (ownsLock) await unlink(lock).catch(() => {});
  }
}

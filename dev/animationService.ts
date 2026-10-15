import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  lstat,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { format } from 'prettier';
import type {
  AnimationJob,
  GenerationRequest,
  SourceInfo,
  VideoProcessing,
} from '../src/editor/animationTypes.ts';
import {
  extractFrames,
  normalizeSource,
  processorAvailable,
  validateGenerationRequest,
  validateProcessing,
  videoPrompt,
} from './animationVideo.ts';
import type { VideoGenerator } from './falVideo.ts';
import { VIDEO_MODEL } from './falVideo.ts';

export class AnimationError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}
const hash = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown) =>
  format(JSON.stringify(value), {
    parser: 'json',
    singleQuote: true,
    printWidth: 80,
    tabWidth: 2,
    useTabs: false,
  });
export function createAnimationService(
  assetsRoot: string,
  generator?: VideoGenerator,
  onPublished: () => void = () => {},
) {
  let preparing = false;
  let processing = false;
  const jobs = new Map<
    string,
    { job: AnimationJob; controller: AbortController }
  >();
  async function source(
    id: string,
    background: GenerationRequest['background'] = 'keep',
  ) {
    if (!/^[a-zA-Z0-9_/-]+\.(png|webp|svg)$/.test(id) || id.includes('..'))
      throw new AnimationError('Vyber lokálny PNG/WebP/SVG asset.');
    const file = await realpath(path.join(assetsRoot, id));
    const root = await realpath(assetsRoot);
    if (!file.startsWith(root + path.sep))
      throw new AnimationError('Asset musí byť v src/assets/.');
    const bytes = await readFile(file);
    if (bytes.length > 6 * 1024 * 1024)
      throw new AnimationError('Zdroj môže mať najviac 6 MB.');
    return {
      image: await normalizeSource(bytes, background),
      revision: hash(bytes),
    };
  }
  async function folder() {
    const directory = path.join(assetsRoot, 'animations');
    await mkdir(directory, { recursive: true });
    if (
      (await lstat(directory)).isSymbolicLink() ||
      !(await realpath(directory)).startsWith(
        (await realpath(assetsRoot)) + path.sep,
      )
    )
      throw new AnimationError(
        'Adresár animácií musí byť lokálny priečinok bez symlinku.',
      );
    return directory;
  }
  async function assertSource(job: AnimationJob) {
    if (
      (await source(job.request.source)).revision !== job.request.sourceRevision
    )
      throw new AnimationError(
        'Zdroj sa zmenil. Výsledok sa nepriradil; načítaj nový zdroj.',
        409,
      );
  }
  async function run(
    job: AnimationJob,
    controller: AbortController,
    input: Awaited<ReturnType<typeof source>>,
  ) {
    const root = path.join(assetsRoot, 'animations');
    const staging = path.join(root, `.${job.id}.tmp`);
    const destination = path.join(root, job.id);
    try {
      await folder();
      const result = await generator!.generate({
        image: input.image.png,
        prompt: videoPrompt(job.request),
        duration: job.request.duration,
        signal: controller.signal,
        onProgress: (phase, requestId) => {
          job.phase = phase;
          job.requestId = requestId;
        },
      });
      controller.signal.throwIfAborted();
      await assertSource(job);
      if (
        result.video.length > 60 * 1024 * 1024 ||
        result.video.toString('ascii', 4, 8) !== 'ftyp'
      )
        throw new AnimationError('Očakávam MP4 do 60 MB.');
      await mkdir(staging);
      await writeFile(path.join(staging, 'original.mp4'), result.video, {
        flag: 'wx',
      });
      await writeFile(path.join(staging, 'input.png'), input.image.png, {
        flag: 'wx',
      });
      await writeFile(
        path.join(staging, 'video.json'),
        await json({
          version: 1,
          provider: 'fal',
          model: generator!.model,
          requestId: result.requestId,
          request: job.request,
          submittedPrompt: videoPrompt(job.request),
          width: input.image.width,
          height: input.image.height,
        }),
      );
      controller.signal.throwIfAborted();
      await rename(staging, destination);
      controller.signal.throwIfAborted();
      onPublished();
      job.requestId = result.requestId;
      job.video = `animations/${job.id}/original.mp4`;
      job.status = 'completed';
      job.phase = 'Video je uložené. Vyber úsek a ulož herné snímky.';
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      await rm(destination, { recursive: true, force: true });
      job.status = controller.signal.aborted ? 'cancelled' : 'failed';
      job.error = controller.signal.aborted
        ? 'Generovanie zrušené. fal.ai už mohlo požiadavku spracovať.'
        : error instanceof Error &&
            ['TimeoutError', 'AbortError'].includes(error.name)
          ? 'Generovanie prekročilo časový limit.'
          : error instanceof Error
            ? error.message
            : 'Generovanie zlyhalo.';
      job.phase = job.error;
    }
  }
  return {
    async info() {
      return {
        configured: Boolean(generator),
        model: generator?.model ?? VIDEO_MODEL,
        processorAvailable: await processorAvailable(),
      };
    },
    async sourceInfo(id: string): Promise<SourceInfo> {
      const input = await source(id);
      return {
        width: input.image.width,
        height: input.image.height,
        revision: input.revision,
      };
    },
    list: () => [...jobs.values()].map((entry) => entry.job),
    get(id: string) {
      const entry = jobs.get(id);
      if (!entry) throw new AnimationError('Generovanie neexistuje.', 404);
      return entry.job;
    },
    async start(value: unknown) {
      if (!validateGenerationRequest(value))
        throw new AnimationError(
          'Neplatné zadanie videa: vyber zdroj, prompt, typ, 2/3/5 sekúnd a pozadie.',
        );
      if (!generator)
        throw new AnimationError(
          'AI nie je nakonfigurované. Nastav FAL_KEY v .env.local a reštartuj npm run dev.',
          503,
        );
      if (
        preparing ||
        processing ||
        [...jobs.values()].some((entry) => entry.job.status === 'running')
      )
        throw new AnimationError(
          'Už beží jedno generovanie alebo spracovanie. Počkaj alebo ho zruš.',
          409,
        );
      preparing = true;
      try {
        if (!(await processorAvailable()))
          throw new AnimationError(
            'FFmpeg chýba. Spusti npm ci alebo nastav FFMPEG_PATH.',
            503,
          );
        const request: GenerationRequest = structuredClone(value);
        const input = await source(request.source, request.background);
        if (input.revision !== request.sourceRevision)
          throw new AnimationError(
            'Zdrojový obrázok sa zmenil. Načítaj ho znovu.',
            409,
          );
        await folder();
        for (const [id, entry] of jobs)
          if (jobs.size >= 20 && entry.job.status !== 'running')
            jobs.delete(id);
        const controller = new AbortController();
        const job: AnimationJob = {
          id: randomUUID(),
          status: 'running',
          request,
          phase: 'Odosielam celý asset do fal.ai…',
        };
        jobs.set(job.id, { job, controller });
        void run(job, controller, input);
        return job;
      } finally {
        preparing = false;
      }
    },
    async save(id: string, value: unknown) {
      if (!validateProcessing(value))
        throw new AnimationError(
          'Neplatný časový výber / fps / kľúčovanie. Najviac 120 snímkov a 24 fps.',
        );
      if (processing)
        throw new AnimationError('Už prebieha spracovanie videa.', 409);
      const entry = jobs.get(id);
      if (!entry?.job.video || entry.job.status !== 'completed')
        throw new AnimationError('Video ešte nie je pripravené.', 409);
      const job = entry.job;
      if (value.trimEnd > job.request.duration + 0.05)
        throw new AnimationError('Časový výber presahuje zadanú dĺžku videa.');
      processing = true;
      const clipId = randomUUID();
      let staging: string | undefined;
      try {
        await assertSource(job);
        const root = await folder();
        const videoFile = await realpath(path.join(assetsRoot, job.video!));
        if (!videoFile.startsWith((await realpath(root)) + path.sep))
          throw new AnimationError('Video musí byť lokálne.');
        staging = path.join(root, `.${clipId}.tmp`);
        await mkdir(staging);
        const input = await source(job.request.source);
        const names = await extractFrames(
          videoFile,
          staging,
          value as VideoProcessing,
          { width: input.image.outputWidth, height: input.image.outputHeight },
          job.request.background,
          entry!.controller.signal,
        );
        const definition = {
          id: `animation-${clipId}`,
          label: `${job.request.kind} postavy`,
          source: job.request.source,
          kind: job.request.kind,
          fps: value.fps,
          frames: names.map((name) => `animations/${clipId}/${name}`),
          generation: {
            provider: 'fal' as const,
            model: generator!.model,
            prompt: job.request.prompt,
            sourceHash: job.request.sourceRevision,
            requestId: job.requestId!,
            video: job.video!,
            duration: job.request.duration,
            background: job.request.background,
            trimStart: value.trimStart,
            trimEnd: value.trimEnd,
          },
        };
        await writeFile(
          path.join(staging, 'generation.json'),
          await json({
            version: 2,
            ...definition,
            processing: value,
            width: input.image.outputWidth,
            height: input.image.outputHeight,
          }),
        );
        await assertSource(job);
        await rename(staging, path.join(root, clipId));
        onPublished();
        job.result = definition;
        return definition;
      } finally {
        if (staging) await rm(staging, { recursive: true, force: true });
        processing = false;
      }
    },
    cancel(id: string) {
      const entry = jobs.get(id);
      if (!entry) throw new AnimationError('Generovanie neexistuje.', 404);
      if (entry.job.status !== 'running')
        throw new AnimationError('Generovanie už skončilo.', 409);
      entry.controller.abort();
      return entry.job;
    },
    dispose() {
      for (const entry of jobs.values()) entry.controller.abort();
    },
  };
}

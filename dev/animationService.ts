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
import { format, resolveConfig } from 'prettier';
import type {
  AnimationJob,
  GenerationRequest,
  SourceInfo,
} from '../src/editor/animationTypes.ts';
import {
  assembleFrame,
  framePlan,
  framePrompt,
  normalizeSource,
  prepareEdit,
  validateGenerationRequest,
} from './animationImages.ts';
import type { ImageEditor } from './imageEdit.ts';
import { IMAGE_MODEL } from './imageEdit.ts';

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
export function createAnimationService(
  assetsRoot: string,
  editor?: ImageEditor,
  onPublished: () => void = () => {},
) {
  let preparing = false;
  const jobs = new Map<
    string,
    { job: AnimationJob; controller: AbortController }
  >();
  async function source(id: string) {
    if (!/^[a-zA-Z0-9_/-]+\.(png|webp|svg)$/.test(id) || id.includes('..'))
      throw new AnimationError('Vyber lokálny PNG/WebP/SVG asset.');
    const file = await realpath(path.join(assetsRoot, id));
    const root = await realpath(assetsRoot);
    if (!file.startsWith(root + path.sep))
      throw new AnimationError('Asset musí byť v src/assets/.');
    const bytes = await readFile(file);
    if (bytes.length > 6 * 1024 * 1024)
      throw new AnimationError('Zdroj môže mať najviac 6 MB.');
    return { image: await normalizeSource(bytes), revision: hash(bytes) };
  }
  async function run(
    job: AnimationJob,
    controller: AbortController,
    input: Awaited<ReturnType<typeof source>>,
  ) {
    const folder = path.join(assetsRoot, 'animations');
    const staging = path.join(folder, `.${job.id}.tmp`);
    const destination = path.join(folder, job.id);
    try {
      await mkdir(folder, { recursive: true });
      if (
        (await lstat(folder)).isSymbolicLink() ||
        !(await realpath(folder)).startsWith(
          (await realpath(assetsRoot)) + path.sep,
        )
      )
        throw new AnimationError(
          'Adresár animácií musí byť lokálny priečinok bez symlinku.',
        );
      const request = job.request;
      const plan = framePlan(request.kind, request.frameCount);
      const sequence =
        request.frameIndex === undefined ? plan : [plan[request.frameIndex]!];
      const layout = await prepareEdit(input.image, request.region);
      const poses = new Map<
        number,
        { bytes: Buffer; name: string; prompt?: string }
      >();
      if (request.frameIndex === undefined)
        poses.set(0, { bytes: input.image.png, name: 'source.png' });
      for (const fraction of [...new Set(sequence)]) {
        if (poses.has(fraction)) continue;
        controller.signal.throwIfAborted();
        const prompt = framePrompt(request, fraction);
        const edited = await editor!.edit({
          image: layout.image,
          mask: layout.mask,
          prompt,
          quality: request.quality,
          signal: controller.signal,
          transparent: request.mode === 'full' && input.image.hasAlpha,
        });
        controller.signal.throwIfAborted();
        const bytes = await assembleFrame(
          input.image,
          edited,
          layout,
          request.region,
        );
        poses.set(fraction, { bytes, name: `pose-${poses.size}.png`, prompt });
        job.completed++;
      }
      controller.signal.throwIfAborted();
      if ((await source(request.source)).revision !== input.revision)
        throw new AnimationError(
          'Zdroj sa zmenil počas generovania. Snímky sa nepriradili; načítaj nový zdroj.',
        );
      await mkdir(staging, { recursive: true });
      const generation = {
        prompt: request.prompt,
        model: editor!.model,
        quality: request.quality,
        mode: request.mode,
        region: request.region,
        sourceHash: input.revision,
      };
      for (const pose of poses.values())
        await writeFile(path.join(staging, pose.name), pose.bytes, {
          flag: 'wx',
        });
      await writeFile(
        path.join(staging, 'generation.json'),
        await format(
          JSON.stringify(
            {
              version: 1,
              source: request.source,
              kind: request.kind,
              ...generation,
              width: input.image.width,
              height: input.image.height,
              sequence: sequence.map((fraction) => poses.get(fraction)!.name),
              poses: [...poses].map(([fraction, pose]) => ({
                fraction,
                file: pose.name,
                prompt: pose.prompt,
              })),
            },
            null,
            2,
          ),
          {
            ...(await resolveConfig(path.join(folder, 'generation.json'))),
            parser: 'json',
          },
        ),
      );
      controller.signal.throwIfAborted();
      await rename(staging, destination);
      controller.signal.throwIfAborted();
      onPublished();
      job.result = {
        id: `animation-${job.id.slice(0, 8)}`,
        source: request.source,
        kind: request.kind,
        frames: sequence.map(
          (fraction) => `animations/${job.id}/${poses.get(fraction)!.name}`,
        ),
        generation,
      };
      job.status = 'completed';
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      await rm(destination, { recursive: true, force: true });
      job.status = controller.signal.aborted ? 'cancelled' : 'failed';
      job.error = controller.signal.aborted
        ? 'Generovanie zrušené.'
        : error instanceof Error &&
            ['TimeoutError', 'AbortError'].includes(error.name)
          ? 'Generovanie prekročilo časový limit. Skús to znovu ručne.'
          : error instanceof Error
            ? error.message
            : 'Generovanie zlyhalo.';
    }
  }
  return {
    info: { configured: Boolean(editor), model: editor?.model ?? IMAGE_MODEL },
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
          'Neplatné zadanie animácie. Očakávam 3–12 snímkov, prompt a oblasť úpravy.',
        );
      if (!editor)
        throw new AnimationError(
          'AI generovanie nie je nakonfigurované. Nastav OPENAI_API_KEY v .env.local a reštartuj npm run dev.',
          503,
        );
      if (
        preparing ||
        [...jobs.values()].some((entry) => entry.job.status === 'running')
      )
        throw new AnimationError(
          'Už beží jedno generovanie. Počkaj alebo ho zruš.',
          409,
        );
      preparing = true;
      try {
        const request: GenerationRequest = structuredClone(value);
        const input = await source(request.source);
        if (input.revision !== request.sourceRevision)
          throw new AnimationError(
            'Zdrojový obrázok sa zmenil. Načítaj ho znovu pred generovaním.',
            409,
          );
        await prepareEdit(input.image, request.region); // Reject bad geometry before any paid request.
        const sequence = framePlan(request.kind, request.frameCount);
        const total =
          request.frameIndex === undefined
            ? new Set(sequence.filter((fraction) => fraction !== 0)).size
            : 1;
        for (const [id, entry] of jobs)
          if (jobs.size >= 20 && entry.job.status !== 'running')
            jobs.delete(id);
        const controller = new AbortController();
        const job: AnimationJob = {
          id: randomUUID(),
          status: 'running',
          request,
          completed: 0,
          total,
        };
        jobs.set(job.id, { job, controller });
        void run(job, controller, input);
        return job;
      } finally {
        preparing = false;
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
      for (const entry of jobs.values())
        if (entry.job.status === 'running') entry.controller.abort();
    },
  };
}

import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv, type Plugin } from 'vite';
import { createEditorJobs } from './editorJobs.ts';
import {
  directionInput,
  directionStatus,
  proposeAnimation,
  type DirectionOptions,
} from './animationDirection.ts';
import type { ArtContext } from '../src/editor/jobs.ts';
import { artStatus, createArtwork, type ArtOptions } from './sceneArt.ts';
import {
  createSpeech,
  analyzeSpeech,
  speechCatalog,
  speechStatus,
  validateSpeechAssets,
} from './speech.ts';
import {
  importAnimation,
  validateAnimationAssets,
  detectAnimationRegion,
} from './animationImport.ts';
import { format, resolveConfig } from 'prettier';
import { validateProject } from '../src/game/validateProject.ts';

const API = '/__tukabel/editor';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const loopback = (host: string) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(host);
const mediaPattern =
  /^[a-zA-Z0-9_./-]+(?:\.wav|\.lipsync\.json|\/alignment\.json)$/;
const imagePattern = /^[a-zA-Z0-9_/-]+\.(svg|png|jpe?g|webp|avif)$/;

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new Error('Expected application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (
      size >
      (req.url?.endsWith('/animations/import')
        ? 48
        : req.url?.includes('/jobs')
          ? 0.25
          : req.url?.endsWith('/speech/import')
            ? 29
            : 9) *
        1024 *
        1024
    )
      throw new Error('Request is too large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function listAssets(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      // Hidden staging directories can be renamed while jobs publish assets.
      // Never walk them or offer their partial files in another editor request.
      if (entry.name.startsWith('.')) return [];
      const id = `${prefix}${entry.name}`;
      if (entry.isDirectory())
        return listAssets(path.join(directory, entry.name), `${id}/`);
      return entry.isFile() && (imagePattern.test(id) || mediaPattern.test(id))
        ? [id]
        : [];
    }),
  );
  return nested.flat().sort();
}

export function editorPlugin(
  options: {
    speech?: import('./speech.ts').SpeechOptions;
    art?: ArtOptions;
    direction?: DirectionOptions;
  } = {},
): Plugin {
  return {
    name: 'tukabel-local-editor',
    apply: 'serve',
    configureServer(server) {
      // configureServer never runs in build or preview. A middleware-only Vite
      // loader (content validation) does not need an editor API either.
      if (server.config.server.middlewareMode) return;
      const source = path.resolve(
        server.config.root,
        'src/game/content/project.json',
      );
      const assetsRoot = path.resolve(server.config.root, 'src/assets');
      const env = loadEnv(server.config.mode, server.config.envDir, '');
      const speechOptions = {
        apiKey: process.env.ELEVENLABS_API_KEY || env.ELEVENLABS_API_KEY,
        rhubarbBin: process.env.RHUBARB_BIN || env.RHUBARB_BIN,
        ...options.speech,
      };
      const artOptions: ArtOptions = {
        apiKey: process.env.OPENAI_API_KEY || env.OPENAI_API_KEY,
        model: process.env.OPENAI_IMAGE_MODEL || env.OPENAI_IMAGE_MODEL,
        ...options.art,
      };
      const directionOptions: DirectionOptions = {
        apiKey: process.env.OPENAI_API_KEY || env.OPENAI_API_KEY,
        model: process.env.OPENAI_ANIMATION_MODEL || env.OPENAI_ANIMATION_MODEL,
        ...options.direction,
      };
      const jobs = createEditorJobs();
      server.httpServer?.once('close', () => jobs.close());
      let queue = Promise.resolve();
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(API)) {
          next();
          return;
        }
        const respond = (status: number, value: unknown) => {
          res.writeHead(status, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          res.end(JSON.stringify(value));
        };
        const run = async () => {
          const host = new URL(`http://${req.headers.host ?? 'invalid'}`);
          const remote = req.socket.remoteAddress;
          if (
            !loopback(host.hostname) ||
            !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote ?? '')
          ) {
            respond(403, { error: 'Editor is available on loopback only.' });
            return;
          }
          if (
            req.method !== 'GET' &&
            (req.headers.origin !== host.origin ||
              req.headers['x-tukabel-editor'] !== '1')
          ) {
            respond(403, { error: 'Same-origin editor request required.' });
            return;
          }
          const parsedUrl = new URL(req.url!, host);
          const endpoint = parsedUrl.pathname;
          if (endpoint === `${API}/art/status` && req.method === 'GET') {
            respond(200, artStatus(artOptions));
            return;
          }
          if (
            endpoint === `${API}/animations/direction/status` &&
            req.method === 'GET'
          ) {
            respond(200, directionStatus(directionOptions));
            return;
          }
          if (endpoint === `${API}/jobs` && req.method === 'GET') {
            respond(200, { jobs: jobs.list() });
            return;
          }
          const action = endpoint.match(
            /^\/__tukabel\/editor\/jobs\/([a-f0-9-]+)\/(cancel|dismiss)$/,
          );
          if (action && req.method === 'POST') {
            if (action[2] === 'cancel') jobs.cancel(action[1]!);
            else jobs.dismiss(action[1]!);
            respond(200, {});
            return;
          }
          if (endpoint === `${API}/jobs` && req.method === 'POST') {
            const body = (await readJson(req)) as {
              kind?: string;
              label?: string;
              context?: unknown;
              input?: unknown;
            };
            if (
              !body ||
              typeof body.label !== 'string' ||
              !body.context ||
              typeof body.context !== 'object'
            )
              throw Error('Neplatná úloha.');
            if (body.kind === 'art') {
              const context = body.context as ArtContext;
              if (
                typeof context.sceneId !== 'string' ||
                typeof context.targetId !== 'string' ||
                typeof context.fingerprint !== 'string' ||
                typeof context.label !== 'string' ||
                !context.placement?.bounds
              )
                throw Error('Neplatný cieľ grafickej úpravy.');
              const input = body.input;
              const job = jobs.submit(
                { kind: 'art', context },
                body.label,
                async (onStage) => {
                  const result = await createArtwork(assetsRoot, input, {
                    ...artOptions,
                    onStage,
                  });
                  const modules =
                    server.environments.client.moduleGraph.getModulesByFile(
                      path.resolve(server.config.root, 'src/game/assets.ts'),
                    );
                  for (const module of modules ?? [])
                    server.environments.client.moduleGraph.invalidateModule(
                      module,
                    );
                  return { ...result, assets: await listAssets(assetsRoot) };
                },
              );
              respond(202, job);
              return;
            }
            if (body.kind === 'animation') {
              const input = {
                ...(body.input as object),
                context: body.context,
              };
              const { context } = directionInput(input);
              const job = jobs.submit(
                { kind: 'animation', context },
                body.label,
                async (stage) => {
                  stage('AI navrhuje nastavenie existujúcich klipov');
                  return proposeAnimation(input, directionOptions);
                },
              );
              respond(202, job);
              return;
            }
            throw Error('Neznámy typ úlohy.');
          }
          if (endpoint === `${API}/speech/status` && req.method === 'GET') {
            respond(200, await speechStatus(speechOptions));
            return;
          }
          if (endpoint === `${API}/speech/catalog` && req.method === 'POST') {
            respond(200, await speechCatalog(speechOptions));
            return;
          }
          if (
            [
              `${API}/speech/generate`,
              `${API}/speech/import`,
              `${API}/speech/analyze`,
            ].includes(endpoint) &&
            req.method === 'POST'
          ) {
            const input = await readJson(req);
            if (
              endpoint.endsWith('/generate') &&
              input &&
              typeof input === 'object' &&
              'data' in input
            )
              throw new Error('Use speech/import for WAV uploads.');
            if (
              endpoint.endsWith('/import') &&
              (!input || typeof input !== 'object' || !('data' in input))
            )
              throw new Error('WAV upload required.');
            const result = endpoint.endsWith('/analyze')
              ? await analyzeSpeech(assetsRoot, input, speechOptions)
              : await createSpeech(assetsRoot, input, speechOptions);
            const modules =
              server.environments.client.moduleGraph.getModulesByFile(
                path.resolve(server.config.root, 'src/game/assets.ts'),
              );
            for (const module of modules ?? [])
              server.environments.client.moduleGraph.invalidateModule(module);
            respond(201, { ...result, assets: await listAssets(assetsRoot) });
            return;
          }
          if (
            endpoint === `${API}/animations/import` &&
            req.method === 'POST'
          ) {
            const animation = await importAnimation(
              assetsRoot,
              await readJson(req),
            );
            const modules =
              server.environments.client.moduleGraph.getModulesByFile(
                path.resolve(server.config.root, 'src/game/assets.ts'),
              );
            for (const module of modules ?? [])
              server.environments.client.moduleGraph.invalidateModule(module);
            respond(201, { animation, assets: await listAssets(assetsRoot) });
            return;
          }
          if (
            endpoint === `${API}/animations/region` &&
            req.method === 'POST'
          ) {
            const region = await detectAnimationRegion(
              assetsRoot,
              await readJson(req),
            );
            respond(200, { region: region ?? null });
            return;
          }
          if (endpoint === `${API}/project` && req.method === 'GET') {
            const raw = await readFile(source, 'utf8');
            respond(200, {
              content: JSON.parse(raw),
              revision: hash(raw),
              assets: await listAssets(assetsRoot),
            });
          } else if (endpoint === `${API}/project` && req.method === 'PUT') {
            const body = (await readJson(req)) as {
              content?: unknown;
              revision?: unknown;
            } | null;
            const errors = validateProject(
              body?.content,
              await listAssets(assetsRoot),
            );
            if (errors.length) {
              respond(422, { error: 'Invalid project', errors });
              return;
            }
            await validateAnimationAssets(
              assetsRoot,
              body!.content as import('../src/game/types.ts').GameContent,
            );
            await validateSpeechAssets(
              assetsRoot,
              body!.content as import('../src/game/types.ts').GameContent,
            );
            const stat = await lstat(source);
            if (!stat.isFile() || stat.isSymbolicLink())
              throw new Error('Project must be a regular source file.');
            const raw = await readFile(source, 'utf8');
            if (body?.revision !== hash(raw)) {
              respond(409, {
                error:
                  'Súbor sa medzitým zmenil. Načítaj ho znovu; tvoje zmeny neboli prepísané.',
              });
              return;
            }
            const formatted = await format(JSON.stringify(body.content), {
              ...(await resolveConfig(source)),
              filepath: source,
            });
            const temporary = `${source}.${randomUUID()}.tmp`;
            try {
              await writeFile(temporary, formatted, {
                flag: 'wx',
                mode: stat.mode,
              });
              // Recheck after formatting and staging to protect edits made outside the editor.
              if (hash(await readFile(source, 'utf8')) !== body.revision) {
                respond(409, {
                  error: 'Súbor sa medzitým zmenil. Načítaj ho znovu.',
                });
                return;
              }
              await rename(temporary, source);
              respond(200, { revision: hash(formatted) });
            } finally {
              await unlink(temporary).catch(() => {});
            }
          } else if (endpoint === `${API}/assets` && req.method === 'POST') {
            const body = (await readJson(req)) as {
              name?: unknown;
              data?: unknown;
            } | null;
            if (
              typeof body?.name !== 'string' ||
              typeof body.data !== 'string' ||
              body.data.length > 8 * 1024 * 1024
            )
              throw new Error('Invalid image upload (max 6 MB)');
            const extension = path.extname(body.name).toLowerCase();
            const bytes = Buffer.from(body.data, 'base64');
            const valid =
              extension === '.png'
                ? bytes
                    .subarray(0, 8)
                    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
                : ['.jpg', '.jpeg'].includes(extension)
                  ? bytes[0] === 255 && bytes[1] === 216
                  : extension === '.webp' &&
                    bytes.toString('ascii', 0, 4) === 'RIFF' &&
                    bytes.toString('ascii', 8, 12) === 'WEBP';
            if (!valid || !bytes.length || bytes.length > 6 * 1024 * 1024)
              throw new Error(
                'Only PNG, JPEG and WebP images up to 6 MB are supported.',
              );
            const folder = path.join(assetsRoot, 'imported');
            await mkdir(folder, { recursive: true });
            if ((await lstat(folder)).isSymbolicLink())
              throw new Error('Asset folder must not be a symbolic link.');
            const stem =
              path
                .basename(body.name, extension)
                .replace(/[^a-zA-Z0-9_-]/g, '-')
                .slice(0, 48) || 'image';
            const id = `imported/${stem}-${randomUUID().slice(0, 8)}${extension}`;
            await writeFile(path.join(assetsRoot, id), bytes, { flag: 'wx' });
            respond(201, { id, assets: await listAssets(assetsRoot) });
          } else respond(404, { error: 'Unknown editor endpoint or method.' });
        };
        // Serialize writes and reads so two tabs cannot both overwrite the same revision.
        const pending =
          req.url?.startsWith(`${API}/jobs`) || req.url?.endsWith('/status')
            ? run()
            : (queue = queue.then(run));
        const handled = pending.catch((error: unknown) => {
          if (!(res as ServerResponse).headersSent)
            respond(400, {
              error:
                error instanceof Error
                  ? error.message
                  : 'Editor request failed.',
            });
        });
        if (pending === queue) queue = handled;
      });
    },
    hotUpdate: {
      order: 'post',
      handler(context) {
        // Suppress glob-triggered reloads when importing a new asset as well as
        // project saves. Vite still invalidates modules for the next page load.
        if (
          context.file.endsWith('/src/game/content/project.json') ||
          // Atomic folder publication can be reported as update/delete as well
          // as create; none may refresh away the current artwork draft.
          context.file.includes('/src/assets/scene-art/') ||
          (context.type === 'create' &&
            (context.file.includes('/src/assets/imported/') ||
              context.file.includes('/src/assets/animations/') ||
              context.file.includes('/src/assets/speech/')))
        )
          return [];
      },
    },
  };
}

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
import { loadEnv } from 'vite';
import type { Plugin } from 'vite';
import { createAnimationService, AnimationError } from './animationService.ts';
import { openAIImageEditor } from './imageEdit.ts';
import type { ImageEditor } from './imageEdit.ts';
import { format, resolveConfig } from 'prettier';
import { validateProject } from '../src/game/validateProject.ts';

const API = '/__tukabel/editor';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const loopback = (host: string) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(host);
const imagePattern = /^[a-zA-Z0-9_/-]+\.(svg|png|jpe?g|webp|avif)$/;

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new Error('Expected application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 9 * 1024 * 1024)
      throw new Error('Request is too large (max 9 MB)');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function listAssets(directory: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const id = `${prefix}${entry.name}`;
      if (entry.isDirectory())
        return listAssets(path.join(directory, entry.name), `${id}/`);
      return entry.isFile() && imagePattern.test(id) ? [id] : [];
    }),
  );
  return nested.flat().sort();
}

export function editorPlugin(
  options: { imageEditor?: ImageEditor; disableAI?: boolean } = {},
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
      const key =
        process.env.OPENAI_API_KEY ||
        loadEnv(server.config.mode, server.config.envDir, 'OPENAI_')
          .OPENAI_API_KEY;
      const animationService = createAnimationService(
        assetsRoot,
        options.disableAI
          ? undefined
          : (options.imageEditor ?? (key ? openAIImageEditor(key) : undefined)),
        () => {
          // Renaming a complete folder may not produce individual add events.
          // Refresh the glob on the next page load without resetting the draft.
          const modules =
            server.environments.client.moduleGraph.getModulesByFile(
              path.resolve(server.config.root, 'src/game/assets.ts'),
            );
          for (const module of modules ?? [])
            server.environments.client.moduleGraph.invalidateModule(module);
        },
      );
      server.httpServer?.once('close', () => animationService.dispose());
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
          if (endpoint === `${API}/animations/info` && req.method === 'GET') {
            respond(200, animationService.info);
            return;
          }
          if (endpoint === `${API}/animations/source` && req.method === 'GET') {
            respond(
              200,
              await animationService.sourceInfo(
                parsedUrl.searchParams.get('id') ?? '',
              ),
            );
            return;
          }
          if (endpoint === `${API}/animations/jobs` && req.method === 'GET') {
            respond(200, animationService.list());
            return;
          }
          if (endpoint === `${API}/animations/jobs` && req.method === 'POST') {
            respond(202, await animationService.start(await readJson(req)));
            return;
          }
          const jobEndpoint = new RegExp(
            `^${API}/animations/jobs/([a-f0-9-]+)$`,
          ).exec(endpoint);
          if (jobEndpoint && req.method === 'GET') {
            respond(200, {
              job: animationService.get(jobEndpoint[1]!),
              assets: await listAssets(assetsRoot),
            });
            return;
          }
          if (jobEndpoint && req.method === 'DELETE') {
            respond(200, animationService.cancel(jobEndpoint[1]!));
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
        queue = queue.then(run).catch((error: unknown) => {
          if (!(res as ServerResponse).headersSent)
            respond(error instanceof AnimationError ? error.status : 400, {
              error:
                error instanceof Error
                  ? error.message
                  : 'Editor request failed.',
            });
        });
      });
    },
    hotUpdate: {
      order: 'post',
      handler(context) {
        // Suppress glob-triggered reloads when importing a new asset as well as
        // project saves. Vite still invalidates modules for the next page load.
        if (
          context.file.endsWith('/src/game/content/project.json') ||
          (context.type === 'create' &&
            (context.file.includes('/src/assets/imported/') ||
              context.file.includes('/src/assets/animations/')))
        )
          return [];
      },
    },
  };
}

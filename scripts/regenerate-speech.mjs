import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, loadEnv } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const options = { confirmed: false, all: false, lipSyncOnly: false };
let rhubarb;
const take = (i, name) => {
  const value = args[i + 1];
  if (!value || value.startsWith('--'))
    throw new Error(`${name} vyžaduje hodnotu.`);
  return value;
};
async function main() {
  if (args.includes('--help')) {
    process.stdout.write(
      `TUKABEL · dávkový dabing a lip-sync\n\n` +
        `npm run speech:regenerate                         Náhled, bez API a zápisu\n` +
        `npm run speech:regenerate -- --confirm             Změněné/nové hlášky či hlas; všechny lip-sync\n` +
        `npm run speech:regenerate -- --all --confirm       Všechny hlášky i lip-sync\n` +
        `npm run speech:regenerate -- --lip-sync-only --confirm  Jen lokální Rhubarb pro aktuální audio\n` +
        `npm run speech:regenerate -- --resume UUID --confirm   Pokračovat z ověřených výsledků\n\n` +
        `npm run speech:regenerate -- --abandon UUID        Uzavřít zastavenou zastaralou dávku bez API\n` +
        `--retry-failed  Výslovně opakovat nepotvrzený požadavek po kontrole archivu/účtu\n` +
        `--preview 1|2|3  Ukázka použitá při obnově rotačního Voice Design (výchozí 1)\n` +
        `--rhubarb PATH   Přebije RHUBARB_BIN / .local-tools/rhubarb/rhubarb / PATH\n`,
    );
    return;
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--confirm') options.confirmed = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--all') options.all = true;
    else if (arg === '--lip-sync-only') options.lipSyncOnly = true;
    else if (arg === '--retry-failed') options.retryFailed = true;
    else if (arg === '--abandon') {
      options.abandon = take(i, arg);
      i++;
    } else if (arg === '--resume') {
      options.resume = take(i, arg);
      i++;
    } else if (arg === '--preview') {
      options.previewIndex = Number(take(i, arg)) - 1;
      i++;
    } else if (arg === '--rhubarb') {
      rhubarb = take(i, arg);
      i++;
    } else throw new Error(`Neznámý přepínač ${arg}. Použij --help.`);
  }
  if (options.all && options.lipSyncOnly)
    throw new Error('--all a --lip-sync-only nelze kombinovat.');
  if (
    options.abandon &&
    (options.resume ||
      options.confirmed ||
      options.all ||
      options.lipSyncOnly ||
      options.retryFailed)
  )
    throw new Error('--abandon použij samostatně s ID zastavené dávky.');
  if (options.dryRun && options.confirmed)
    throw new Error('--dry-run a --confirm nelze kombinovat.');
  if (options.resume && !options.confirmed)
    throw new Error(
      '--resume vyžaduje --confirm; samotný náhled žádnou dávku neobnovuje.',
    );
  if (options.retryFailed && !options.resume)
    throw new Error('--retry-failed použij pouze s --resume.');
  if (
    options.resume &&
    (options.all || options.lipSyncOnly || options.previewIndex !== undefined)
  )
    throw new Error(
      'Obnovená dávka používá svůj zachycený plán a volbu hlasu; další nastavení neuváděj.',
    );
  if (
    options.previewIndex !== undefined &&
    (!Number.isInteger(options.previewIndex) ||
      options.previewIndex < 0 ||
      options.previewIndex > 2)
  )
    throw new Error('--preview musí být 1, 2 nebo 3.');
  const env = loadEnv('development', root, '');
  if (rhubarb) process.env.RHUBARB_BIN = path.resolve(rhubarb);
  else if (!env.RHUBARB_BIN) {
    const local = path.join(root, '.local-tools/rhubarb/rhubarb');
    if (
      await access(local).then(
        () => true,
        () => false,
      )
    )
      process.env.RHUBARB_BIN = local;
  }
  const server = await createServer({
    root,
    cacheDir: path.join(root, '.local-tools', 'speech-vite-cache'),
    logLevel: 'error',
    appType: 'custom',
    server: { host: '127.0.0.1', port: 0, open: false, watch: null },
  });
  let stopping = false;
  const stop = () => {
    stopping = true;
    process.stdout.write(
      'Přerušení: dokončím běžící požadavek a uložím výsledek. Potom lze pokračovat přes --resume.\n',
    );
  };
  try {
    if (options.abandon) {
      const { abandonSpeechBatch } = await server.ssrLoadModule(
        '/dev/speechBatch.ts',
      );
      await abandonSpeechBatch(root, options.abandon);
      process.stdout.write(
        'Dávka je uzavřená. Projekt ani účet se nezměnily; můžeš spustit nový náhled.\n',
      );
      return;
    }
    const { planSpeechBatch } = await server.ssrLoadModule(
      '/dev/speechBatchPlan.ts',
    );
    if (!options.confirmed) {
      const content = JSON.parse(
        await readFile(
          path.join(root, 'src/game/content/project.json'),
          'utf8',
        ),
      );
      const plan = await planSpeechBatch(
        path.join(root, 'src/assets'),
        content,
        options,
      );
      process.stdout.write(
        `NÁHLED · ${plan.generateCount}/${plan.lines.length} TTS · ${plan.lipSyncCount} lip-sync · ${plan.characters} znaků\n`,
      );
      for (const actor of plan.actors) {
        const changed = actor.lines.filter((line) => line.generate);
        const reasons = [...new Set(changed.flatMap((line) => line.reasons))];
        process.stdout.write(
          `${actor.name}: ${changed.length}/${actor.lines.length} nové audio, ${actor.lines.length} lip-sync${actor.restore ? ', obnova rotačního hlasu' : ''}${reasons.length ? ' [' + reasons.join(', ') + ']' : ''}\n`,
        );
      }
      process.stdout.write(
        'Žádné API nebylo zavoláno, soubory zůstaly beze změny. Generování: npm run speech:regenerate -- --confirm\n',
      );
      if (plan.errors.length) throw new Error(plan.errors.join('\n'));
      return;
    }
    await server.listen();
    const base = new URL(server.resolvedUrls.local[0]);
    if (base.hostname !== '127.0.0.1')
      throw new Error('Dávka vyžaduje místní editorové API.');
    async function request(endpoint, method = 'POST', body) {
      const response = await fetch(
        new URL('__tukabel/editor/' + endpoint, base),
        {
          method,
          headers: {
            Origin: base.origin,
            'X-Tukabel-Editor': '1',
            'Content-Type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(320000),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          [
            data.error || `Editor HTTP ${response.status}`,
            ...(data.errors ?? []),
          ].join('\n'),
        );
      if (data && typeof data === 'object') delete data.assets;
      return data;
    }
    const client = {
      readProject: () => request('project', 'GET'),
      writeProject: (content, revision) =>
        request('project', 'PUT', { content, revision }),
      generate: (input) => request('speech/generate', 'POST', input),
      analyze: (audio) => request('speech/analyze', 'POST', { audio }),
      design: (input) => request('speech/design', 'POST', input),
      register: (input) => request('speech/design/save', 'POST', input),
      retire: (input) => request('speech/design/retire', 'POST', input),
      status: () => request('speech/status', 'GET'),
      catalog: () => request('speech/catalog', 'POST', {}),
    };
    process.once('SIGINT', stop);
    const { runSpeechBatch } = await server.ssrLoadModule(
      '/dev/speechBatch.ts',
    );
    await runSpeechBatch(root, client, {
      ...options,
      progress: (message) => process.stdout.write(message + '\n'),
      shouldStop: () => stopping,
    });
  } finally {
    process.off('SIGINT', stop);
    await server.close();
  }
}
main().catch((error) => {
  process.stderr.write(
    (error instanceof Error ? error.message : 'Dávka selhala.') + '\n',
  );
  process.exitCode = 1;
});

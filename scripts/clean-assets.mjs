import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const uuid = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const batch = new RegExp(
  `^(scene-art|codex|animations|speech)/(${uuid})(?:/|$)`,
);
const textFile =
  /\.(?:json|md|adoc|txt|py|mjs|cjs|js|jsx|ts|tsx|html|css|svg)$/i;
const sha = (value) => createHash('sha256').update(value).digest('hex');
async function readReferences(file) {
  const text = await fs.readFile(file, 'utf8');
  if (!file.endsWith('.json')) return text;
  try {
    return text + '\n' + JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
}
const exists = async (file) =>
  fs.lstat(file).then(
    () => true,
    (e) => {
      if (e.code === 'ENOENT') return false;
      throw e;
    },
  );
const groupId = (id) => {
  const match = id.match(batch);
  return match
    ? `${match[1]}/${match[2]}`
    : /^imported\/[a-zA-Z0-9][\w.-]*$/.test(id)
      ? id
      : undefined;
};
async function walk(dir, skipAssets = false) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (
      skipAssets &&
      ['assets', '__pycache__', 'node_modules'].includes(entry.name)
    )
      continue;
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink())
      throw Error(`Úklid odmítl symbolický odkaz: ${file}`);
    if (entry.isDirectory()) files.push(...(await walk(file, skipAssets)));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}
async function realDirectory(dir) {
  if (!(await exists(dir))) {
    await realDirectory(path.dirname(dir));
    await fs.mkdir(dir);
  }
  if ((await fs.realpath(dir)) !== path.resolve(dir))
    throw Error('Adresář úklidu nesmí být symbolický odkaz.');
}

// Only generated UUID batches/imported files are candidates. Named sources,
// icons, HUD art, model weights and experiments are never cleanup targets.
export async function auditAssets(root, options = {}) {
  root = path.resolve(root);
  const base = path.join(root, 'src/assets');
  if ((await fs.realpath(base)) !== base)
    throw Error('Adresář assetů nesmí být symbolický odkaz.');
  const current = await fs.readFile(
    path.join(root, 'src/game/content/project.json'),
    'utf8',
  );
  let head;
  try {
    head =
      options.headProject ??
      execFileSync('git', ['show', 'HEAD:src/game/content/project.json'], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
  } catch {
    throw Error('Nelze přečíst projekt z HEAD; úklid se neprovede.');
  }
  for (const value of [current, head]) {
    const project = JSON.parse(value);
    if (
      !project ||
      !['scenes', 'items', 'dialogues'].every((key) =>
        Array.isArray(project[key]),
      )
    )
      throw Error(
        'Projekt nemá platné kolekce lokací, předmětů a dialogů; úklid se neprovede.',
      );
  }
  const files = await walk(base),
    groups = new Map(),
    assets = new Map();
  for (const file of files) {
    const id = path.relative(base, file),
      group = groupId(id),
      stat = await fs.stat(file);
    assets.set(id, group);
    if (!group) continue;
    if (!groups.has(group))
      groups.set(group, {
        id: group,
        files: [],
        bytes: 0,
        newest: 0,
        reasons: [],
      });
    const g = groups.get(group);
    g.files.push(id);
    g.bytes += stat.size;
    g.newest = Math.max(g.newest, stat.mtimeMs);
  }
  const kept = new Set();
  const protect = (id, reason) => {
    kept.add(id);
    const g = groups.get(id);
    if (!g.reasons.includes(reason)) g.reasons.push(reason);
  };
  const scan = (text, reason) => {
    for (const [id, group] of assets)
      if (group && text.includes(id)) protect(group, reason);
    // UUIDs and import filenames also protect split path.join() references.
    for (const [id] of groups)
      if (text.includes(id) || text.includes(path.basename(id)))
        protect(id, reason);
  };
  scan(JSON.stringify(JSON.parse(current)), 'aktuální projekt');
  scan(JSON.stringify(JSON.parse(head)), 'projekt v HEAD');
  for (const [id, group] of assets)
    if (!group && textFile.test(id))
      scan(await readReferences(path.join(base, id)), `autorský podklad ${id}`);
  const sourceFiles = [];
  for (const dir of ['src', 'dev', 'scripts', 'tests', 'experiments']) {
    const full = path.join(root, dir);
    if (await exists(full)) sourceFiles.push(...(await walk(full, true)));
  }
  for (const e of await fs.readdir(root, { withFileTypes: true }))
    if (e.isFile() && !e.name.startsWith('.') && textFile.test(e.name))
      sourceFiles.push(path.join(root, e.name));
  for (const file of sourceFiles)
    if (textFile.test(file))
      scan(await readReferences(file), path.relative(root, file));
  // Account deletion receipts guard future TTS even after an actor gets a new
  // voice or the editor closes before saving. Preserve pending outcomes too;
  // their proof dependencies are followed by the ordinary recursive scan below.
  for (const g of groups.values())
    if (
      g.id.startsWith('speech/') &&
      g.files.some(
        (id) =>
          id === `${g.id}/retirement.json` ||
          id === `${g.id}/.retirement.pending.json`,
      )
    )
      protect(g.id, 'trvalá evidence uvolnění hlasu');
  // A recently published job may still be an unsaved editor preview.
  for (const g of groups.values())
    if (Date.now() - g.newest < 60 * 60 * 1000)
      protect(g.id, 'změněno během poslední hodiny');
  const visited = new Set();
  while ([...kept].some((id) => !visited.has(id))) {
    for (const id of [...kept])
      if (!visited.has(id)) {
        visited.add(id);
        for (const f of groups.get(id).files)
          if (textFile.test(f))
            scan(await readReferences(path.join(base, f)), `podklad pro ${id}`);
      }
  }
  return {
    sourceHash: sha(current),
    totalFiles: files.length,
    remove: [...groups.values()].filter((g) => !kept.has(g.id)),
    kept: [...groups.values()].filter((g) => kept.has(g.id)),
  };
}

export async function cleanAssets(root, options = {}) {
  root = path.resolve(root);
  const plan = await auditAssets(root, options);
  if (!plan.remove.length) return { ...plan, backup: undefined };
  const base = path.join(root, 'src/assets');
  const trash = path.join(root, '.local-tools/asset-trash');
  await realDirectory(trash);
  const id =
    new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID();
  const backup = path.join(trash, id);
  await fs.mkdir(backup);
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    sourceHash: plan.sourceHash,
    groups: plan.remove,
    status: 'pending',
  };
  const record = () =>
    fs.writeFile(
      path.join(backup, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
  await record();
  const moved = [];
  try {
    for (const group of plan.remove) {
      if (
        sha(
          await fs.readFile(path.join(root, 'src/game/content/project.json')),
        ) !== plan.sourceHash
      )
        throw Error('Projekt se během úklidu změnil.');
      const source = path.join(base, group.id),
        stat = await fs.lstat(source);
      if (stat.isSymbolicLink())
        throw Error('Asset se změnil na symbolický odkaz.');
      const actual = stat.isDirectory() ? await walk(source) : [source];
      const ids = actual.map((f) => path.relative(base, f)).sort();
      if (JSON.stringify(ids) !== JSON.stringify([...group.files].sort()))
        throw Error('Obsah generace se během úklidu změnil.');
      for (const f of actual)
        if ((await fs.stat(f)).mtimeMs > group.newest)
          throw Error('Generace byla mezitím upravena.');
      const target = path.join(backup, 'assets', group.id);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rename(source, target);
      moved.push(group.id);
    }
    manifest.status = 'archived';
    await record();
  } catch (error) {
    for (const id of moved.reverse())
      await fs.rename(path.join(backup, 'assets', id), path.join(base, id));
    manifest.status = 'rolled-back';
    await record();
    throw error;
  }
  return { ...plan, backup };
}

export async function restoreAssets(root, id) {
  root = path.resolve(root);
  if (!/^[\w-]+$/.test(id)) throw Error('Neplatné ID zálohy.');
  const backup = path.join(root, '.local-tools/asset-trash', id);
  if ((await fs.realpath(backup)) !== backup)
    throw Error('Záloha nesmí být symbolický odkaz.');
  const manifest = JSON.parse(
    await fs.readFile(path.join(backup, 'manifest.json'), 'utf8'),
  );
  if (
    manifest.version !== 1 ||
    manifest.status !== 'archived' ||
    !Array.isArray(manifest.groups)
  )
    throw Error('Neplatná nebo již obnovená záloha.');
  const seen = new Set();
  for (const g of manifest.groups) {
    if (typeof g.id !== 'string' || groupId(g.id) !== g.id || seen.has(g.id))
      throw Error('Neplatná cesta v záloze.');
    seen.add(g.id);
    if (await exists(path.join(root, 'src/assets', g.id)))
      throw Error(`Cíl již existuje, nic se nepřepíše: ${g.id}`);
    const source = path.join(backup, 'assets', g.id),
      stat = await fs.lstat(source);
    if (stat.isSymbolicLink()) throw Error('Záloha obsahuje symbolický odkaz.');
    if (stat.isDirectory()) await walk(source);
  }
  const restored = [];
  try {
    for (const g of manifest.groups) {
      const target = path.join(root, 'src/assets', g.id);
      await realDirectory(path.dirname(target));
      if (await exists(target)) throw Error(`Cíl mezitím vznikl: ${g.id}`);
      await fs.rename(path.join(backup, 'assets', g.id), target);
      restored.push(g.id);
    }
  } catch (error) {
    for (const id of restored.reverse())
      await fs.rename(
        path.join(root, 'src/assets', id),
        path.join(backup, 'assets', id),
      );
    throw error;
  }
  manifest.status = 'restored';
  await fs.writeFile(
    path.join(backup, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  return restored.length;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2),
      root = process.cwd();
    if (args.length === 2 && args[0] === '--restore')
      console.log(`Obnoveno generací: ${await restoreAssets(root, args[1])}`);
    else {
      if (args.length && (args.length !== 1 || args[0] !== '--apply'))
        throw Error(
          'Použij bez parametrů pro audit, --apply pro úklid nebo --restore ID.',
        );
      const plan =
        args[0] === '--apply'
          ? await cleanAssets(root)
          : await auditAssets(root);
      console.log(
        `${plan.remove.length} nepoužívaných generací/importů · ${plan.remove.reduce((n, g) => n + g.files.length, 0)} souborů · ${(plan.remove.reduce((n, g) => n + g.bytes, 0) / 1024 / 1024).toFixed(1)} MiB`,
      );
      for (const g of plan.remove) console.log(`  ${g.id}`);
      if (plan.backup)
        console.log(
          `Obnovitelná záloha: ${plan.backup}\nObnovení: npm run assets:clean -- --restore ${path.basename(plan.backup)}`,
        );
      else
        console.log(
          'Audit nic nemění. Úklid spusť s --apply; čerstvé generace jsou hodinu chráněné.',
        );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

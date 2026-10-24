import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { auditAssets, cleanAssets, restoreAssets } from './clean-assets.mjs';

const batch = (n) =>
  `scene-art/00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const empty = { scenes: [], items: [], dialogues: [] };
const options = { headProject: JSON.stringify(empty) };
async function fixture(run) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'tukabel-asset-cleanup-'));
  const write = async (id, value = 'original pixels', fresh = false) => {
    const file = path.join(root, 'src/assets', id);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, value);
    if (!fresh) {
      const old = new Date(Date.now() - 2 * 3600000);
      await fs.utimes(file, old, old);
    }
  };
  const project = async (value) =>
    fs.writeFile(
      path.join(root, 'src/game/content/project.json'),
      JSON.stringify({ ...empty, ...value }),
    );
  try {
    await fs.mkdir(path.join(root, 'src/game/content'), { recursive: true });
    await fs.mkdir(path.join(root, 'src/assets'), { recursive: true });
    await project({});
    await run({ root, write, project });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('audit follows working/HEAD/code references and transitive recipes, retaining complete batches and fresh previews', async () => {
  await fixture(async ({ root, write, project }) => {
    for (let i = 1; i <= 7; i++) await write(`${batch(i)}/image.png`);
    await write(
      `${batch(1)}/recipe.json`,
      JSON.stringify({ source: `${batch(2)}/image.png` }),
    );
    await write(
      `${batch(2)}/recipe.json`,
      JSON.stringify({ source: `${batch(3)}/image.png` }),
    );
    await write(`${batch(2)}/object-mask.png`);
    await write(`${batch(5)}/image.png`, 'unsaved preview', true);
    await write(
      `${batch(6)}/recipe.json`,
      JSON.stringify({ source: `${batch(7)}/image.png` }),
    );
    await write('imported/unused.png');
    await write('hand-painted-unused.svg');
    await project({ background: `${batch(1)}/image.png` });
    await fs.mkdir(path.join(root, 'tests'));
    await fs.writeFile(
      path.join(root, 'tests/fixture.ts'),
      `const file = path.join('src/assets/scene-art', '${path.basename(batch(4))}', 'image.png');`,
    );
    const report = await auditAssets(root, {
      headProject: JSON.stringify({
        ...empty,
        source: `${batch(7)}/image.png`,
      }),
    });
    assert.deepEqual(
      report.remove.map((g) => g.id).sort(),
      [batch(6), 'imported/unused.png'].sort(),
    );
    assert.ok(
      report.kept
        .find((g) => g.id === batch(2))
        .files.includes(`${batch(2)}/object-mask.png`),
    );
    assert.ok(
      await fs.readFile(path.join(root, 'src/assets/hand-painted-unused.svg')),
    );
    assert.ok(
      await fs.readFile(path.join(root, 'src/assets', batch(6), 'image.png')),
    );
  });
});

test('archive/restore preserves exact bytes and project, rejects target conflicts and is idempotent', async () => {
  await fixture(async ({ root, write, project }) => {
    await write(`${batch(1)}/image.png`, Buffer.from([0, 255, 32, 128]));
    await write(`${batch(1)}/recipe.json`, '{"source":"woman.png"}');
    await write('imported/old.png');
    await write('woman.png');
    await project({ image: 'woman.png' });
    const original = await fs.readFile(
      path.join(root, 'src/game/content/project.json'),
    );
    const report = await cleanAssets(root, options);
    assert.equal(report.remove.length, 2);
    assert.ok(
      report.backup.startsWith(path.join(root, '.local-tools/asset-trash/')),
    );
    await assert.rejects(
      fs.readFile(path.join(root, 'src/assets', batch(1), 'image.png')),
      { code: 'ENOENT' },
    );
    assert.deepEqual(
      await fs.readFile(
        path.join(report.backup, 'assets', batch(1), 'image.png'),
      ),
      Buffer.from([0, 255, 32, 128]),
    );
    assert.deepEqual(
      await fs.readFile(path.join(root, 'src/game/content/project.json')),
      original,
    );
    assert.equal((await cleanAssets(root, options)).backup, undefined);
    await write('imported/old.png', 'newer work', true);
    await assert.rejects(
      restoreAssets(root, path.basename(report.backup)),
      /Cíl již existuje/,
    );
    await assert.rejects(
      fs.readFile(path.join(root, 'src/assets', batch(1), 'image.png')),
      { code: 'ENOENT' },
    );
    await fs.unlink(path.join(root, 'src/assets/imported/old.png'));
    assert.equal(await restoreAssets(root, path.basename(report.backup)), 2);
    assert.deepEqual(
      await fs.readFile(path.join(root, 'src/assets', batch(1), 'image.png')),
      Buffer.from([0, 255, 32, 128]),
    );
    await assert.rejects(
      restoreAssets(root, path.basename(report.backup)),
      /již obnovená/,
    );
  });
});

test('author SVG dependencies and newly saved references are protected; symlinks and unsafe restore paths are refused', async () => {
  await fixture(async ({ root, write, project }) => {
    await write(`${batch(1)}/image.png`);
    await write(`${batch(2)}/image.png`);
    await write(
      'drawing.svg',
      `<svg><image href="${batch(1)}/image.png"/></svg>`,
    );
    assert.deepEqual(
      (await auditAssets(root, options)).remove.map((g) => g.id),
      [batch(2)],
    );
    await project({ image: `${batch(2)}/image.png` });
    const file = path.join(root, 'src/game/content/project.json');
    await fs.writeFile(
      file,
      (await fs.readFile(file, 'utf8')).replaceAll('/', '\\u002f'),
    );
    assert.equal((await cleanAssets(root, options)).backup, undefined);
    await fs.symlink(
      path.join(root, 'src/assets/drawing.svg'),
      path.join(root, 'src/assets/link.svg'),
    );
    await assert.rejects(cleanAssets(root, options), /symbolický odkaz/);
    await assert.rejects(restoreAssets(root, '../../outside'), /Neplatné ID/);
  });
});

test('an accidentally emptied project never authorizes removing all generated assets', async () => {
  await fixture(async ({ root, write }) => {
    await write(`${batch(1)}/image.png`);
    await fs.writeFile(path.join(root, 'src/game/content/project.json'), '{}');
    await assert.rejects(cleanAssets(root, options), /platné kolekce/);
    assert.equal(
      await fs.readFile(
        path.join(root, 'src/assets', batch(1), 'image.png'),
        'utf8',
      ),
      'original pixels',
    );
  });
});

import { expect, test } from '@playwright/test';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  symlink,
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import {
  createAnimationPlayer,
  frameAt,
  clipDuration,
} from '../src/game/animation';
import { isCharacterSpeaking } from '../src/game/animation';
import { validateProject } from '../src/game/validateProject';
import {
  importAnimation,
  validateAnimationAssets,
} from '../dev/animationImport';
import type { AnimationDefinition, GameContent } from '../src/game/types';

const clip = (
  id: string,
  kind: AnimationDefinition['kind'],
  frames: string[],
): AnimationDefinition => ({
  id,
  label: id,
  source: 'actor.png',
  kind,
  frames,
  fps: 10,
});
test('visual clocks prioritize speech, schedule finite blinks and hold once-only expressions', () => {
  const blink = clip('blink', 'blink', [
    'base',
    'half',
    'closed',
    'half',
    'base',
  ]);
  const talk = clip('talk', 'talk', ['mouth1', 'mouth2']);
  const player = createAnimationPlayer(
    { blink: 'blink', talk: 'talk', blinkIntervalMs: [100, 100] },
    [blink, talk],
    () => 0,
  );
  expect(player.tick(99, false).priority).toBe('base');
  expect(player.tick(1, false).priority).toBe('blink');
  expect(player.tick(100, false).frame).toBe('half');
  expect(player.tick(100, false).frame).toBe('closed');
  expect(player.tick(0, true)).toMatchObject({
    priority: 'talk',
    frame: 'mouth1',
  });
  expect(player.tick(100, true).frame).toBe('mouth2');
  expect(player.tick(0, false).priority).toBe('base');
  expect(player.tick(100, false).priority).toBe('blink');
  expect(player.tick(500, false).priority).toBe('base');
  const idle = clip('idle', 'expression', ['neutral', 'smile']);
  expect(frameAt(idle, 10000, false)).toBe('smile');
  expect(frameAt(idle, 10000, true)).toBe('neutral');
  const state = {
    sceneId: 'room',
    inventory: [],
    flags: {},
    message: '',
    dialogue: { id: 'conversation', nodeId: 'start' },
  };
  expect(
    isCharacterSpeaking(
      {
        id: 'npc',
        label: '',
        bounds: { x: 0, y: 0, width: 1, height: 1 },

        onClick: [
          {
            message: '',
            effects: [{ type: 'dialogue', id: 'conversation' }],
          },
        ],
      },
      state,
    ),
  ).toBe(true);
});

test('per-frame timing, speed, one-shots and priority share one visual clock', () => {
  const timed = {
    ...clip('timed', 'expression', ['open', 'half', 'closed']),
    durationsMs: [40, 60, 100],
    speed: 2,
    loop: false,
  };
  expect(clipDuration(timed)).toBe(100);
  expect(frameAt(timed, 19)).toBe('open');
  expect(frameAt(timed, 20)).toBe('half');
  expect(frameAt(timed, 50)).toBe('closed');
  expect(frameAt(timed, 100)).toBe('closed');
  expect(frameAt(timed, 100, true)).toBe('open');
  const talking = clip('talk', 'talk', ['mouth1', 'mouth2']);
  const player = createAnimationPlayer({ onClick: 'timed', talk: 'talk' }, [
    timed,
    talking,
  ]);
  player.trigger('click');
  expect(player.tick(0, false)).toMatchObject({
    priority: 'interaction',
    frame: 'open',
  });
  expect(player.tick(20, false).frame).toBe('half');
  expect(player.tick(80, false).priority).toBe('base');
  player.trigger('click');
  expect(player.tick(0, true).priority).toBe('talk');
  expect(player.tick(0, false).priority).toBe('base');
});

test('content validation rejects invalid frame timing and missing interaction clips', async () => {
  const project = JSON.parse(
    await readFile('src/game/content/project.json', 'utf8'),
  ) as GameContent;
  const source = 'woman.png';
  const animation = {
    ...clip('blink', 'blink', [source, source]),
    source,
    durationsMs: [50, 70],
  };
  const valid: GameContent = {
    ...project,
    animations: [animation],
    scenes: project.scenes.map((scene) => ({
      ...scene,
      hotspots: scene.hotspots.map((h) => ({ ...h, animation: undefined })),
    })),
  };
  expect(validateProject(valid)).toEqual([]);
  for (const patch of [
    { durationsMs: [10] },
    { durationsMs: [0, 50] },
    { durationsMs: [50, Infinity] },
    { speed: 0 },
    { speed: 5 },
    { loop: 'yes' },
    { generation: { provider: 'obsolete' } },
  ]) {
    expect(
      validateProject({ ...valid, animations: [{ ...animation, ...patch }] })
        .length,
    ).toBeGreaterThan(0);
  }
  const broken = {
    ...valid,
    scenes: valid.scenes.map((scene, sceneIndex) => ({
      ...scene,
      hotspots: scene.hotspots.map((hotspot, index) =>
        sceneIndex === 0 && index === 0
          ? { ...hotspot, animation: { onClick: 'missing' } }
          : hotspot,
      ),
    })),
  };
  expect(validateProject(broken).join('\n')).toContain('unknown reference');
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-sprite-unit-'));
  const original = await sharp({
    create: {
      width: 16,
      height: 24,
      channels: 4,
      background: { r: 80, g: 100, b: 150, alpha: 0.7 },
    },
  })
    .png()
    .toBuffer();
  await writeFile(path.join(root, 'actor.png'), original);
  const upload = (name: string, bytes: Buffer) => ({
    name,
    data: bytes.toString('base64'),
  });
  const input = {
    source: 'actor.png',
    label: 'Blink',
    kind: 'blink',
    fps: 14,
    files: [upload('frame-01.png', original), upload('frame-02.png', original)],
  };
  return { root, original, upload, input };
}

test('sequence import copies original bytes atomically and rejects bad canvases/traversal without publishing', async () => {
  const { root, original, input, upload } = await fixture();
  try {
    const result = await importAnimation(root, input);
    expect(result.frames).toHaveLength(2);
    expect(await readFile(path.join(root, result.frames[0]!))).toEqual(
      original,
    );
    const folders = await readdir(path.join(root, 'animations'));
    for (const patch of [
      { source: '../actor.png' },
      { files: [upload('bad.png', Buffer.from('invalid'))] },
      { files: [] },
      { fps: 120 },
      {
        files: [
          upload(
            'small.png',
            await sharp({
              create: { width: 2, height: 2, channels: 4, background: 'red' },
            })
              .png()
              .toBuffer(),
          ),
        ],
      },
    ]) {
      await expect(
        importAnimation(root, { ...input, ...patch }),
      ).rejects.toThrow();
      expect(await readdir(path.join(root, 'animations'))).toEqual(folders);
    }
    await symlink(path.join(root, 'actor.png'), path.join(root, 'alias.png'));
    await expect(
      importAnimation(root, { ...input, source: 'alias.png' }),
    ).rejects.toThrow('symbolické');
    const project = { animations: [result] };
    await validateAnimationAssets(root, project);
    await writeFile(
      path.join(root, result.frames[0]!),
      await sharp({
        create: { width: 2, height: 2, channels: 4, background: 'red' },
      })
        .png()
        .toBuffer(),
    );
    await expect(validateAnimationAssets(root, project)).rejects.toThrow(
      'plátno',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('trimmed atlas restores a fixed canvas and preserves declared order and durations', async () => {
  const { root, input, upload } = await fixture();
  try {
    const pixels = await sharp({
      create: { width: 6, height: 8, channels: 4, background: 'red' },
    })
      .png()
      .toBuffer();
    const entry = {
      frame: { x: 0, y: 0, w: 6, h: 8 },
      trimmed: true,
      spriteSourceSize: { x: 3, y: 5, w: 6, h: 8 },
      sourceSize: { w: 16, h: 24 },
      duration: 60,
    };
    const atlas = {
      frames: { a: entry, b: { ...entry, duration: 90 } },
      animations: { blink: ['b', 'a', 'b'] },
    };
    const result = await importAnimation(root, {
      ...input,
      files: [upload('sheet.png', pixels)],
      atlas,
    });
    expect(result.durationsMs).toEqual([90, 60, 90]);
    const { data, info } = await sharp(path.join(root, result.frames[0]!))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([16, 24]);
    expect([...data.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...data.subarray((5 * 16 + 3) * 4, (5 * 16 + 3) * 4 + 4)]).toEqual([
      255, 0, 0, 255,
    ]);
    const before = await readdir(path.join(root, 'animations'));
    for (const patch of [
      { rotated: true },
      { frame: { x: 999, y: 0, w: 6, h: 8 } },
      { sourceSize: { w: 17, h: 24 } },
      { duration: -1 },
    ])
      await expect(
        importAnimation(root, {
          ...input,
          files: [upload('sheet.png', pixels)],
          atlas: { frames: { a: { ...entry, ...patch } } },
        }),
      ).rejects.toThrow();
    expect(await readdir(path.join(root, 'animations'))).toEqual(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('real Codex blink atlas imports all five source-sized frames without pixel changes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tukabel-codex-blink-'));
  try {
    await writeFile(
      path.join(root, 'woman.png'),
      await readFile('src/assets/woman.png'),
    );
    const folder = 'experiments/woman-blink/output';
    const result = await importAnimation(root, {
      source: 'woman.png',
      label: 'Woman blink',
      kind: 'blink',
      fps: 14,
      files: [
        {
          name: 'spritesheet.png',
          data: (await readFile(`${folder}/spritesheet.png`)).toString(
            'base64',
          ),
        },
      ],
      atlas: JSON.parse(await readFile(`${folder}/spritesheet.json`, 'utf8')),
    });
    expect(result.frames).toHaveLength(5);
    expect(result.durationsMs).toEqual([1800, 60, 90, 80, 700]);
    for (let i = 0; i < 5; i++) {
      const actual = await sharp(path.join(root, result.frames[i]!))
        .ensureAlpha()
        .raw()
        .toBuffer();
      const expected = await sharp(`${folder}/frame-0${i + 1}.png`)
        .ensureAlpha()
        .raw()
        .toBuffer();
      expect(actual.equals(expected)).toBe(true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

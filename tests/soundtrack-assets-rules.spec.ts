import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { GameContent, Rule } from '../src/game/types';

const root = 'src/assets';
const prefix = 'soundtrack/elevenlabs-village-20261029';
const hash = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const project = async () =>
  JSON.parse(
    await readFile('src/game/content/project.json', 'utf8'),
  ) as GameContent;

test('the ElevenLabs score has seven distinct instrumental loops and eight bounded foley cues', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(root, prefix, 'manifest.json'), 'utf8'),
  ) as {
    complete: boolean;
    assets: {
      id: string;
      kind: 'music' | 'sfx';
      audio: string;
      source: string;
      record: string;
      sha256: string;
    }[];
  };
  expect(manifest.complete).toBe(true);
  expect(manifest.assets.filter((a) => a.kind === 'music')).toHaveLength(7);
  expect(manifest.assets.filter((a) => a.kind === 'sfx')).toHaveLength(8);
  expect(new Set(manifest.assets.map((a) => a.sha256)).size).toBe(15);
  for (const asset of manifest.assets) {
    const bytes = await readFile(path.join(root, asset.audio));
    const record = JSON.parse(
      await readFile(path.join(root, asset.record), 'utf8'),
    );
    expect(record.provider).toBe('ElevenLabs');
    expect(hash(bytes), asset.id).toBe(asset.sha256);
    expect(hash(await readFile(path.join(root, asset.source))), asset.id).toBe(
      record.providerSha256,
    );
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
    expect(bytes.subarray(8, 16).toString()).toBe('WAVEfmt ');
    expect(bytes.readUInt16LE(20)).toBe(1);
    expect(bytes.readUInt16LE(34)).toBe(16);
    const channels = bytes.readUInt16LE(22),
      rate = bytes.readUInt32LE(24);
    const size = bytes.readUInt32LE(40);
    expect([1, 2]).toContain(channels);
    expect(rate).toBe(44100);
    expect(bytes.length).toBe(size + 44);
    const seconds = size / (rate * channels * 2);
    expect(seconds).toBeCloseTo(record.seconds, 5);
    expect(seconds).toBeGreaterThanOrEqual(asset.kind === 'music' ? 15 : 0.2);
    expect(seconds).toBeLessThanOrEqual(asset.kind === 'music' ? 30 : 4);
    let power = 0,
      peak = 0,
      dc = 0;
    for (let i = 44; i < bytes.length; i += 2) {
      const sample = bytes.readInt16LE(i) / 32768;
      peak = Math.max(peak, Math.abs(sample));
      power += sample * sample;
      dc += sample;
    }
    const count = size / 2,
      rms = Math.sqrt(power / count);
    expect(peak, asset.id).toBeGreaterThan(0.1);
    expect(peak, asset.id).toBeLessThan(0.75);
    expect(Math.abs(dc / count), asset.id).toBeLessThan(0.01);
    expect(rms, asset.id).toBeGreaterThan(0.01);
    if (asset.kind === 'music') {
      expect(record.request.force_instrumental).toBe(true);
      expect(record.request.model_id).toBe('music_v2_5');
      expect(20 * Math.log10(rms), asset.id).toBeGreaterThan(-24);
      expect(20 * Math.log10(rms), asset.id).toBeLessThan(-15);
      for (let channel = 0; channel < channels; channel++) {
        const first = bytes.readInt16LE(44 + channel * 2) / 32768;
        const last =
          bytes.readInt16LE(bytes.length - channels * 2 + channel * 2) / 32768;
        expect(Math.abs(first - last), asset.id).toBeLessThan(0.04);
      }
    } else {
      expect(record.request.model_id).toBe('eleven_text_to_sound_v2');
      for (let channel = 0; channel < channels; channel++) {
        expect(bytes.readInt16LE(44 + channel * 2), asset.id).toBe(0);
        expect(
          bytes.readInt16LE(bytes.length - channels * 2 + channel * 2),
          asset.id,
        ).toBe(0);
      }
    }
  }
});

test('every location has local music, ambience stays separate, and sparse cues match puzzle events', async () => {
  const content = await project();
  const rules: Rule[] = [];
  for (const scene of content.scenes) {
    expect(scene.music, scene.id).toMatch(
      /^soundtrack\/elevenlabs-village-20261029\/music-[a-z]+\.wav$/,
    );
    expect(scene.ambient, scene.id).toMatch(/^ambience\//);
    await readFile(path.join(root, scene.music!));
    for (const hotspot of scene.hotspots)
      rules.push(
        ...hotspot.onClick,
        ...Object.values(hotspot.uses ?? {}).flat(),
      );
  }
  for (const combination of content.combinations)
    rules.push(...combination.rules);
  const cues = rules.filter((r) => r.sound);
  expect(cues.length).toBeGreaterThanOrEqual(12);
  expect(cues.length).toBeLessThanOrEqual(24);
  for (const rule of cues) {
    expect(rule.sound).toMatch(
      /^soundtrack\/elevenlabs-village-20261029\/sfx-[a-z]+\.wav$/,
    );
    await readFile(path.join(root, rule.sound!));
    expect(rule.effects?.length, rule.sound).toBeGreaterThan(0);
  }
  const electrical = cues.filter((r) => r.sound?.endsWith('sfx-jackpot.wav'));
  expect(electrical).toHaveLength(1);
  expect(electrical[0]!.effects).toContainEqual({
    type: 'flag',
    id: 'ending-jackpot',
    value: true,
  });
  expect(electrical[0]!.when).toEqual({ not: { flag: 'cable-recovered' } });
});

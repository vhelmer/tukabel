import type { GameContent } from './types.ts';
import { validateContent } from './validateContent.ts';

const verbs = ['look', 'take', 'talk', 'use'];
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// JSON is untrusted at both the browser and development-server boundary.
// Validate shape first so semantic validation and the reducer never see partial data.
export function validateProject(
  value: unknown,
  assets?: readonly string[],
): string[] {
  const errors: string[] = [];
  function object(
    input: unknown,
    path: string,
    keys: readonly string[],
  ): input is Record<string, unknown> {
    if (!isObject(input)) {
      errors.push(`${path}: expected object`);
      return false;
    }
    for (const key of Object.keys(input))
      if (!keys.includes(key)) errors.push(`${path}: unknown field ${key}`);
    return true;
  }
  function string(input: unknown, path: string) {
    if (typeof input !== 'string') errors.push(`${path}: expected string`);
  }
  function list(
    input: unknown,
    path: string,
    check: (entry: unknown, path: string) => void,
  ) {
    if (!Array.isArray(input)) {
      errors.push(`${path}: expected array`);
      return;
    }
    input.forEach((entry, index) => check(entry, `${path}[${index}]`));
  }
  function number(input: unknown, path: string) {
    if (typeof input !== 'number' || !Number.isFinite(input))
      errors.push(`${path}: expected finite number`);
  }
  function optionalString(
    input: Record<string, unknown>,
    key: string,
    path: string,
  ) {
    if (input[key] !== undefined) string(input[key], `${path}.${key}`);
  }
  function condition(input: unknown, path: string, depth = 0): void {
    if (input === undefined) return;
    if (depth > 12) {
      errors.push(`${path}: condition too deep`);
      return;
    }
    if (!object(input, path, ['flag', 'value', 'item', 'all', 'not'])) return;
    if (
      ['flag', 'item', 'all', 'not'].filter((key) => key in input).length !==
        1 ||
      ('value' in input && !('flag' in input))
    ) {
      errors.push(`${path}: expected one condition operator`);
      return;
    }
    if ('flag' in input) {
      string(input.flag, `${path}.flag`);
      if (input.value !== undefined && typeof input.value !== 'boolean')
        errors.push(`${path}.value: expected boolean`);
    } else if ('item' in input) string(input.item, `${path}.item`);
    else if ('all' in input)
      list(input.all, path, (child, key) => condition(child, key, depth + 1));
    else condition(input.not ?? null, path, depth + 1);
  }
  function effects(input: unknown, path: string) {
    if (input === undefined) return;
    list(input, path, (entry, key) => {
      if (!object(entry, key, ['type', 'id', 'value'])) return;
      string(entry.id, `${key}.id`);
      if (
        !['flag', 'addItem', 'removeItem', 'scene', 'dialogue'].includes(
          String(entry.type),
        )
      )
        errors.push(`${key}: unknown effect`);
      if (
        entry.type === 'flag'
          ? typeof entry.value !== 'boolean'
          : entry.value !== undefined
      )
        errors.push(`${key}: invalid effect value`);
    });
  }
  function rules(input: unknown, path: string) {
    list(input, path, (entry, key) => {
      if (!object(entry, key, ['when', 'message', 'effects'])) return;
      string(entry.message, `${key}.message`);
      condition(entry.when, `${key}.when`);
      effects(entry.effects, `${key}.effects`);
    });
  }
  function asset(input: unknown, path: string, optional = false) {
    if (input === undefined && optional) return;
    if (
      typeof input !== 'string' ||
      !/^[a-zA-Z0-9_/-]+\.(svg|png|jpe?g|webp|avif)$/.test(input) ||
      input.split('/').includes('..')
    )
      errors.push(`${path}: expected local image asset ID`);
    else if (assets && !assets.includes(input))
      errors.push(`${path}: missing asset "${input}"`);
  }
  if (
    !object(value, 'project', [
      'id',
      'startScene',
      'initialMessage',
      'flags',
      'scenes',
      'items',
      'dialogues',
      'combinations',
      'animations',
    ])
  )
    return errors;
  for (const key of ['id', 'startScene', 'initialMessage'])
    string(value[key], key);
  list(value.flags, 'flags', string);
  list(value.scenes, 'scenes', (scene, path) => {
    if (
      !object(scene, path, [
        'id',
        'title',
        'width',
        'height',
        'background',
        'hotspots',
      ])
    )
      return;
    string(scene.id, `${path}.id`);
    string(scene.title, `${path}.title`);
    number(scene.width, `${path}.width`);
    number(scene.height, `${path}.height`);
    asset(scene.background, `${path}.background`);
    list(scene.hotspots, `${path}.hotspots`, (hotspot, key) => {
      if (
        !object(hotspot, key, [
          'id',
          'label',
          'bounds',
          'visibleWhen',
          'defaultVerb',
          'actions',
          'uses',
          'image',
          'tintWhen',
          'animation',
        ])
      )
        return;
      string(hotspot.id, `${key}.id`);
      string(hotspot.label, `${key}.label`);
      if (
        object(hotspot.bounds, `${key}.bounds`, ['x', 'y', 'width', 'height'])
      )
        for (const field of ['x', 'y', 'width', 'height'])
          number(hotspot.bounds[field], `${key}.${field}`);
      if (
        hotspot.animation !== undefined &&
        object(hotspot.animation, `${key}.animation`, [
          'idle',
          'idleLoop',
          'blink',
          'blinkIntervalMs',
          'talk',
          'dialogueId',
          'motion',
        ])
      ) {
        const binding = hotspot.animation;
        for (const field of ['idle', 'blink', 'talk', 'dialogueId'])
          optionalString(binding, field, `${key}.animation`);
        if (
          binding.idleLoop !== undefined &&
          typeof binding.idleLoop !== 'boolean'
        )
          errors.push(`${key}: idleLoop must be boolean`);
        if (
          binding.motion !== undefined &&
          !['breath', 'sway'].includes(String(binding.motion))
        )
          errors.push(`${key}: invalid motion`);
        if (binding.blinkIntervalMs !== undefined) {
          const interval = binding.blinkIntervalMs;
          if (
            !Array.isArray(interval) ||
            interval.length !== 2 ||
            !interval.every(
              (entry) => typeof entry === 'number' && Number.isFinite(entry),
            ) ||
            interval[0] < 100 ||
            interval[1] < interval[0] ||
            interval[1] > 120000
          )
            errors.push(
              `${key}: blink interval must be [min, max] in 100–120000 ms`,
            );
        }
      }
      condition(hotspot.visibleWhen, `${key}.visibleWhen`);
      condition(hotspot.tintWhen, `${key}.tintWhen`);
      asset(hotspot.image, `${key}.image`, true);
      if (!verbs.includes(String(hotspot.defaultVerb)))
        errors.push(`${key}: invalid default verb`);
      if (object(hotspot.actions, `${key}.actions`, verbs))
        Object.entries(hotspot.actions).forEach(([verb, entries]) =>
          rules(entries, `${key}/${verb}`),
        );
      if (hotspot.uses !== undefined && isObject(hotspot.uses))
        Object.entries(hotspot.uses).forEach(([id, entries]) =>
          rules(entries, `${key}/uses/${id}`),
        );
      else if (hotspot.uses !== undefined)
        errors.push(`${key}.uses: expected object`);
    });
  });
  if (value.animations !== undefined)
    list(value.animations, 'animations', (animation, path) => {
      if (
        !object(animation, path, [
          'id',
          'label',
          'source',
          'kind',
          'frames',
          'fps',
          'generation',
        ])
      )
        return;
      string(animation.id, `${path}.id`);
      string(animation.label, `${path}.label`);
      asset(animation.source, `${path}.source`);
      if (
        !['blink', 'talk', 'expression', 'idle'].includes(
          String(animation.kind),
        )
      )
        errors.push(`${path}: invalid animation kind`);
      list(animation.frames, `${path}.frames`, (frame, key) =>
        asset(frame, key),
      );
      number(animation.fps, `${path}.fps`);
      if (
        animation.generation !== undefined &&
        object(animation.generation, `${path}.generation`, [
          'prompt',
          'model',
          'quality',
          'mode',
          'region',
          'sourceHash',
        ])
      ) {
        const generation = animation.generation;
        string(generation.prompt, `${path}.prompt`);
        string(generation.model, `${path}.model`);
        if (!['low', 'medium', 'high'].includes(String(generation.quality)))
          errors.push(`${path}: invalid quality`);
        if (!['region', 'full'].includes(String(generation.mode)))
          errors.push(`${path}: invalid edit mode`);
        if (
          typeof generation.sourceHash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(generation.sourceHash)
        )
          errors.push(`${path}: invalid source hash`);
        if (generation.mode === 'region' && generation.region === undefined)
          errors.push(`${path}: local edit requires region`);
        if (
          generation.region !== undefined &&
          object(generation.region, `${path}.region`, [
            'x',
            'y',
            'width',
            'height',
          ])
        ) {
          for (const key of ['x', 'y', 'width', 'height'])
            number(generation.region[key], `${path}.region.${key}`);
          if (
            !Object.values(generation.region).every(
              (entry) =>
                typeof entry === 'number' &&
                Number.isInteger(entry) &&
                entry >= 0,
            ) ||
            Number(generation.region.width) < 1 ||
            Number(generation.region.height) < 1
          )
            errors.push(`${path}: invalid pixel region`);
        }
      }
    });
  list(value.items, 'items', (item, path) => {
    if (!object(item, path, ['id', 'label', 'description', 'icon', 'image']))
      return;
    for (const key of ['id', 'label', 'description', 'icon'])
      string(item[key], `${path}.${key}`);
    asset(item.image, `${path}.image`, true);
  });
  list(value.dialogues, 'dialogues', (dialogue, path) => {
    if (!object(dialogue, path, ['id', 'start', 'nodes'])) return;
    string(dialogue.id, `${path}.id`);
    string(dialogue.start, `${path}.start`);
    list(dialogue.nodes, `${path}.nodes`, (node, key) => {
      if (!object(node, key, ['id', 'speaker', 'text', 'choices'])) return;
      for (const field of ['id', 'speaker', 'text'])
        string(node[field], `${key}.${field}`);
      list(node.choices, `${key}.choices`, (choice, choicePath) => {
        if (
          !object(choice, choicePath, [
            'id',
            'text',
            'when',
            'effects',
            'next',
            'message',
          ])
        )
          return;
        string(choice.id, `${choicePath}.id`);
        string(choice.text, `${choicePath}.text`);
        optionalString(choice, 'next', choicePath);
        optionalString(choice, 'message', choicePath);
        condition(choice.when, `${choicePath}.when`);
        effects(choice.effects, `${choicePath}.effects`);
      });
    });
  });
  list(value.combinations, 'combinations', (entry, path) => {
    if (!object(entry, path, ['items', 'rules'])) return;
    list(entry.items, `${path}.items`, string);
    if (!Array.isArray(entry.items) || entry.items.length !== 2)
      errors.push(`${path}: expected two ingredients`);
    rules(entry.rules, `${path}.rules`);
  });
  if (errors.length) return errors;
  const content = value as unknown as GameContent;
  errors.push(...validateContent(content));
  for (const id of [
    content.id,
    ...content.flags,
    ...(content.animations ?? []).map((animation) => animation.id),
    ...content.items.map((item) => item.id),
    ...content.scenes.flatMap((scene) => [
      scene.id,
      ...scene.hotspots.map((hotspot) => hotspot.id),
    ]),
    ...content.dialogues.flatMap((dialogue) => [
      dialogue.id,
      ...dialogue.nodes.flatMap((node) => [
        node.id,
        ...node.choices.map((choice) => choice.id),
      ]),
    ]),
  ]) {
    if (
      !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id) ||
      ['__proto__', 'constructor', 'prototype'].includes(id)
    )
      errors.push(`Invalid stable ID "${id}"`);
  }
  return errors;
}

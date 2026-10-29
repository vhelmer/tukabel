import type { GameContent } from './types.ts';
import { voiceIssue, mouthShapes } from './speech.ts';
import { validateContent } from './validateContent.ts';
import { subtitleTrackIssue } from './subtitles.ts';

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
        ![
          'flag',
          'addItem',
          'removeItem',
          'scene',
          'unlockScene',
          'dialogue',
          'startTask',
          'completeTask',
        ].includes(String(entry.type))
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
      optionalString(entry, 'message', key);
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
      'startDialogue',
      'endings',
      'initialMessage',
      'flags',
      'scenes',
      'items',
      'dialogues',
      'combinations',
      'animations',
      'tasks',
      'worldMap',
    ])
  )
    return errors;
  for (const key of ['id', 'startScene', 'initialMessage'])
    string(value[key], key);
  optionalString(value, 'startDialogue', 'project');
  function ambient(input: unknown, path: string) {
    if (input === undefined) return;
    if (
      typeof input !== 'string' ||
      !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.wav$/.test(input)
    )
      errors.push(`${path}: expected local WAV asset ID`);
    else if (assets && !assets.includes(input))
      errors.push(`${path}: missing asset "${input}"`);
  }
  if (value.endings !== undefined)
    list(value.endings, 'endings', (ending, path) => {
      if (!object(ending, path, ['id', 'when', 'title', 'text', 'ambient']))
        return;
      for (const key of ['id', 'title', 'text']) {
        string(ending[key], `${path}.${key}`);
        if (
          typeof ending[key] === 'string' &&
          (!ending[key].trim() || ending[key].length > 4000)
        )
          errors.push(`${path}.${key}: expected 1–4000 characters`);
      }
      if (ending.when === undefined)
        errors.push(`${path}.when: expected condition`);
      condition(ending.when, `${path}.when`);
      ambient(ending.ambient, `${path}.ambient`);
    });
  list(value.flags, 'flags', string);
  if (
    value.worldMap !== undefined &&
    object(value.worldMap, 'worldMap', ['image', 'width', 'height', 'points'])
  ) {
    const map = value.worldMap;
    asset(map.image, 'worldMap.image');
    if (
      typeof map.image === 'string' &&
      map.image
        .split('/')
        .some((part) => !part || part === '.' || part === '..')
    )
      errors.push('worldMap.image: expected relative local image asset ID');
    number(map.width, 'worldMap.width');
    number(map.height, 'worldMap.height');
    list(map.points, 'worldMap.points', (point, path) => {
      if (
        !object(point, path, [
          'id',
          'label',
          'sceneId',
          'x',
          'y',
          'unlockWhen',
          'fastTravel',
          'polygon',
        ])
      )
        return;
      for (const key of ['id', 'label', 'sceneId'])
        string(point[key], `${path}.${key}`);
      number(point.x, `${path}.x`);
      number(point.y, `${path}.y`);
      if (point.polygon !== undefined)
        list(point.polygon, `${path}.polygon`, (vertex, key) => {
          if (object(vertex, key, ['x', 'y'])) {
            number(vertex.x, `${key}.x`);
            number(vertex.y, `${key}.y`);
          }
        });
      condition(point.unlockWhen, `${path}.unlockWhen`);
      if (
        point.fastTravel !== undefined &&
        typeof point.fastTravel !== 'boolean'
      )
        errors.push(`${path}.fastTravel: expected boolean`);
    });
  }
  if (value.tasks !== undefined)
    list(value.tasks, 'tasks', (task, path) => {
      if (!object(task, path, ['id', 'text', 'startWhen', 'completeWhen']))
        return;
      string(task.id, path + '.id');
      string(task.text, path + '.text');
      if (
        typeof task.text === 'string' &&
        (!task.text.trim() || task.text.length > 500)
      )
        errors.push(path + ': task text must contain 1–500 characters');
      condition(task.startWhen, path + '.startWhen');
      condition(task.completeWhen, path + '.completeWhen');
    });
  list(value.scenes, 'scenes', (scene, path) => {
    if (
      !object(scene, path, [
        'id',
        'title',
        'width',
        'height',
        'background',
        'backgroundHidden',
        'ambient',
        'hotspots',
      ])
    )
      return;
    string(scene.id, `${path}.id`);
    string(scene.title, `${path}.title`);
    number(scene.width, `${path}.width`);
    number(scene.height, `${path}.height`);
    asset(scene.background, `${path}.background`);
    ambient(scene.ambient, `${path}.ambient`);
    if (
      scene.backgroundHidden !== undefined &&
      typeof scene.backgroundHidden !== 'boolean'
    )
      errors.push(`${path}: backgroundHidden must be boolean`);
    list(scene.hotspots, `${path}.hotspots`, (hotspot, key) => {
      if (
        !object(hotspot, key, [
          'id',
          'label',
          'decorative',
          'hidden',
          'locked',
          'opacity',
          'bounds',
          'polygon',
          'visibleWhen',
          'onClick',
          'openMap',
          'cursor',
          'cursorImage',
          'cursorAnimation',
          'cursorSize',
          'cursorOffset',
          'uses',
          'image',
          'placeholder',
          'rotation',
          'imageFit',
          'hitTest',
          'alphaThreshold',
          'tintWhen',
          'animation',
        ])
      )
        return;
      string(hotspot.id, `${key}.id`);
      string(hotspot.label, `${key}.label`);
      for (const field of [
        'decorative',
        'hidden',
        'locked',
        'openMap',
        'placeholder',
      ])
        if (hotspot[field] !== undefined && typeof hotspot[field] !== 'boolean')
          errors.push(`${key}.${field}: expected boolean`);
      if (hotspot.opacity !== undefined) {
        number(hotspot.opacity, `${key}.opacity`);
        if (Number(hotspot.opacity) < 0 || Number(hotspot.opacity) > 1)
          errors.push(`${key}: opacity must be within 0–1`);
      }
      if (hotspot.decorative && !hotspot.image)
        errors.push(`${key}: decorative layer needs an image`);
      if (hotspot.polygon !== undefined)
        list(hotspot.polygon, `${key}.polygon`, (point, path) => {
          if (object(point, path, ['x', 'y'])) {
            number(point.x, `${path}.x`);
            number(point.y, `${path}.y`);
          }
        });
      if (hotspot.rotation !== undefined) {
        number(hotspot.rotation, `${key}.rotation`);
        if (Number(hotspot.rotation) < -360 || Number(hotspot.rotation) > 360)
          errors.push(`${key}: rotation must be within -360–360 degrees`);
      }
      if (
        hotspot.imageFit !== undefined &&
        !['contain', 'stretch'].includes(String(hotspot.imageFit))
      )
        errors.push(`${key}: imageFit must be contain or stretch`);
      if (
        hotspot.hitTest !== undefined &&
        !['alpha', 'bounds'].includes(String(hotspot.hitTest))
      )
        errors.push(`${key}: hitTest must be alpha or bounds`);
      if (
        hotspot.alphaThreshold !== undefined &&
        (!Number.isInteger(hotspot.alphaThreshold) ||
          Number(hotspot.alphaThreshold) < 1 ||
          Number(hotspot.alphaThreshold) > 255)
      )
        errors.push(`${key}: alphaThreshold must be an integer within 1–255`);
      if (
        object(hotspot.bounds, `${key}.bounds`, ['x', 'y', 'width', 'height'])
      )
        for (const field of ['x', 'y', 'width', 'height'])
          number(hotspot.bounds[field], `${key}.${field}`);
      if (
        hotspot.animation !== undefined &&
        object(hotspot.animation, `${key}.animation`, [
          'voice',
          'mouthShapes',
          'idle',
          'idleLoop',
          'blink',
          'blinkIntervalMs',
          'gesture',
          'gestureIntervalMs',
          'talk',
          'dialogueId',
          'motion',
          'onClick',
          'onUse',
        ])
      ) {
        const binding = hotspot.animation;
        if (binding.voice !== undefined) {
          if (
            object(binding.voice, `${key}.animation.voice`, [
              'voiceId',
              'designRegistration',
              'designPrompt',
              'slot',
              'retired',
              'retirementManifest',
              'modelId',
              'stability',
              'similarityBoost',
              'style',
              'speed',
              'useSpeakerBoost',
            ])
          ) {
            const issue = voiceIssue(binding.voice);
            if (issue) errors.push(`${key}: ${issue}`);
          }
        }
        if (
          binding.mouthShapes !== undefined &&
          object(
            binding.mouthShapes,
            `${key}.animation.mouthShapes`,
            mouthShapes,
          )
        ) {
          for (const index of Object.values(binding.mouthShapes))
            if (!Number.isSafeInteger(index) || Number(index) < 0)
              errors.push(
                `${key}: mouth shape must be a zero-based frame index`,
              );
        }
        for (const field of [
          'idle',
          'blink',
          'talk',
          'dialogueId',
          'gesture',
          'onClick',
          'onUse',
        ])
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
        for (const field of ['blinkIntervalMs', 'gestureIntervalMs']) {
          if (binding[field] === undefined) continue;
          const interval = binding[field];
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
              `${key}: ${field} interval must be [min, max] in 100–120000 ms`,
            );
        }
      }
      condition(hotspot.visibleWhen, `${key}.visibleWhen`);
      condition(hotspot.tintWhen, `${key}.tintWhen`);
      asset(hotspot.image, `${key}.image`, true);
      rules(hotspot.onClick, `${key}/onClick`);
      asset(hotspot.cursorImage, `${key}.cursorImage`, true);
      optionalString(hotspot, 'cursorAnimation', key);
      if (
        hotspot.cursor !== undefined &&
        !['auto', 'interact', 'talk', 'exit'].includes(String(hotspot.cursor))
      )
        errors.push(`${key}: invalid cursor`);
      if (
        hotspot.cursorSize !== undefined &&
        (typeof hotspot.cursorSize !== 'number' ||
          !Number.isFinite(hotspot.cursorSize) ||
          hotspot.cursorSize < 16 ||
          hotspot.cursorSize > 96)
      )
        errors.push(`${key}: cursorSize must be 16–96`);
      if (
        hotspot.cursorOffset !== undefined &&
        (!Array.isArray(hotspot.cursorOffset) ||
          hotspot.cursorOffset.length !== 2 ||
          !hotspot.cursorOffset.every(
            (n) =>
              typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 96,
          ))
      )
        errors.push(`${key}: cursorOffset must be two numbers in 0–96`);
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
          'durationsMs',
          'region',
          'speed',
          'loop',
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
        animation.region !== undefined &&
        object(animation.region, `${path}.region`, [
          'x',
          'y',
          'width',
          'height',
        ])
      )
        for (const key of ['x', 'y', 'width', 'height'])
          number(animation.region[key], `${path}.region.${key}`);
      if (animation.durationsMs !== undefined)
        list(animation.durationsMs, `${path}.durationsMs`, number);
      if (animation.speed !== undefined)
        number(animation.speed, `${path}.speed`);
      if (animation.loop !== undefined && typeof animation.loop !== 'boolean')
        errors.push(`${path}.loop: expected boolean`);
    });
  list(value.items, 'items', (item, path) => {
    if (!object(item, path, ['id', 'label', 'description', 'icon', 'image']))
      return;
    for (const key of ['id', 'label', 'description', 'icon'])
      string(item[key], `${path}.${key}`);
    asset(item.image, `${path}.image`, true);
  });
  list(value.dialogues, 'dialogues', (dialogue, path) => {
    if (!object(dialogue, path, ['id', 'start', 'entry', 'nodes'])) return;
    string(dialogue.id, `${path}.id`);
    string(dialogue.start, `${path}.start`);
    if (
      dialogue.entry !== undefined &&
      !['choices', 'speech'].includes(String(dialogue.entry))
    )
      errors.push(`${path}.entry: expected choices or speech`);
    list(dialogue.nodes, `${path}.nodes`, (node, key) => {
      if (
        !object(node, key, [
          'id',
          'speaker',
          'text',
          'choices',
          'portrait',
          'actor',
          'speech',
          'subtitle',
        ])
      )
        return;
      for (const field of ['id', 'speaker', 'text'])
        string(node[field], `${key}.${field}`);
      optionalString(node, 'subtitle', key);
      if (typeof node.subtitle === 'string' && node.subtitle.length > 10000)
        errors.push(`${key}.subtitle: text too long`);
      asset(node.portrait, `${key}.portrait`, true);
      if (
        node.actor !== undefined &&
        object(node.actor, `${key}.actor`, ['sceneId', 'hotspotId'])
      ) {
        string(node.actor.sceneId, `${key}.actor.sceneId`);
        string(node.actor.hotspotId, `${key}.actor.hotspotId`);
      }
      if (
        node.speech !== undefined &&
        object(node.speech, `${key}.speech`, [
          'audio',
          'lipSync',
          'text',
          'alignment',
          'subtitles',
        ])
      ) {
        string(node.speech.text, `${key}.speech.text`);
        if (node.speech.subtitles !== undefined) {
          const issue = subtitleTrackIssue(node.speech.subtitles);
          if (issue) errors.push(`${key}.speech.subtitles: ${issue}`);
        }
        for (const field of ['audio', 'lipSync', 'alignment']) {
          const id = node.speech[field];
          if (field !== 'audio' && id === undefined) continue;
          if (
            typeof id !== 'string' ||
            !/^[a-zA-Z0-9_./-]+$/.test(id) ||
            id.split('/').some((s) => !s || s === '..' || s === '.') ||
            !(field === 'audio'
              ? id.endsWith('.wav')
              : field === 'lipSync'
                ? id.endsWith('.lipsync.json')
                : id.endsWith('/alignment.json'))
          )
            errors.push(
              `${key}.speech.${field}: expected local ${field} asset`,
            );
          else if (assets && !assets.includes(id))
            errors.push(`${key}.speech.${field}: missing asset "${id}"`);
        }
      }
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
    ...(content.endings ?? []).map((ending) => ending.id),
    ...(content.worldMap?.points ?? []).map((point) => point.id),
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

import type { Condition, Effect, GameContent, Rule } from './types.ts';
import { polygonIssue } from './polygon.ts';
import { isInsideScene } from './transforms.ts';

// TypeScript checks data shape; this pass checks references and authoring mistakes.
export function validateContent(content: GameContent): string[] {
  const errors: string[] = [];
  const collect = (ids: readonly string[], path: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (!id.trim() || seen.has(id))
        errors.push(`${path}: empty or duplicate id "${id}"`);
      seen.add(id);
    }
    return seen;
  };
  const scenes = collect(
    content.scenes.map((entry) => entry.id),
    'scenes',
  );
  const items = collect(
    content.items.map((entry) => entry.id),
    'items',
  );
  const flags = collect(content.flags, 'flags');
  const tasks = collect(
    (content.tasks ?? []).map((task) => task.id),
    'tasks',
  );
  for (const id of tasks)
    if (
      !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id) ||
      ['constructor', 'prototype'].includes(id)
    )
      errors.push('tasks: invalid stable id "' + id + '"');
  const dialogues = collect(
    content.dialogues.map((entry) => entry.id),
    'dialogues',
  );
  const minigames = collect(
    (content.minigames ?? []).map((entry) => entry.id),
    'minigames',
  );
  const animations = collect(
    (content.animations ?? []).map((animation) => animation.id),
    'animations',
  );
  const reference = (set: Set<string>, id: string, path: string) => {
    if (!set.has(id)) errors.push(`${path}: unknown reference "${id}"`);
  };
  const condition = (value: Condition | undefined, path: string): void => {
    if (!value) return;
    if ('flag' in value) reference(flags, value.flag, path);
    else if ('item' in value) reference(items, value.item, path);
    else if ('all' in value)
      value.all.forEach((child) => condition(child, path));
    else condition(value.not, path);
  };
  const effects = (values: readonly Effect[] | undefined, path: string) => {
    for (const effect of values ?? []) {
      reference(
        effect.type === 'flag'
          ? flags
          : effect.type === 'scene' || effect.type === 'unlockScene'
            ? scenes
            : effect.type === 'dialogue'
              ? dialogues
              : effect.type === 'startTask' || effect.type === 'completeTask'
                ? tasks
                : effect.type === 'minigame'
                  ? minigames
                  : items,
        effect.id,
        path,
      );
    }
  };
  const rules = (values: readonly Rule[], path: string) => {
    if (!values.length) errors.push(`${path}: empty rules`);
    values.forEach((rule, index) => {
      if (index < values.length - 1 && !rule.when)
        errors.push(`${path}: unconditional rule shadows later rules`);
      condition(rule.when, path);
      effects(rule.effects, path);
    });
  };
  for (const game of content.minigames ?? [])
    reference(flags, game.winFlag, `minigames/${game.id}.winFlag`);
  reference(scenes, content.startScene, 'startScene');
  if (content.startDialogue !== undefined)
    reference(dialogues, content.startDialogue, 'startDialogue');
  collect(
    (content.endings ?? []).map((ending) => ending.id),
    'endings',
  );
  for (const ending of content.endings ?? [])
    condition(ending.when, 'endings/' + ending.id);
  if (content.worldMap) {
    const map = content.worldMap;
    if (
      ![map.width, map.height].every(
        (value) => Number.isFinite(value) && value > 0,
      )
    )
      errors.push('worldMap: invalid dimensions');
    collect(
      map.points.map((point) => point.id),
      'worldMap.points',
    );
    collect(
      map.points.map((point) => point.sceneId),
      'worldMap destinations',
    );
    for (const point of map.points) {
      const path = `worldMap/${point.id}`;
      if (
        !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(point.id) ||
        ['__proto__', 'constructor', 'prototype'].includes(point.id)
      )
        errors.push(`${path}: invalid stable id`);
      if (!point.label.trim()) errors.push(`${path}: empty label`);
      reference(scenes, point.sceneId, path);
      if (
        ![point.x, point.y].every(Number.isFinite) ||
        point.x < 0 ||
        point.y < 0 ||
        point.x > map.width ||
        point.y > map.height
      )
        errors.push(`${path}: point outside map`);
      if (point.polygon) {
        const issue = polygonIssue(point.polygon);
        if (issue)
          errors.push(
            `${path}: invalid polygon (${issue}); use 3–128 distinct vertices without self-intersections`,
          );
        if (
          point.polygon.some(
            (vertex) =>
              !Number.isFinite(vertex.x) ||
              !Number.isFinite(vertex.y) ||
              vertex.x < 0 ||
              vertex.y < 0 ||
              vertex.x > map.width ||
              vertex.y > map.height,
          )
        )
          errors.push(`${path}: polygon vertex outside map`);
      }
      condition(point.unlockWhen, `${path}/unlockWhen`);
    }
  }
  for (const task of content.tasks ?? []) {
    condition(task.startWhen, 'tasks/' + task.id + '/start');
    condition(task.completeWhen, 'tasks/' + task.id + '/complete');
  }
  for (const scene of content.scenes) {
    if (
      ![scene.width, scene.height].every(
        (value) => Number.isFinite(value) && value > 0,
      )
    )
      errors.push(`${scene.id}: invalid dimensions`);
    collect(
      scene.hotspots.map((entry) => entry.id),
      scene.id,
    );
    for (const hotspot of scene.hotspots) {
      const path = `${scene.id}/${hotspot.id}`;
      if (hotspot.openMap && hotspot.decorative)
        errors.push(`${path}: openMap requires an interactive hotspot`);
      const { x, y, width, height } = hotspot.bounds;
      if (
        ![x, y, width, height].every(Number.isFinite) ||
        x < 0 ||
        y < 0 ||
        width <= 0 ||
        height <= 0 ||
        x + width > scene.width ||
        y + height > scene.height
      )
        errors.push(`${path}: bounds outside scene`);
      else if (!isInsideScene(hotspot.bounds, scene, hotspot.rotation))
        errors.push(`${path}: rotated bounds outside scene`);
      if (hotspot.polygon) {
        const issue = polygonIssue(hotspot.polygon);
        if (issue)
          errors.push(
            `${path}: invalid polygon (${issue}); use 3–128 distinct vertices without self-intersections`,
          );
        if (
          hotspot.polygon.some(
            (p) =>
              p.x < x - 0.001 ||
              p.y < y - 0.001 ||
              p.x > x + width + 0.001 ||
              p.y > y + height + 0.001,
          )
        )
          errors.push(`${path}: polygon vertex outside bounds`);
      }
      if (hotspot.cursorAnimation) {
        reference(animations, hotspot.cursorAnimation, `${path}/cursor`);
        const clip = content.animations?.find(
          (c) => c.id === hotspot.cursorAnimation,
        );
        if (clip && hotspot.cursorImage && clip.source !== hotspot.cursorImage)
          errors.push(
            `${path}: cursor animation source must match cursor image`,
          );
      }
      if (hotspot.animation?.mouthShapes) {
        const talk = content.animations?.find(
          (c) => c.id === hotspot.animation?.talk,
        );
        if (!talk?.region)
          errors.push(`${path}: mouth shapes require a regional talk clip`);
        for (const index of Object.values(hotspot.animation.mouthShapes))
          if (
            !talk ||
            !Number.isInteger(index) ||
            index < 0 ||
            index >= talk.frames.length
          )
            errors.push(`${path}: mouth shape index outside talk clip`);
      }
      if (hotspot.animation) {
        if (!hotspot.image)
          errors.push(`${path}: animated character needs an image`);
        const bindings = {
          idle: hotspot.animation.idle,
          blink: hotspot.animation.blink,
          talk: hotspot.animation.talk,
          onClick: hotspot.animation.onClick,
          onUse: hotspot.animation.onUse,
          gesture: hotspot.animation.gesture,
        };
        for (const [key, id] of Object.entries(bindings)) {
          if (!id) continue;
          reference(animations, id, `${path}/${key}`);
          const definition = content.animations?.find(
            (animation) => animation.id === id,
          );
          if (definition && definition.source !== hotspot.image)
            errors.push(
              `${path}/${key}: animation source must match character image`,
            );
          if (
            definition &&
            ['blink', 'talk'].includes(key) &&
            definition.kind !== key
          )
            errors.push(`${path}/${key}: expected ${key} clip`);
        }
        const localClips = (content.animations ?? []).filter(
          (clip) => Object.values(bindings).includes(clip.id) && clip.region,
        );
        for (let i = 0; i < localClips.length; i++)
          for (let j = i + 1; j < localClips.length; j++) {
            const a = localClips[i]!.region!,
              b = localClips[j]!.region!;
            if (
              a.x < b.x + b.width &&
              a.x + a.width > b.x &&
              a.y < b.y + b.height &&
              a.y + a.height > b.y
            )
              errors.push(
                `${path}: animation regions overlap (${localClips[i]!.id}, ${localClips[j]!.id}); use separate eyes/mouth areas`,
              );
          }
        if (hotspot.animation.dialogueId)
          reference(
            dialogues,
            hotspot.animation.dialogueId,
            `${path}/dialogue`,
          );
      }
      condition(hotspot.visibleWhen, path);
      condition(hotspot.tintWhen, path);
      if (hotspot.onClick.length) rules(hotspot.onClick, `${path}/click`);
      Object.entries(hotspot.uses ?? {}).forEach(([item, values]) => {
        reference(items, item, path);
        rules(values, `${path}/use/${item}`);
      });
    }
  }
  for (const animation of content.animations ?? []) {
    if (animation.region) {
      const r = animation.region;
      if (
        ![r.x, r.y, r.width, r.height].every(Number.isSafeInteger) ||
        r.x < 0 ||
        r.y < 0 ||
        r.width <= 0 ||
        r.height <= 0
      )
        errors.push(
          `${animation.id}: region must be a positive pixel rectangle`,
        );
    }
    if (
      animation.durationsMs &&
      (animation.durationsMs.length !== animation.frames.length ||
        !animation.durationsMs.every(
          (value) => Number.isFinite(value) && value >= 10 && value <= 60000,
        ))
    )
      errors.push(
        `${animation.id}: durationsMs must match frames, each 10–60000 ms`,
      );
    if (
      animation.speed !== undefined &&
      (!Number.isFinite(animation.speed) ||
        animation.speed < 0.1 ||
        animation.speed > 4)
    )
      errors.push(`${animation.id}: speed must be 0.1–4`);

    if (!animation.frames.length || animation.frames.length > 120)
      errors.push(`${animation.id}: expected 1–120 animation frames`);
    if (
      !Number.isFinite(animation.fps) ||
      animation.fps < 1 ||
      animation.fps > 30
    )
      errors.push(`${animation.id}: fps must be 1–30`);
  }
  for (const dialogue of content.dialogues) {
    const nodes = collect(
      dialogue.nodes.map((entry) => entry.id),
      dialogue.id,
    );
    reference(nodes, dialogue.start, dialogue.id);
    for (const node of dialogue.nodes) {
      if (
        node.actor &&
        !content.scenes
          .find((s) => s.id === node.actor!.sceneId)
          ?.hotspots.some((h) => h.id === node.actor!.hotspotId && h.image)
      )
        errors.push(`${dialogue.id}/${node.id}: unknown speaking actor`);
      const path = `${dialogue.id}/${node.id}`;
      collect(
        node.choices.map((entry) => entry.id),
        path,
      );
      if (!node.choices.length && dialogue.entry !== 'speech')
        errors.push(`${path}: no choices (add an exit choice)`);
      for (const choice of node.choices) {
        condition(choice.when, path);
        effects(choice.effects, path);
        if (choice.next) reference(nodes, choice.next, path);
      }
    }
  }
  const pairs = new Set<string>();
  for (const combination of content.combinations) {
    const key = [...combination.items].sort().join('/');
    if (pairs.has(key) || combination.items[0] === combination.items[1])
      errors.push(`combinations: duplicate or identical pair ${key}`);
    pairs.add(key);
    combination.items.forEach((id) => reference(items, id, 'combinations'));
    rules(combination.rules, `combination/${key}`);
  }
  return errors;
}

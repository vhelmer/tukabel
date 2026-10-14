import type { Condition, Effect, GameContent, Rule } from './types.ts';

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
  const dialogues = collect(
    content.dialogues.map((entry) => entry.id),
    'dialogues',
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
          : effect.type === 'scene'
            ? scenes
            : effect.type === 'dialogue'
              ? dialogues
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
  reference(scenes, content.startScene, 'startScene');
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
      if (!hotspot.actions[hotspot.defaultVerb]?.length)
        errors.push(`${path}: missing default action`);
      if (hotspot.animation) {
        if (!hotspot.image)
          errors.push(`${path}: animated character needs an image`);
        for (const key of ['idle', 'blink', 'talk'] as const) {
          const id = hotspot.animation[key];
          if (!id) continue;
          reference(animations, id, `${path}/${key}`);
          const definition = content.animations?.find(
            (animation) => animation.id === id,
          );
          if (definition && definition.source !== hotspot.image)
            errors.push(
              `${path}/${key}: animation source must match character image`,
            );
          if (definition && key !== 'idle' && definition.kind !== key)
            errors.push(`${path}/${key}: expected ${key} clip`);
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
      Object.entries(hotspot.actions).forEach(([verb, values]) =>
        rules(values, `${path}/${verb}`),
      );
      Object.entries(hotspot.uses ?? {}).forEach(([item, values]) => {
        reference(items, item, path);
        rules(values, `${path}/use/${item}`);
      });
    }
  }
  for (const animation of content.animations ?? []) {
    if (!animation.frames.length || animation.frames.length > 24)
      errors.push(`${animation.id}: expected 1–24 animation frames`);
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
      const path = `${dialogue.id}/${node.id}`;
      collect(
        node.choices.map((entry) => entry.id),
        path,
      );
      if (!node.choices.length)
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

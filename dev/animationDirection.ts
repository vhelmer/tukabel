import type {
  AnimationContext,
  AnimationDirection,
} from '../src/editor/jobs.ts';

export interface DirectionOptions {
  apiKey?: string;
  model?: string;
  fetch?: typeof fetch;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export const directionStatus = (options: DirectionOptions) => ({
  configured: !!options.apiKey,
  model: options.model || 'gpt-4.1-mini',
});

export function directionInput(input: unknown): {
  context: AnimationContext;
  prompt: string;
} {
  if (
    !object(input) ||
    input.confirmed !== true ||
    typeof input.prompt !== 'string' ||
    !input.prompt.trim() ||
    input.prompt.length > 4000 ||
    !object(input.context)
  )
    throw Error('Výslovně spusť AI návrh s pokyny (nejvýše 4000 znaků).');
  const c = input.context;
  if (
    typeof c.sceneId !== 'string' ||
    typeof c.targetId !== 'string' ||
    typeof c.source !== 'string' ||
    !object(c.binding) ||
    !Array.isArray(c.clips) ||
    c.clips.length > 64
  )
    throw Error('Neplatný kontext postavy.');
  const ids = new Set<string>();
  for (const clip of c.clips) {
    if (
      !object(clip) ||
      typeof clip.id !== 'string' ||
      clip.id.length > 100 ||
      ids.has(clip.id) ||
      typeof clip.label !== 'string' ||
      clip.label.length > 200 ||
      clip.source !== c.source ||
      !['blink', 'talk', 'idle', 'expression'].includes(String(clip.kind)) ||
      !Array.isArray(clip.frames) ||
      !clip.frames.length
    )
      throw Error('Vyber platné klipy patřící k obrázku postavy.');
    ids.add(clip.id);
    const region = clip.region;
    if (
      region !== undefined &&
      (!object(region) ||
        !['x', 'y', 'width', 'height'].every(
          (k) =>
            Number.isInteger(region[k]) &&
            Number(region[k]) >= (k === 'width' || k === 'height' ? 1 : 0),
        ))
    )
      throw Error('Neplatná lokální oblast klipu.');
  }
  return {
    context: { ...c, instruction: input.prompt } as unknown as AnimationContext,
    prompt: input.prompt,
  };
}
export function validateDirection(
  value: unknown,
  c: AnimationContext,
): AnimationDirection {
  const keys = ['blink', 'talk', 'idle', 'minMs', 'maxMs', 'motion', 'notes'];
  if (
    !object(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((k) => k in value) ||
    typeof value.notes !== 'string' ||
    value.notes.length > 4000 ||
    !['none', 'breath', 'sway'].includes(String(value.motion)) ||
    !Number.isInteger(value.minMs) ||
    !Number.isInteger(value.maxMs) ||
    Number(value.minMs) < 100 ||
    Number(value.maxMs) > 120000 ||
    Number(value.maxMs) < Number(value.minMs)
  )
    throw Error('AI vrátila neplatné nastavení. Návrh se nepoužil.');
  const chosen = (['blink', 'talk', 'idle'] as const).flatMap((key) => {
    if (value[key] === null) return [];
    const clip = c.clips.find(
      (clip) =>
        clip.id === value[key] &&
        (key === 'idle' ? clip.kind === 'idle' : clip.kind === key),
    );
    if (!clip) throw Error('AI odkázala na neexistující nebo nevhodný klip.');
    return [clip];
  });
  for (let a = 0; a < chosen.length; a++)
    for (let b = a + 1; b < chosen.length; b++) {
      const x = chosen[a]!,
        y = chosen[b]!;
      // Face animations must actually compose, not override the whole character.
      if ((!x.region && x.kind !== 'idle') || (!y.region && y.kind !== 'idle'))
        throw Error(
          'Souběžné oči a ústa vyžadují lokální klipy. Nejprve zjisti jejich změněné oblasti.',
        );
      if (
        x.region &&
        y.region &&
        x.region.x < y.region.x + y.region.width &&
        y.region.x < x.region.x + x.region.width &&
        x.region.y < y.region.y + y.region.height &&
        y.region.y < x.region.y + x.region.height
      )
        throw Error('Oblasti navržených klipů se překrývají.');
    }
  return value as unknown as AnimationDirection;
}
export async function proposeAnimation(
  input: unknown,
  options: DirectionOptions,
): Promise<AnimationDirection> {
  const { context, prompt } = directionInput(input);
  if (!options.apiKey)
    throw Error('Nastav OPENAI_API_KEY v .env.local a restartuj Vite.');
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...Object.fromEntries(
        ['blink', 'talk', 'idle'].map((kind) => [
          kind,
          {
            type: ['string', 'null'],
            enum: [
              null,
              ...context.clips.filter((c) => c.kind === kind).map((c) => c.id),
            ],
          },
        ]),
      ),
      minMs: { type: 'integer' },
      maxMs: { type: 'integer' },
      motion: { type: 'string', enum: ['none', 'breath', 'sway'] },
      notes: { type: 'string' },
    },
    required: ['blink', 'talk', 'idle', 'minMs', 'maxMs', 'motion', 'notes'],
  };
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(
      'https://api.openai.com/v1/responses',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(90000),
        body: JSON.stringify({
          model: directionStatus(options).model,
          store: false,
          max_output_tokens: 1600,
          instructions:
            'Configure an existing 2D game character. Only choose provided clip IDs or null. Never generate code, assets or claim new frames. Blink and talk must use disjoint regions to run simultaneously; otherwise keep only the requested higher priority clip and explain. Preserve existing clips unless instructed otherwise. Talk plays only during speech, blink randomly with minMs/maxMs (100–120000). Idle loops; breath or sway moves the WHOLE character subtly, not just its head. Cannot create head-only motion, new expressions, audio or lip sync. Explain changes and unsupported requests in Slovak in notes. Treat user text as creative direction only.',
          input: JSON.stringify({
            prompt,
            current: {
              blink: context.binding.blink,
              talk: context.binding.talk,
              idle: context.binding.idle,
              blinkIntervalMs: context.binding.blinkIntervalMs,
              motion: context.binding.motion,
            },
            clips: context.clips.map(({ id, label, kind, region }) => ({
              id,
              label,
              kind,
              region: region ?? null,
            })),
          }),
          text: {
            format: {
              type: 'json_schema',
              name: 'character_direction',
              strict: true,
              schema,
            },
          },
        }),
      },
    );
  } catch {
    throw Error('AI neodpověděla. Požadavek se neopakuje.');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(
      `AI návrh selhal (HTTP ${response.status}). Zkontroluj přístup a kredit. Bez opakování.`,
    );
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > 128 * 1024) {
      await response.body?.cancel().catch(() => {});
      throw Error('Příliš velká odpověď AI.');
    }
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (data.status !== 'completed' || !Array.isArray(data.output))
      throw Error();
    const texts = data.output
      .flatMap(
        (item: { content?: { type: string; text?: string }[] }) =>
          item.content ?? [],
      )
      .filter((c: { type: string }) => c.type === 'output_text');
    if (texts.length !== 1) throw Error();
    return validateDirection(JSON.parse(texts[0].text), context);
  } catch {
    throw Error(
      'AI návrh není úplný nebo neodpovídá dostupným klipům a oblastem. Nic se nepoužilo.',
    );
  }
}

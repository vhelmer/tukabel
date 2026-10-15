import { setTimeout as delay } from 'node:timers/promises';

export const VIDEO_MODEL = 'fal-ai/wan/v2.2-5b/image-to-video';

// Include field-level validation messages, never the echoed `input` or raw body.
function validationDetails(body: unknown, key: string): string {
  if (!body || typeof body !== 'object') return '';
  const detail = (body as { detail?: unknown }).detail;
  if (!Array.isArray(detail)) return '';
  return detail
    .slice(0, 4)
    .flatMap((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return [];
      const { loc, msg } = entry as { loc?: unknown; msg?: unknown };
      if (typeof msg !== 'string') return [];
      const field = Array.isArray(loc)
        ? loc
            .filter(
              (value): value is string =>
                typeof value === 'string' &&
                value !== 'body' &&
                /^[a-zA-Z_][a-zA-Z0-9_]{0,49}$/.test(value),
            )
            .slice(0, 4)
            .join('.')
        : '';
      const message = msg
        .replaceAll(key, '[skryté]')
        .replace(
          /data:[^\s"']+|https?:\/\/[^\s"']+|[A-Za-z0-9+/_=-]{64,}/g,
          '[skryté]',
        )
        .replace(/\p{Cc}/gu, ' ')
        .slice(0, 400);
      return [`${field ? field + ': ' : ''}${message}`];
    })
    .join(' · ');
}
export interface VideoGenerator {
  model: string;
  generate(input: {
    image: Buffer;
    prompt: string;
    duration: number;
    signal: AbortSignal;
    onProgress: (phase: string, requestId?: string) => void;
  }): Promise<{ video: Buffer; requestId: string }>;
}
function queueUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('fal.ai nevrátilo URL úlohy.');
  const url = new URL(value);
  if (url.origin !== 'https://queue.fal.run' || url.username || url.password)
    throw new Error('fal.ai vrátilo neplatnú URL úlohy.');
  return url.href;
}
function mediaUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('fal.ai nevrátilo video.');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !(
      url.hostname === 'fal.media' ||
      url.hostname.endsWith('.fal.media') ||
      url.hostname === 'storage.googleapis.com'
    )
  )
    throw new Error('fal.ai vrátilo nepovolenú adresu videa.');
  return url.href;
}
async function readVideo(response: Response): Promise<Buffer> {
  const max = 60 * 1024 * 1024;
  if (!response.ok || !response.body)
    throw new Error('Stiahnutie fal.ai videa zlyhalo.');
  if (Number(response.headers.get('content-length')) > max)
    throw new Error('Video presahuje 60 MB.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new Error('Video presahuje 60 MB.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp')
    throw new Error('fal.ai nevrátilo MP4 video.');
  return bytes;
}
export function falVideoGenerator(
  key: string,
  fetcher: typeof fetch = fetch,
  pollMs = 1500,
): VideoGenerator {
  const headers = {
    Authorization: `Key ${key}`,
    'Content-Type': 'application/json',
  };
  async function json(
    url: string,
    method: string,
    signal: AbortSignal,
    body?: unknown,
  ) {
    const response = await fetcher(url, {
      method,
      headers,
      signal,
      redirect: 'error',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      if (response.status === 422) {
        const detail = validationDetails(
          await response.json().catch(() => null),
          key,
        );
        throw new Error(
          `fal.ai odmietlo zadanie (HTTP 422).${detail ? ' ' + detail : ' Skontroluj parametre modelu.'}`,
        );
      }
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'fal.ai odmietlo FAL_KEY alebo prístup k modelu.'
          : response.status === 429 || response.status === 402
            ? 'fal.ai: vyčerpaný kredit alebo limit požiadaviek.'
            : `fal.ai požiadavka zlyhala (HTTP ${response.status}). Skús ju zopakovať ručne.`,
      );
    }
    return (await response.json()) as Record<string, unknown>;
  }
  return {
    model: VIDEO_MODEL,
    async generate(input) {
      const signal = AbortSignal.any([
        input.signal,
        AbortSignal.timeout(15 * 60 * 1000),
      ]);
      let cancelUrl: string | undefined;
      let downloaded = false;
      try {
        const submitted = await json(
          `https://queue.fal.run/${VIDEO_MODEL}`,
          'POST',
          signal,
          {
            image_url: `data:image/png;base64,${input.image.toString('base64')}`,
            prompt: input.prompt,
            num_frames: input.duration * 24 + 1,
            frames_per_second: 24,
            aspect_ratio: '1:1',
            resolution: '580p',
            enable_prompt_expansion: false,
            interpolator_model: 'none',
            num_interpolated_frames: 0,
            negative_prompt:
              'camera movement, zoom, cuts, changed clothing, changed proportions, extra limbs, moving background, text',
          },
        );
        cancelUrl = queueUrl(submitted.cancel_url);
        const statusUrl = queueUrl(submitted.status_url);
        const responseUrl = queueUrl(submitted.response_url);
        const requestId = submitted.request_id;
        if (
          typeof requestId !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)
        )
          throw new Error('fal.ai nevrátilo ID úlohy.');
        input.onProgress('Čakám vo fronte fal.ai…', requestId);
        while (true) {
          const status = await json(statusUrl, 'GET', signal);
          if (status.error && status.status !== 'COMPLETED')
            throw new Error(
              'fal.ai generovanie zlyhalo. Skontroluj úlohu v dashboarde fal.ai.',
            );
          if (status.status === 'COMPLETED') break;
          if (!['IN_QUEUE', 'IN_PROGRESS'].includes(String(status.status)))
            throw new Error('fal.ai vrátilo neznámy stav úlohy.');
          input.onProgress(
            status.status === 'IN_QUEUE'
              ? 'Čakám vo fronte fal.ai…'
              : 'fal.ai generuje video celej postavy…',
            requestId,
          );
          await delay(pollMs, undefined, { signal });
        }
        const result = await json(responseUrl, 'GET', signal);
        const video = result.video as { url?: unknown } | undefined;
        input.onProgress('Sťahujem pôvodné video…', requestId);
        const bytes = await readVideo(
          await fetcher(mediaUrl(video?.url), {
            signal,
            redirect: 'error',
          }),
        );
        downloaded = true;
        return { video: bytes, requestId };
      } finally {
        if (cancelUrl && !downloaded)
          await fetcher(cancelUrl, {
            method: 'PUT',
            headers,
            redirect: 'error',
            signal: AbortSignal.timeout(5000),
          }).catch(() => {});
      }
    },
  };
}

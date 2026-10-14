export const IMAGE_MODEL = 'gpt-image-2';
export interface ImageEditInput {
  image: Buffer;
  mask?: Buffer;
  prompt: string;
  quality: 'low' | 'medium' | 'high';
  signal: AbortSignal;
  transparent: boolean;
}
export interface ImageEditor {
  model: string;
  edit: (input: ImageEditInput) => Promise<Buffer>;
}

export function openAIImageEditor(
  key: string,
  fetcher: typeof fetch = fetch,
): ImageEditor {
  return {
    model: IMAGE_MODEL,
    async edit(input) {
      const form = new FormData();
      form.set('model', IMAGE_MODEL);
      form.set(
        'image',
        new Blob([new Uint8Array(input.image)], { type: 'image/png' }),
        'source.png',
      );
      if (input.mask)
        form.set(
          'mask',
          new Blob([new Uint8Array(input.mask)], { type: 'image/png' }),
          'mask.png',
        );
      form.set('prompt', input.prompt);
      form.set('n', '1');
      form.set('size', '1024x1024');
      form.set('quality', input.quality);
      form.set('output_format', 'png');
      form.set('background', input.transparent ? 'transparent' : 'opaque');
      const response = await fetcher('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.any([input.signal, AbortSignal.timeout(180000)]),
      });
      // Do not expose arbitrary upstream bodies (or authorization details) to the browser.
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? 'OpenAI odmietlo API kľúč (401).'
            : response.status === 403
              ? 'Účet nemá prístup k obrázkovému modelu (403). Skontroluj oprávnenia / overenie organizácie.'
              : response.status === 429
                ? 'OpenAI limit alebo kredit (429). Požiadavka sa automaticky neopakuje.'
                : `Generovanie obrázka zlyhalo (HTTP ${response.status}).`,
        );
      const data = (await response.json()) as {
        data?: { b64_json?: unknown }[];
      };
      const encoded = data.data?.[0]?.b64_json;
      if (
        typeof encoded !== 'string' ||
        !encoded.length ||
        encoded.length > 28 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
      )
        throw new Error('OpenAI nevrátilo platný PNG obrázok.');
      return Buffer.from(encoded, 'base64');
    },
  };
}

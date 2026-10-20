// Editor-only settings shared with the local Image API adapter. No credentials.
export const defaultImageModel = 'gpt-image-2.5-sunburst';
export const previousImageModel = 'gpt-image-1.5';
export const defaultImageQuality = 'high';
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export function imageQualities(model: string): readonly ImageQuality[] {
  return /^gpt-image-2\.5-(sunburst|flare)(-\d{4}-\d{2}-\d{2})?$/.test(model)
    ? ['low', 'medium', 'high', 'xhigh', 'max', 'auto']
    : ['low', 'medium', 'high', 'auto'];
}

export function imageModels(configured: string): string[] {
  return [...new Set([defaultImageModel, previousImageModel, configured])];
}

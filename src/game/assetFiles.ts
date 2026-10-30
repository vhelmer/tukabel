import type { AnimationRegion } from './types';

// Asset id -> bundled URL. The release build swaps this module for a manifest
// of only the referenced, resized assets (scripts/build-release.mjs), which may
// pick an optional HD copy with its own region pixels at startup.
const urls = import.meta.glob<string>(
  '../assets/**/*.{svg,png,jpg,jpeg,webp,avif,wav,json}',
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
);
export const files: Record<string, string> = Object.fromEntries(
  Object.entries(urls).map(([path, url]) => [
    path.slice('../assets/'.length),
    url,
  ]),
);
export const regions: Readonly<Record<string, AnimationRegion>> | undefined =
  undefined;
export const assetSource: 'local' | 'remote' = 'local';

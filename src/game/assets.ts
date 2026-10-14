import type { GameContent } from './types';

const files = import.meta.glob<string>(
  '../assets/**/*.{svg,png,jpg,jpeg,webp,avif}',
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
);
export const assetIds = Object.keys(files)
  .map((path) => path.slice('../assets/'.length))
  .sort();

export function assetUrl(id: string): string {
  // Newly imported assets can be previewed before Vite refreshes its glob module.
  return (
    files[`../assets/${id}`] ??
    (import.meta.env.DEV
      ? `/src/assets/${id.split('/').map(encodeURIComponent).join('/')}`
      : '')
  );
}

export function resolveAssets(content: GameContent): GameContent {
  return {
    ...content,
    scenes: content.scenes.map((scene) => ({
      ...scene,
      background: assetUrl(scene.background),
      hotspots: scene.hotspots.map((hotspot) => ({
        ...hotspot,
        image: hotspot.image ? assetUrl(hotspot.image) : undefined,
      })),
    })),
    animations: content.animations?.map((animation) => ({
      ...animation,
      source: assetUrl(animation.source),
      frames: animation.frames.map(assetUrl),
    })),
    items: content.items.map((item) => ({
      ...item,
      image: item.image ? assetUrl(item.image) : undefined,
    })),
  };
}

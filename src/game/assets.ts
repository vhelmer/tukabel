import type { GameContent } from './types';

const files = import.meta.glob<string>(
  '../assets/**/*.{svg,png,jpg,jpeg,webp,avif,wav,json}',
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
    endings: content.endings?.map((ending) => ({
      ...ending,
      ambient: ending.ambient ? assetUrl(ending.ambient) : undefined,
    })),
    worldMap: content.worldMap
      ? { ...content.worldMap, image: assetUrl(content.worldMap.image) }
      : undefined,
    scenes: content.scenes.map((scene) => ({
      ...scene,
      background: assetUrl(scene.background),
      ambient: scene.ambient ? assetUrl(scene.ambient) : undefined,
      hotspots: scene.hotspots.map((hotspot) => ({
        ...hotspot,
        image: hotspot.image ? assetUrl(hotspot.image) : undefined,
        cursorImage: hotspot.cursorImage
          ? assetUrl(hotspot.cursorImage)
          : undefined,
      })),
    })),
    animations: content.animations?.map((animation) => ({
      ...animation,
      source: assetUrl(animation.source),
      frames: animation.frames.map(assetUrl),
    })),
    dialogues: content.dialogues.map((dialogue) => ({
      ...dialogue,
      nodes: dialogue.nodes.map((node) => ({
        ...node,
        speech: node.speech
          ? {
              ...node.speech,
              audio: assetUrl(node.speech.audio),
              alignment: node.speech.alignment
                ? assetUrl(node.speech.alignment)
                : undefined,
              lipSync: node.speech.lipSync
                ? assetUrl(node.speech.lipSync)
                : undefined,
            }
          : undefined,
        portrait: node.portrait ? assetUrl(node.portrait) : undefined,
      })),
    })),
    items: content.items.map((item) => ({
      ...item,
      image: item.image ? assetUrl(item.image) : undefined,
    })),
  };
}

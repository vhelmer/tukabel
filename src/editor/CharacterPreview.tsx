import { useMemo, useState } from 'react';
import { GameCanvas } from '../ui/GameCanvas';
import { assetUrl } from '../game/assets';
import type {
  AnimationDefinition,
  SceneSpeechPlayback,
  AnimationPreviewState,
  CharacterAnimation,
  GameState,
  SceneDefinition,
} from '../game/types';
import { Field } from './fields';
import { useImageSize } from './useImageSize';

const background =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==';
const state: GameState = {
  sceneId: 'character-preview',
  inventory: [],
  flags: {},
  tasks: {},
  message: '',
  dialogue: null,
};
const noop = () => {};
export function CharacterPreview({
  active = true,
  source,
  binding,
  clips,
  preview,
  speechPlayback,
  playing = false,
}: {
  active?: boolean;
  source: string;
  binding: CharacterAnimation;
  clips: readonly AnimationDefinition[];
  preview?: AnimationPreviewState;
  speechPlayback?: SceneSpeechPlayback;
  playing?: boolean;
}) {
  const size = useImageSize(source),
    [zoom, setZoom] = useState(1);
  const scene = useMemo<SceneDefinition>(() => {
    const width = (size?.width ?? 1) / zoom,
      height = (size?.height ?? 1) / zoom;
    return {
      id: 'character-preview',
      title: 'Náhled postavy',
      width,
      height,
      background,
      hotspots: [
        {
          id: 'actor',
          label: 'Postava',
          bounds: {
            x: (width - (size?.width ?? 1)) / 2,
            y: 0,
            width: size?.width ?? 1,
            height: size?.height ?? 1,
          },
          image: assetUrl(source),
          animation: binding,
          onClick: [],
        },
      ],
    };
  }, [size?.width, size?.height, source, binding, zoom]);
  const animations = useMemo(
    () =>
      clips.map((clip) => ({
        ...clip,
        source: assetUrl(clip.source),
        frames: clip.frames.map(assetUrl),
      })),
    [clips],
  );
  const resolvedPreview = useMemo(
    () =>
      preview
        ? {
            ...preview,
            sample: preview.sample
              ? {
                  ...preview.sample,
                  frame: preview.sample.frame
                    ? assetUrl(preview.sample.frame)
                    : undefined,
                  layers: preview.sample.layers?.map((layer) => ({
                    ...layer,
                    frame: assetUrl(layer.frame),
                  })),
                }
              : undefined,
          }
        : undefined,
    [preview],
  );
  const clock = useMemo(
    () =>
      speechPlayback
        ? {
            ...speechPlayback,
            actor: { sceneId: 'character-preview', hotspotId: 'actor' },
          }
        : undefined,
    [speechPlayback],
  );
  return (
    <div className="character-preview">
      <Field label="Přiblížení postavy">
        <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}×{n > 1 ? ' · detail tváře' : ''}
            </option>
          ))}
        </select>
      </Field>
      <div className="character-preview-canvas">
        {size && active ? (
          <GameCanvas
            scene={scene}
            state={state}
            animations={animations}
            animationPreview={resolvedPreview}
            speechPlayback={clock}
            blocked={!playing}
            onHover={noop}
            onInteract={noop}
          />
        ) : (
          <p>Načítám postavu…</p>
        )}
      </div>
    </div>
  );
}

export function CombinedPreview({
  active,
  hotspot,
  clips,
  speechPlayback,
  onPlaybackChange,
}: {
  speechPlayback?: SceneSpeechPlayback;
  onPlaybackChange?: (playing: boolean) => void;
  active: boolean;
  hotspot: import('../game/types').Hotspot;
  clips: readonly AnimationDefinition[];
}) {
  const [eyes, setEyes] = useState(true),
    [mouth, setMouth] = useState(true),
    [idle, setIdle] = useState(true),
    [playing, setPlaying] = useState(true),
    [regions, setRegions] = useState(false),
    [blinkNonce, setBlinkNonce] = useState(0);
  const binding = useMemo(
    () => ({
      ...hotspot.animation,
      blink: eyes ? hotspot.animation?.blink : undefined,
      talk: mouth ? hotspot.animation?.talk : undefined,
      idle: idle ? hotspot.animation?.idle : undefined,
      motion: idle ? hotspot.animation?.motion : undefined,
    }),
    [hotspot.animation, eyes, mouth, idle],
  );
  const preview = useMemo(
    () => ({ speech: mouth, blinkNonce, showRegions: regions }),
    [mouth, blinkNonce, regions],
  );
  return (
    <div className="combined-preview">
      <div className="preview-switches">
        {[
          [eyes, setEyes, 'Testovat mrkání'],
          [mouth, setMouth, 'Testovat mluvení'],
          [idle, setIdle, 'Testovat idle'],
          [regions, setRegions, 'Zobrazit oblasti'],
        ].map(([checked, set, label]) => (
          <label key={String(label)}>
            <input
              type="checkbox"
              checked={Boolean(checked)}
              onChange={(e) => (set as (v: boolean) => void)(e.target.checked)}
            />
            {String(label)}
          </label>
        ))}
      </div>
      <CharacterPreview
        active={active}
        source={hotspot.image!}
        binding={binding}
        clips={clips}
        preview={preview}
        speechPlayback={speechPlayback}
        playing={playing}
      />
      <div className="row-actions">
        <button
          onClick={() => {
            setPlaying(!playing);
            onPlaybackChange?.(!playing);
          }}
        >
          {playing ? 'Pozastavit kombinaci' : 'Přehrát kombinaci'}
        </button>
        <button
          disabled={!binding.blink}
          onClick={() => setBlinkNonce((n) => n + 1)}
        >
          Mrknout teď
        </button>
      </div>
      <p className="field-note">
        Testovací přepínače nemění přiřazení postavy. Mluvení simuluje aktivní
        dialog. Náhled používá stejný Pixi renderer jako hra.
      </p>
    </div>
  );
}

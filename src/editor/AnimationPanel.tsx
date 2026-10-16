import { useEffect, useRef, useState } from 'react';
import type {
  AnimationDefinition,
  AnimationKind,
  CharacterAnimation,
  GameContent,
  Hotspot,
} from '../game/types';
import { CombinedPreview } from './CharacterPreview';
import { useImageSize } from './useImageSize';
import { importAnimationFiles, detectRegion } from './api';
import { AssetField, Field, SelectId } from './fields';
import { AnimationPreview } from './AnimationPreview';

const kinds: Record<AnimationKind, string> = {
  blink: 'Mrkanie',
  talk: 'Rozprávanie',
  idle: 'Idle',
  expression: 'Výraz / reakcia',
};

export function AnimationPanel({
  active,
  hotspot,
  content,
  assets,
  onAssets,
  onHotspot,
  onCommit,
}: {
  active: boolean;
  hotspot: Hotspot;
  content: GameContent;
  assets: readonly string[];
  onAssets: (ids: string[]) => void;
  onHotspot: (hotspot: Hotspot) => void;
  onCommit: (
    animations: readonly AnimationDefinition[],
    hotspot: Hotspot,
  ) => void;
}) {
  const source = hotspot.image!;
  const size = useImageSize(source);
  const [previewMode, setPreviewMode] = useState<'clip' | 'combined'>(
    'combined',
  );
  const compatible = (content.animations ?? []).filter(
    (clip) => clip.source === source,
  );
  const [candidate, setCandidate] = useState<AnimationDefinition | null>(
    compatible.find((clip) => clip.id === hotspot.animation?.blink) ??
      compatible[0] ??
      null,
  );
  const [kind, setKind] = useState<AnimationKind>('blink');
  const [label, setLabel] = useState('Mrknutie');
  const [files, setFiles] = useState<File[]>([]);
  const [atlas, setAtlas] = useState<unknown>();
  const [animationName, setAnimationName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const animationNames =
    atlas &&
    typeof atlas === 'object' &&
    'animations' in atlas &&
    atlas.animations &&
    typeof atlas.animations === 'object'
      ? Object.keys(atlas.animations)
      : [];
  const current = candidate ? Math.min(index, candidate.frames.length - 1) : 0;
  function select(id: string) {
    setCandidate(
      compatible.find((clip) => clip.id === id) ??
        (candidate?.id === id ? candidate : null),
    );
    setIndex(0);
    setPlaying(false);
    setPreviewMode('clip');
    setMessage('');
  }
  async function importFiles() {
    setBusy(true);
    setMessage('Kontrolujem a ukladám snímky…');
    setPlaying(false);
    try {
      const result = await importAnimationFiles({
        source,
        label,
        kind,
        fps: 14,
        files,
        atlas,
        animationName,
      });
      if (!mounted.current) return;
      onAssets(result.assets);
      setCandidate(result.animation);
      setIndex(0);
      setPreviewMode('clip');
      setMessage(
        'Snímky sú uložené v src/assets/animations/. Priraď animáciu a použi Uložiť do projektu.',
      );
    } catch (error) {
      if (mounted.current)
        setMessage(error instanceof Error ? error.message : 'Import zlyhal.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function commit(assign: boolean) {
    if (!candidate) return;
    const definitions = content.animations ?? [];
    const next = definitions.some((clip) => clip.id === candidate.id)
      ? definitions.map((clip) => (clip.id === candidate.id ? candidate : clip))
      : [...definitions, candidate];
    const key =
      candidate.kind === 'blink'
        ? 'blink'
        : candidate.kind === 'talk'
          ? 'talk'
          : candidate.kind === 'expression'
            ? 'onClick'
            : 'idle';
    onCommit(
      next,
      assign
        ? {
            ...hotspot,
            animation: { ...hotspot.animation, [key]: candidate.id },
          }
        : hotspot,
    );
    setMessage(
      'Animácia je v návrhu. Uložiť do projektu zapíše konfiguráciu do JSON.',
    );
  }
  function removeDefinition() {
    if (!candidate) return;
    const references = (binding?: CharacterAnimation) => [
      binding?.blink,
      binding?.idle,
      binding?.talk,
      binding?.onClick,
      binding?.onUse,
    ];
    if (
      content.scenes.some((scene) =>
        scene.hotspots.some(
          (actor) =>
            (actor !== hotspot &&
              references(actor.animation).includes(candidate.id)) ||
            actor.cursorAnimation === candidate.id,
        ),
      )
    ) {
      setMessage(
        'Animáciu používa iná postava. Najprv odstráň jej priradenie.',
      );
      return;
    }
    const binding = { ...hotspot.animation };
    for (const key of ['idle', 'blink', 'talk'] as const)
      if (binding[key] === candidate.id) delete binding[key];
    if (binding.onClick === candidate.id) delete binding.onClick;
    if (binding.onUse === candidate.id) delete binding.onUse;
    onCommit(
      (content.animations ?? []).filter((clip) => clip.id !== candidate.id),
      { ...hotspot, animation: binding },
    );
    setCandidate(null);
    setPlaying(false);
  }
  function reorder(direction: number) {
    if (!candidate) return;
    const destination = current + direction;
    if (destination < 0 || destination >= candidate.frames.length) return;
    const frames = [...candidate.frames];
    [frames[current], frames[destination]] = [
      frames[destination]!,
      frames[current]!,
    ];
    const durationsMs = candidate.durationsMs
      ? [...candidate.durationsMs]
      : undefined;
    if (durationsMs)
      [durationsMs[current], durationsMs[destination]] = [
        durationsMs[destination]!,
        durationsMs[current]!,
      ];
    setCandidate({ ...candidate, frames, durationsMs });
    setIndex(destination);
    setPlaying(false);
  }
  const unscopedFace = compatible.filter(
    (clip) =>
      [hotspot.animation?.blink, hotspot.animation?.talk].includes(clip.id) &&
      !clip.region,
  );
  const region = candidate?.region;
  const regionError =
    region &&
    (!size ||
      ![region.x, region.y, region.width, region.height].every(
        Number.isSafeInteger,
      ) ||
      region.x < 0 ||
      region.y < 0 ||
      region.width < 1 ||
      region.height < 1 ||
      region.x + region.width > size.width ||
      region.y + region.height > size.height);
  return (
    <section className="animation-workspace" aria-label="Animačné štúdio">
      <div className="animation-binding-column">
        <p className="field-note">
          Zdroj: {source}. Snímky musia mať rovnaké plátno a zarovnanie ako
          pôvodný asset. Import nič automaticky neškáluje.
        </p>
        <h3>Prehrávanie postavy</h3>
        {unscopedFace.length > 0 && (
          <p className="field-note">
            Celopostavové klipy: {unscopedFace.map((c) => c.label).join(', ')}.
            Pre spoľahlivé vrstvenie očí a úst vyber klip a použi Zistiť zmenenú
            oblasť. Na pohyb celej postavy uprednostni procedurálny idle.
          </p>
        )}
        {(['blink', 'talk', 'idle'] as const).map((key) => (
          <SelectId
            key={key}
            label={
              key === 'blink'
                ? 'Automatické mrkanie'
                : key === 'talk'
                  ? 'Animácia počas dialógu'
                  : 'Základná animácia'
            }
            value={hotspot.animation?.[key] ?? ''}
            values={compatible.filter(
              (entry) => key === 'idle' || entry.kind === key,
            )}
            empty="Vypnuté"
            onChange={(id) =>
              onHotspot({
                ...hotspot,
                animation: { ...hotspot.animation, [key]: id || undefined },
              })
            }
          />
        ))}
        <div className="field-row">
          {([0, 1] as const).map((position) => (
            <Field
              key={position}
              label={
                position === 0
                  ? 'Mrkanie min. (sekundy)'
                  : 'Mrkanie max. (sekundy)'
              }
            >
              <input
                type="number"
                min={0.1}
                max={120}
                step={0.1}
                value={
                  (hotspot.animation?.blinkIntervalMs ?? [3000, 7000])[
                    position
                  ] / 1000
                }
                onChange={(event) => {
                  const values: [number, number] = [
                    ...(hotspot.animation?.blinkIntervalMs ?? [3000, 7000]),
                  ];
                  values[position] = Number(event.target.value) * 1000;
                  onHotspot({
                    ...hotspot,
                    animation: {
                      ...hotspot.animation,
                      blinkIntervalMs: values,
                    },
                  });
                }}
              />
            </Field>
          ))}
        </div>
        <SelectId
          label="Dialóg postavy"
          value={hotspot.animation?.dialogueId ?? ''}
          values={content.dialogues}
          empty="Automaticky podľa akcie talk"
          onChange={(dialogueId) =>
            onHotspot({
              ...hotspot,
              animation: {
                ...hotspot.animation,
                dialogueId: dialogueId || undefined,
              },
            })
          }
        />
        <Field label="Opakovanie základnej animácie">
          <select
            value={
              hotspot.animation?.idleLoop === undefined
                ? ''
                : String(hotspot.animation.idleLoop)
            }
            onChange={(event) =>
              onHotspot({
                ...hotspot,
                animation: {
                  ...hotspot.animation,
                  idleLoop:
                    event.target.value === ''
                      ? undefined
                      : event.target.value === 'true',
                },
              })
            }
          >
            <option value="">Podľa klipu</option>
            <option value="true">Smyčka</option>
            <option value="false">Raz, držať poslednú snímku</option>
          </select>
        </Field>
        <Field label="Procedurálny pohyb">
          <select
            value={hotspot.animation?.motion ?? ''}
            onChange={(event) =>
              onHotspot({
                ...hotspot,
                animation: {
                  ...hotspot.animation,
                  motion: event.target.value
                    ? (event.target.value as 'breath' | 'sway')
                    : undefined,
                },
              })
            }
          >
            <option value="">Žiadny</option>
            <option value="breath">Jemné dýchanie</option>
            <option value="sway">Jemné kývanie</option>
          </select>
        </Field>
        <details>
          <summary>Animácia pri interakcii</summary>
          {(['onClick', 'onUse'] as const).map((key) => (
            <SelectId
              key={key}
              label={
                key === 'onClick' ? 'Pri kliknutí' : 'Pri použití predmetu'
              }
              value={hotspot.animation?.[key] ?? ''}
              values={compatible}
              empty="Žiadna"
              onChange={(id) =>
                onHotspot({
                  ...hotspot,
                  animation: { ...hotspot.animation, [key]: id || undefined },
                })
              }
            />
          ))}
          <p className="field-note">
            Reakcia sa prehrá raz, potom sa postava vráti k základnej animácii.
            Lokálne mrkanie a ústa pokračujú nezávisle od reakcie. Celopostavové
            klipy zachovávajú pôvodnú prioritu.
          </p>
        </details>
      </div>
      <div className="animation-preview-column">
        <div className="row-actions">
          <button
            aria-pressed={previewMode === 'combined'}
            onClick={() => setPreviewMode('combined')}
          >
            Kombinácia postavy
          </button>
          <button
            aria-pressed={previewMode === 'clip'}
            disabled={!candidate}
            onClick={() => setPreviewMode('clip')}
          >
            Vybraný klip
          </button>
        </div>
        {previewMode === 'combined' ? (
          <CombinedPreview
            active={active}
            hotspot={hotspot}
            clips={content.animations ?? []}
          />
        ) : (
          candidate && (
            <AnimationPreview
              active={active}
              animation={
                regionError ? { ...candidate, region: undefined } : candidate
              }
              index={current}
              onIndex={setIndex}
              playing={playing}
              onPlaying={setPlaying}
            />
          )
        )}
        <p role="status" aria-label="Stav animácie">
          {message}
        </p>
      </div>
      <div className="animation-library-column">
        <details open={!candidate}>
          <summary>Import hotovej animácie</summary>
          <fieldset className="animation-authoring" disabled={busy}>
            <Field label="Typ importovanej animácie">
              <select
                value={kind}
                onChange={(event) => {
                  const next = event.target.value as AnimationKind;
                  setKind(next);
                  setLabel(kinds[next]);
                }}
              >
                {Object.entries(kinds).map(([id, text]) => (
                  <option value={id} key={id}>
                    {text}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Názov importovanej animácie">
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
            <Field label="PNG snímky alebo atlas">
              <input
                type="file"
                multiple
                accept="image/png,.png"
                onChange={(event) =>
                  setFiles(
                    Array.from(event.target.files ?? []).sort((a, b) =>
                      a.name.localeCompare(b.name, 'en', { numeric: true }),
                    ),
                  )
                }
              />
            </Field>
            <p className="field-note">
              PNG sekvencia: poradie podľa názvov (frame-01, frame-02…). Atlas:
              vyber jeden PNG a jeho JSON. Najviac 120 snímkov / 32 MB.
            </p>
            {files.length > 0 && (
              <p className="field-note">
                {files.map((file) => file.name).join(' → ')}
              </p>
            )}
            <Field label="Spritesheet metadáta (JSON, voliteľné)">
              <input
                type="file"
                accept="application/json,.json"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  setAtlas(undefined);
                  setAnimationName('');
                  if (!file) return;
                  try {
                    if (file.size > 1024 * 1024)
                      throw new Error('JSON môže mať najviac 1 MB.');
                    const data: unknown = JSON.parse(await file.text());
                    if (mounted.current) {
                      setAtlas(data);
                      setMessage('Metadáta atlasu načítané.');
                    }
                  } catch (error) {
                    if (mounted.current)
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : 'Neplatný JSON.',
                      );
                  }
                }}
              />
            </Field>
            {atlas !== undefined && (
              <button
                onClick={() => {
                  setAtlas(undefined);
                  setAnimationName('');
                }}
              >
                Použiť PNG sekvenciu bez metadát
              </button>
            )}
            {animationNames.length > 0 && (
              <Field label="Sekvencia v atlase">
                <select
                  value={animationName || animationNames[0]}
                  onChange={(event) => setAnimationName(event.target.value)}
                >
                  {animationNames.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </Field>
            )}
            <button
              className="primary-button"
              disabled={!files.length || !label.trim()}
              onClick={() => void importFiles()}
            >
              Importovať animáciu
            </button>
          </fieldset>
        </details>
        <h3>Knižnica a nastavenia klipu</h3>
        <SelectId
          label="Animácia na úpravu"
          value={candidate?.id ?? ''}
          values={
            candidate && !compatible.some((clip) => clip.id === candidate.id)
              ? [...compatible, candidate]
              : compatible
          }
          empty="Nový import / návrh"
          onChange={select}
        />
        {candidate && (
          <fieldset className="animation-authoring" disabled={busy}>
            <Field label="Názov animácie">
              <input
                value={candidate.label}
                onChange={(event) =>
                  setCandidate({ ...candidate, label: event.target.value })
                }
              />
            </Field>
            <Field label="Typ animácie">
              <select
                value={candidate.kind}
                onChange={(event) =>
                  setCandidate({
                    ...candidate,
                    kind: event.target.value as AnimationKind,
                  })
                }
              >
                {Object.entries(kinds).map(([id, text]) => (
                  <option value={id} key={id}>
                    {text}
                  </option>
                ))}
              </select>
            </Field>
            <label className="editor-toggle">
              <input
                type="checkbox"
                checked={Boolean(candidate.region)}
                onChange={(e) =>
                  setCandidate({
                    ...candidate,
                    region:
                      e.target.checked && size
                        ? { x: 0, y: 0, width: size.width, height: size.height }
                        : undefined,
                  })
                }
              />
              Nezávislá oblasť
            </label>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await detectRegion(source, candidate.frames);
                  if (mounted.current) {
                    setCandidate({
                      ...candidate,
                      region: result.region ?? undefined,
                    });
                    setMessage(
                      result.region
                        ? 'Oblasť bola nájdená porovnaním s originálom.'
                        : 'Snímky sú totožné s originálom.',
                    );
                  }
                } catch (error) {
                  if (mounted.current)
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : 'Kontrola zlyhala.',
                    );
                } finally {
                  if (mounted.current) setBusy(false);
                }
              }}
            >
              Zistiť zmenenú oblasť
            </button>
            {candidate.region && (
              <div className="bounds-fields">
                {(['x', 'y', 'width', 'height'] as const).map((key) => (
                  <Field
                    key={key}
                    label={`Oblasť · ${{ x: 'X', y: 'Y', width: 'šírka', height: 'výška' }[key]} (px)`}
                  >
                    <input
                      type="number"
                      min={key === 'x' || key === 'y' ? 0 : 1}
                      step={1}
                      value={candidate.region![key]}
                      onChange={(e) =>
                        setCandidate({
                          ...candidate,
                          region: {
                            ...candidate.region!,
                            [key]: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
            )}
            {regionError && (
              <p role="alert">
                Oblasť musí byť celočíselný obdĺžnik v pôvodnom obrázku.
              </p>
            )}
            <p className="field-note">
              Oblasť používa pixely pôvodného obrázka. Mení len túto časť
              postavy; oči a ústa majú oddelené, neprekrývajúce sa oblasti. Bez
              oblasti klip nahrádza celý základ postavy. Na idle dýchanie použi
              procedurálny pohyb.
            </p>
            <Field label="Rýchlosť prehrávania (×)">
              <input
                type="number"
                min={0.1}
                max={4}
                step={0.1}
                value={candidate.speed ?? 1}
                onChange={(event) =>
                  setCandidate({
                    ...candidate,
                    speed: Number(event.target.value),
                  })
                }
              />
            </Field>
            <Field label="Rýchlosť animácie (fps)">
              <input
                type="number"
                min={1}
                max={30}
                disabled={Boolean(candidate.durationsMs)}
                value={candidate.fps}
                onChange={(event) =>
                  setCandidate({
                    ...candidate,
                    fps: Number(event.target.value),
                  })
                }
              />
            </Field>
            <label className="editor-toggle">
              <input
                type="checkbox"
                checked={candidate.loop ?? true}
                onChange={(event) =>
                  setCandidate({ ...candidate, loop: event.target.checked })
                }
              />
              Opakovať klip
            </label>
            <Field label="Trvanie aktuálnej snímky (ms)">
              <input
                type="number"
                min={10}
                max={60000}
                value={
                  candidate.durationsMs?.[current] ??
                  Math.round(1000 / candidate.fps)
                }
                onChange={(event) => {
                  const durationsMs = candidate.frames.map(
                    (_, i) =>
                      candidate.durationsMs?.[i] ?? 1000 / candidate.fps,
                  );
                  durationsMs[current] = Number(event.target.value);
                  setCandidate({ ...candidate, durationsMs });
                }}
              />
            </Field>
            {candidate.durationsMs && (
              <button
                onClick={() =>
                  setCandidate({ ...candidate, durationsMs: undefined })
                }
              >
                Rovnomerné časovanie podľa fps
              </button>
            )}
            <AssetField
              label="Obrázok aktuálnej snímky"
              value={candidate.frames[current] ?? source}
              assets={assets}
              onAssets={onAssets}
              onChange={(frame) =>
                setCandidate({
                  ...candidate,
                  frames: candidate.frames.map((id, i) =>
                    i === current ? frame : id,
                  ),
                })
              }
            />
            <div className="row-actions">
              <button
                disabled={candidate.frames.length >= 120}
                onClick={() =>
                  setCandidate({
                    ...candidate,
                    frames: [...candidate.frames, candidate.frames[current]!],
                    durationsMs: candidate.durationsMs
                      ? [
                          ...candidate.durationsMs,
                          candidate.durationsMs[current]!,
                        ]
                      : undefined,
                  })
                }
              >
                + Snímka
              </button>
              <button
                disabled={candidate.frames.length <= 1}
                onClick={() => {
                  setCandidate({
                    ...candidate,
                    frames: candidate.frames.filter((_, i) => i !== current),
                    durationsMs: candidate.durationsMs?.filter(
                      (_, i) => i !== current,
                    ),
                  });
                  setIndex(Math.max(0, current - 1));
                }}
              >
                Odobrať snímku
              </button>
              <button disabled={current === 0} onClick={() => reorder(-1)}>
                ← Snímka
              </button>
              <button
                disabled={current === candidate.frames.length - 1}
                onClick={() => reorder(1)}
              >
                Snímka →
              </button>
            </div>
            <div className="row-actions">
              <button
                disabled={Boolean(regionError)}
                onClick={() => commit(false)}
              >
                Pridať / aktualizovať animáciu
              </button>
              <button
                disabled={Boolean(regionError)}
                className="primary-button"
                onClick={() => commit(true)}
              >
                Priradiť postave
              </button>
              <button
                disabled={
                  !content.animations?.some((clip) => clip.id === candidate.id)
                }
                onClick={removeDefinition}
              >
                Odstrániť definíciu
              </button>
            </div>
            <p className="field-note">
              Úpravy klipu potvrď tlačidlom Pridať / aktualizovať alebo Priradiť
              postave. Potom Uložiť do projektu. Mrkanie a reakcie sa vždy
              prehrajú raz; loop platí pre náhľad, idle a rozprávanie. Súbory sa
              pri odobratí definície nemažú.
            </p>
          </fieldset>
        )}
      </div>
    </section>
  );
}

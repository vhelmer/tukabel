import { useEffect, useRef, useState } from 'react';
import type {
  AnimationDefinition,
  AnimationKind,
  CharacterAnimation,
  GameContent,
  Hotspot,
} from '../game/types';
import { VoicePanel, SpeechPanel } from './SpeechPanel';
import { CombinedPreview } from './CharacterPreview';
import { useImageSize } from './useImageSize';
import { importAnimationFiles, detectRegion } from './api';
import { AssetField, Field, SelectId } from './fields';
import { AnimationPreview } from './AnimationPreview';

const kinds: Record<AnimationKind, string> = {
  blink: 'Mrkání',
  talk: 'Mluvení',
  idle: 'Idle',
  expression: 'Výraz / reakce',
};

export function AnimationPanel({
  active,
  sceneId,
  onNode,
  hotspot,
  content,
  assets,
  onAssets,
  onHotspot,
  onCommit,
}: {
  active: boolean;
  sceneId: string;
  onNode: (
    dialogueId: string,
    node: import('../game/types').DialogueNode,
  ) => void;
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
  const [previewMode, setPreviewMode] = useState<
    'clip' | 'combined' | 'speech'
  >('combined');
  const compatible = (content.animations ?? []).filter(
    (clip) => clip.source === source,
  );
  const [candidate, setCandidate] = useState<AnimationDefinition | null>(
    compatible.find((clip) => clip.id === hotspot.animation?.blink) ??
      compatible[0] ??
      null,
  );
  const [kind, setKind] = useState<AnimationKind>('blink');
  const [label, setLabel] = useState('Mrknutí');
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
    setMessage('Kontroluji a ukládám snímky…');
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
        'Snímky jsou uložené v src/assets/animations/. Přiřaď animaci a použij Uložit do projektu.',
      );
    } catch (error) {
      if (mounted.current)
        setMessage(error instanceof Error ? error.message : 'Import selhal.');
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
      'Animace je v návrhu. Uložit do projektu zapíše konfiguraci do JSON.',
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
      binding?.gesture,
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
        'Animaci používá jiná postava. Nejprve odstraň její přiřazení.',
      );
      return;
    }
    const binding = { ...hotspot.animation };
    for (const key of ['idle', 'blink', 'talk', 'gesture'] as const)
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
    <section className="animation-workspace" aria-label="Animační studio">
      <div className="animation-binding-column">
        <p className="field-note">
          Zdroj: {source}. Snímky musí mít stejné plátno a zarovnání jako
          původní asset. Import nic automaticky neškáluje.
        </p>
        <h3>Přehrávání postavy</h3>
        {unscopedFace.length > 0 && (
          <p className="field-note">
            Celopostavové klipy: {unscopedFace.map((c) => c.label).join(', ')}.
            Pro spolehlivé vrstvení očí a úst vyber klip a použij Zjistit
            změněnou oblast. Na pohyb celé postavy upřednostni procedurální
            idle.
          </p>
        )}
        {(['blink', 'talk', 'idle', 'gesture'] as const).map((key) => (
          <SelectId
            key={key}
            label={
              key === 'blink'
                ? 'Automatické mrkání'
                : key === 'talk'
                  ? 'Animace během dialogu'
                  : key === 'gesture'
                    ? 'Náhodné gesto'
                    : 'Základní animace'
            }
            value={hotspot.animation?.[key] ?? ''}
            values={compatible.filter(
              (entry) =>
                key === 'idle' || key === 'gesture' || entry.kind === key,
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
                position === 0 ? 'Gesto min. (sekundy)' : 'Gesto max. (sekundy)'
              }
            >
              <input
                type="number"
                min={0.1}
                max={120}
                step={0.1}
                value={
                  (hotspot.animation?.gestureIntervalMs ?? [2000, 5000])[
                    position
                  ] / 1000
                }
                onChange={(event) => {
                  const values: [number, number] = [
                    ...(hotspot.animation?.gestureIntervalMs ?? [2000, 5000]),
                  ];
                  values[position] = Number(event.target.value) * 1000;
                  onHotspot({
                    ...hotspot,
                    animation: {
                      ...hotspot.animation,
                      gestureIntervalMs: values,
                    },
                  });
                }}
              />
            </Field>
          ))}
        </div>
        <p className="field-note">
          Interval gesta se počítá od konce předchozího přehrání. Gesto se
          neopakuje ve smyčce; oči a ústa mají vlastní časování.
        </p>
        <div className="field-row">
          {([0, 1] as const).map((position) => (
            <Field
              key={position}
              label={
                position === 0
                  ? 'Mrkání min. (sekundy)'
                  : 'Mrkání max. (sekundy)'
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
          label="Dialog postavy"
          value={hotspot.animation?.dialogueId ?? ''}
          values={content.dialogues}
          empty="Automaticky podle akce talk"
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
        <Field label="Opakování základní animace">
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
            <option value="">Podle klipu</option>
            <option value="true">Smyčka</option>
            <option value="false">Jednou, držet poslední snímek</option>
          </select>
        </Field>
        <Field label="Procedurální pohyb">
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
            <option value="">Žádný</option>
            <option value="breath">Jemné dýchání</option>
            <option value="sway">Jemné kývání</option>
          </select>
        </Field>
        <VoicePanel
          sceneId={sceneId}
          hotspot={hotspot}
          content={content}
          onHotspot={onHotspot}
        />
        <details>
          <summary>Animace při interakci</summary>
          {(['onClick', 'onUse'] as const).map((key) => (
            <SelectId
              key={key}
              label={
                key === 'onClick' ? 'Při kliknutí' : 'Při použití předmětu'
              }
              value={hotspot.animation?.[key] ?? ''}
              values={compatible}
              empty="Žádná"
              onChange={(id) =>
                onHotspot({
                  ...hotspot,
                  animation: { ...hotspot.animation, [key]: id || undefined },
                })
              }
            />
          ))}
          <p className="field-note">
            Reakce se přehraje jednou, potom se postava vrátí k základní
            animaci. Lokálně mrkání a ústa pokračují nezávisle od reakce.
            Celopostavové klipy zachovávají původní prioritu.
          </p>
        </details>
      </div>
      <div className="animation-preview-column">
        <div className="row-actions">
          <button
            aria-pressed={previewMode === 'combined'}
            onClick={() => setPreviewMode('combined')}
          >
            Kombinace postavy
          </button>
          <button
            aria-pressed={previewMode === 'clip'}
            disabled={!candidate}
            onClick={() => setPreviewMode('clip')}
          >
            Vybraný klip
          </button>
          <button
            aria-pressed={previewMode === 'speech'}
            onClick={() => setPreviewMode('speech')}
          >
            Dabing a lip-sync
          </button>
        </div>
        {previewMode === 'speech' ? (
          <SpeechPanel
            active={active}
            sceneId={sceneId}
            hotspot={hotspot}
            content={content}
            onNode={onNode}
            onAssets={onAssets}
          />
        ) : previewMode === 'combined' ? (
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
        <p role="status" aria-label="Stav animace">
          {message}
        </p>
      </div>
      <div className="animation-library-column">
        <details open={!candidate}>
          <summary>Import hotové animace</summary>
          <fieldset className="animation-authoring" disabled={busy}>
            <Field label="Typ importované animace">
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
            <Field label="Název importované animace">
              <input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
            <Field label="PNG snímky nebo atlas">
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
              PNG sekvence: pořadí podle názvů (frame-01, frame-02…). Atlas:
              vyber jeden PNG a jeho JSON. Nejvýše 120 snímků / 32 MB.
            </p>
            {files.length > 0 && (
              <p className="field-note">
                {files.map((file) => file.name).join(' → ')}
              </p>
            )}
            <Field label="Spritesheet metadata (JSON, volitelné)">
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
                      throw new Error('JSON může mít nejvýše 1 MB.');
                    const data: unknown = JSON.parse(await file.text());
                    if (mounted.current) {
                      setAtlas(data);
                      setMessage('Metadata atlasu načtené.');
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
                Použít PNG sekvenci bez metadat
              </button>
            )}
            {animationNames.length > 0 && (
              <Field label="Sekvence v atlase">
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
              Importovat animaci
            </button>
          </fieldset>
        </details>
        <h3>Knihovna a nastavení klipu</h3>
        <SelectId
          label="Animace na úpravu"
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
            <Field label="Název animace">
              <input
                value={candidate.label}
                onChange={(event) =>
                  setCandidate({ ...candidate, label: event.target.value })
                }
              />
            </Field>
            <Field label="Typ animace">
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
              Nezávislá oblast
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
                        ? 'Oblast byla nalezena porovnáním s originálem.'
                        : 'Snímky jsou totožné s originálem.',
                    );
                  }
                } catch (error) {
                  if (mounted.current)
                    setMessage(
                      error instanceof Error
                        ? error.message
                        : 'Kontrola selhala.',
                    );
                } finally {
                  if (mounted.current) setBusy(false);
                }
              }}
            >
              Zjistit změněnou oblast
            </button>
            {candidate.region && (
              <div className="bounds-fields">
                {(['x', 'y', 'width', 'height'] as const).map((key) => (
                  <Field
                    key={key}
                    label={`Oblast · ${{ x: 'X', y: 'Y', width: 'šířka', height: 'výška' }[key]} (px)`}
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
                Oblast musí být celočíselný obdélník v původním obrázku.
              </p>
            )}
            <p className="field-note">
              Oblast používá pixely původního obrázku. Mění jen tuto část
              postavy; oči a ústa mají oddělené, nepřekrývající se oblasti. Bez
              oblasti klip nahrazuje celý základ postavy. Na idle dýchání použij
              procedurální pohyb.
            </p>
            <Field label="Rychlost přehrávání (×)">
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
            <Field label="Rychlost animace (fps)">
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
              Opakovat klip
            </label>
            <Field label="Délka aktuální snímky (ms)">
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
                Rovnoměrné časování podle fps
              </button>
            )}
            <AssetField
              label="Obrázek aktuální snímky"
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
                + Snímek
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
                Odebrat snímek
              </button>
              <button disabled={current === 0} onClick={() => reorder(-1)}>
                ← Snímek
              </button>
              <button
                disabled={current === candidate.frames.length - 1}
                onClick={() => reorder(1)}
              >
                Snímek →
              </button>
            </div>
            <div className="row-actions">
              <button
                disabled={Boolean(regionError)}
                onClick={() => commit(false)}
              >
                Přidat / aktualizovat animaci
              </button>
              <button
                disabled={Boolean(regionError)}
                className="primary-button"
                onClick={() => commit(true)}
              >
                Přiřadit postavě
              </button>
              <button
                disabled={
                  !content.animations?.some((clip) => clip.id === candidate.id)
                }
                onClick={removeDefinition}
              >
                Odstranit definici
              </button>
            </div>
            <p className="field-note">
              Úpravy klipu potvrď tlačítkem Přidat / aktualizovat nebo Přiřadit
              postavě. Potom Uložit do projektu. Mrkání a reakce se vždy
              přehrají jednou; loop platí pro náhled, idle a mluvení. Soubory se
              při odebrání definice nemažou.
            </p>
          </fieldset>
        )}
      </div>
    </section>
  );
}

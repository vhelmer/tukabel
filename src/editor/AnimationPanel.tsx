import { useEffect, useRef, useState } from 'react';
import type {
  AnimationDefinition,
  AnimationKind,
  GameContent,
  Hotspot,
  ImageRegion,
} from '../game/types';
import type {
  AnimationJob,
  AnimationServiceInfo,
  SourceInfo,
} from './animationTypes';
import {
  animationJobs,
  animationServiceInfo,
  animationSourceInfo,
  cancelAnimationJob,
  readAnimationJob,
  startAnimationJob,
} from './api';
import { AssetField, Field, SelectId } from './fields';
import { nextId, replaceAt } from './model';
import { AnimationRegion } from './AnimationRegion';
import { AnimationPreview } from './AnimationPreview';

const kindLabels: Record<AnimationKind, string> = {
  blink: 'Mrkanie',
  talk: 'Rozprávanie',
  expression: 'Výraz',
  idle: 'Idle pohyb',
};
export function AnimationPanel({
  hotspot,
  content,
  assets,
  onAssets,
  onHotspot,
  onCommit,
}: {
  hotspot: Hotspot;
  content: GameContent;
  assets: readonly string[];
  onAssets: (assets: string[]) => void;
  onHotspot: (hotspot: Hotspot) => void;
  onCommit: (
    animations: readonly AnimationDefinition[],
    hotspot: Hotspot,
  ) => void;
}) {
  const source = hotspot.image!;
  const compatible = (content.animations ?? []).filter(
    (entry) => entry.source === source,
  );
  const initial =
    compatible.find((entry) => entry.id === hotspot.animation?.blink) ??
    compatible[0];
  const [candidate, setCandidate] = useState<AnimationDefinition | null>(
    initial ?? null,
  );
  const candidateRef = useRef(candidate);
  const contentRef = useRef(content);
  useEffect(() => {
    candidateRef.current = candidate;
    contentRef.current = content;
  }, [candidate, content]);
  const [service, setService] = useState<AnimationServiceInfo>();
  const [info, setInfo] = useState<SourceInfo>();
  const [kind, setKind] = useState<AnimationKind>(initial?.kind ?? 'blink');
  const [prompt, setPrompt] = useState(
    initial?.generation?.prompt ??
      'Vytvor mrknutie na 5 snímkov. Zachovaj vzhľad postavy.',
  );
  const [count, setCount] = useState(
    initial ? Math.max(3, Math.min(12, initial.frames.length)) : 5,
  );
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>(
    initial?.generation?.quality ?? 'medium',
  );
  const [mode, setMode] = useState<'region' | 'full'>(
    initial?.generation?.mode ?? 'region',
  );
  const [region, setRegion] = useState<ImageRegion | undefined>(
    initial?.generation?.region,
  );
  const [jobId, setJobId] = useState('');
  const [job, setJob] = useState<AnimationJob>();
  const [message, setMessage] = useState('');
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    let disposed = false;
    void Promise.all([
      animationServiceInfo(),
      animationSourceInfo(source),
      animationJobs(),
    ])
      .then(([service, info, jobs]) => {
        if (disposed) return;
        setService(service);
        setInfo(info);
        const recent = [...jobs]
          .reverse()
          .find(
            (entry) =>
              entry.request.source === source &&
              ['running', 'completed'].includes(entry.status),
          );
        if (recent) setJobId(recent.id);
      })
      .catch((error: unknown) => {
        if (!disposed)
          setMessage(
            error instanceof Error
              ? error.message
              : 'Zdroj sa nepodarilo načítať.',
          );
      });
    return () => {
      disposed = true;
    };
  }, [source]);
  useEffect(() => {
    if (!jobId) return;
    let disposed = false;
    let busy = false;
    let finished = false;
    const poll = async () => {
      if (busy || finished) return;
      busy = true;
      try {
        const response = await readAnimationJob(jobId);
        if (disposed) return;
        setJob(response.job);
        if (response.job.status !== 'running') {
          finished = true;
          setSubmitting(false);
          if (response.job.result) {
            onAssets(response.assets);
            const result = response.job.result;
            const target = response.job.request.targetAnimationId;
            const original =
              candidateRef.current?.id === target
                ? candidateRef.current
                : contentRef.current.animations?.find(
                    (entry) => entry.id === target,
                  );
            if (response.job.request.frameIndex !== undefined && original)
              setCandidate({
                ...original,
                frames: replaceAt(
                  original.frames,
                  response.job.request.frameIndex,
                  result.frames[0]!,
                ),
                generation: result.generation,
              });
            else if (response.job.request.frameIndex === undefined)
              setCandidate(
                contentRef.current.animations?.find(
                  (entry) => entry.id === result.id,
                ) ?? {
                  ...result,
                  label: `${kindLabels[result.kind]} postavy`,
                  fps: 12,
                },
              );
            setIndex(response.job.request.frameIndex ?? 0);
            setPlaying(false);
            setMessage(
              'Snímky sú uložené v src/assets/animations/. Pozri náhľad, potom pridaj / priraď animáciu a ulož projekt.',
            );
          } else
            setMessage(
              response.job.error ?? 'Generovanie skončilo bez výsledku.',
            );
        }
      } catch (error) {
        if (!disposed) {
          setMessage(
            error instanceof Error
              ? error.message
              : 'Čítanie generovania zlyhalo.',
          );
          finished = true;
          setSubmitting(false);
        }
      } finally {
        busy = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 800);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [jobId, onAssets]);
  const running = submitting || job?.status === 'running';
  const validRegion =
    info &&
    region &&
    [region.x, region.y, region.width, region.height].every(Number.isInteger) &&
    region.x >= 0 &&
    region.y >= 0 &&
    region.width >= 4 &&
    region.height >= 4 &&
    region.x + region.width <= info.width &&
    region.y + region.height <= info.height;
  const canGenerate =
    service?.configured &&
    info &&
    (mode === 'full' || validRegion) &&
    Number.isInteger(count) &&
    count >= 3 &&
    count <= 12 &&
    prompt.trim().length >= 3 &&
    !running;
  async function generate(frameIndex?: number) {
    if (!info) return;
    setSubmitting(true);
    setMessage('Posielam zadanie…');
    setPlaying(false);
    try {
      const next = await startAnimationJob({
        source,
        sourceRevision: info.revision,
        prompt,
        kind,
        frameCount: frameIndex === undefined ? count : candidate!.frames.length,
        quality,
        mode,
        region: mode === 'region' ? region : undefined,
        frameIndex,
        targetAnimationId: frameIndex === undefined ? undefined : candidate!.id,
      });
      setJob(next);
      setJobId(next.id);
    } catch (error) {
      setSubmitting(false);
      setMessage(
        error instanceof Error
          ? error.message
          : 'Generovanie sa nepodarilo spustiť.',
      );
    }
  }
  function select(id: string) {
    const selected = compatible.find((entry) => entry.id === id);
    setCandidate(selected ?? null);
    setIndex(0);
    setPlaying(false);
    if (selected) {
      setKind(selected.kind);
      setCount(Math.max(3, Math.min(12, selected.frames.length)));
      setPrompt(
        selected.generation?.prompt ?? 'Vytvor krátku animáciu postavy.',
      );
      setRegion(selected.generation?.region);
      setMode(selected.generation?.mode ?? 'region');
      setQuality(selected.generation?.quality ?? 'medium');
    }
  }
  function commit(assign: boolean) {
    if (!candidate) return;
    const definitions = content.animations ?? [];
    const animations = definitions.some((entry) => entry.id === candidate.id)
      ? definitions.map((entry) =>
          entry.id === candidate.id ? candidate : entry,
        )
      : [...definitions, candidate];
    const key =
      candidate.kind === 'blink'
        ? 'blink'
        : candidate.kind === 'talk'
          ? 'talk'
          : 'idle';
    onCommit(
      animations,
      assign
        ? {
            ...hotspot,
            animation: { ...hotspot.animation, [key]: candidate.id },
          }
        : hotspot,
    );
    setMessage(
      'Animácia je v pracovnom projekte. Tlačidlom Uložiť do projektu zapíš konfiguráciu do JSON.',
    );
  }
  const current = candidate ? Math.min(index, candidate.frames.length - 1) : 0;
  return (
    <details className="animation-panel">
      <summary>Animácie postavy · AI</summary>
      <p className="field-note">
        Zdroj: {source}. AI vytvára skutočné PNG snímky; produkcia prehráva iba
        lokálne súbory.
      </p>
      <h3>Prehrávanie postavy</h3>
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
                (hotspot.animation?.blinkIntervalMs ?? [3000, 7000])[position] /
                1000
              }
              onChange={(event) => {
                const values: [number, number] = [
                  ...(hotspot.animation?.blinkIntervalMs ?? [3000, 7000]),
                ];
                values[position] = Number(event.target.value) * 1000;
                onHotspot({
                  ...hotspot,
                  animation: { ...hotspot.animation, blinkIntervalMs: values },
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
          value={String(hotspot.animation?.idleLoop ?? true)}
          onChange={(event) =>
            onHotspot({
              ...hotspot,
              animation: {
                ...hotspot.animation,
                idleLoop: event.target.value === 'true',
              },
            })
          }
        >
          <option value="true">Smyčka</option>
          <option value="false">Raz, držať poslednú snímku</option>
        </select>
      </Field>
      <Field label="Pohyb bez AI">
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
      <h3>Vytvoriť / upraviť animáciu</h3>
      <SelectId
        label="Animácia na úpravu"
        value={candidate?.id ?? ''}
        values={compatible}
        empty="Nový výsledok"
        onChange={select}
      />
      <fieldset className="animation-authoring" disabled={running}>
        <legend className="sr-only">AI zadanie</legend>
        <Field label="Typ animácie">
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as AnimationKind)}
          >
            {Object.entries(kindLabels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Prompt animácie">
          <textarea
            value={prompt}
            maxLength={2000}
            onChange={(event) => {
              setPrompt(event.target.value);
              const match = /(\d+)\s*(?:sn[ií]m|sn[ií]mk|frames)/i.exec(
                event.target.value,
              );
              if (match) setCount(Number(match[1]));
            }}
          />
        </Field>
        <div className="field-row">
          <Field label="Počet snímkov">
            <input
              type="number"
              min={3}
              max={12}
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            />
          </Field>
          <Field label="Kvalita AI">
            <select
              value={quality}
              onChange={(event) =>
                setQuality(event.target.value as typeof quality)
              }
            >
              <option value="low">Low · návrh</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Field>
        </div>
        <Field label="Rozsah AI úpravy">
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            <option value="region">Iba označená oblasť (odporúčané)</option>
            <option value="full">Kompletný snímok</option>
          </select>
        </Field>
        {info && mode === 'region' && (
          <AnimationRegion
            source={source}
            size={info}
            region={region}
            onChange={setRegion}
            disabled={running}
          />
        )}
        {mode === 'full' && (
          <p className="field-note">
            Celý snímok sa generuje znova. Vzhľad aj priehľadnosť treba
            skontrolovať; mimo očí nie je zaručená zhoda pixelov.
          </p>
        )}
        <p className="field-note">
          {service?.model ?? 'OpenAI'} ·{' '}
          {kind === 'blink'
            ? Math.floor((count - 1) / 2)
            : kind === 'expression'
              ? count - 1
              : count - 2}{' '}
          platených obrázkov pre {count} snímkov. Mrknutie na 5 snímkov:
          originál → privreté → zavreté → privreté → originál.
        </p>
        {!service?.configured && (
          <p className="ai-unavailable">
            AI nie je zapnuté. Nastav OPENAI_API_KEY v .env.local a reštartuj
            npm run dev. Kľúč nedávaj do VITE_ premenných. Ručný import a náhľad
            fungujú aj bez neho.
          </p>
        )}
        <button
          disabled={!canGenerate}
          className="primary-button"
          onClick={() => void generate()}
        >
          Vygenerovať / regenerovať animáciu
        </button>
        <button
          onClick={() => {
            setCandidate({
              id: nextId(
                'animation',
                (content.animations ?? []).map((entry) => entry.id),
              ),
              label: 'Ručná animácia',
              source,
              kind,
              frames: [source],
              fps: 12,
            });
            setIndex(0);
            setPlaying(false);
          }}
        >
          Nová ručná animácia
        </button>
      </fieldset>
      {job?.status === 'running' && (
        <div className="generation-progress" role="status">
          Generujem {job.completed} / {job.total} AI obrázkov…
          <button
            onClick={() =>
              void cancelAnimationJob(job.id).catch((error: unknown) =>
                setMessage(
                  error instanceof Error ? error.message : 'Zrušenie zlyhalo.',
                ),
              )
            }
          >
            Zrušiť generovanie
          </button>
        </div>
      )}
      {message && (
        <p className="field-note" role="status" aria-label="Stav animácie">
          {message}
        </p>
      )}
      {candidate && (
        <fieldset className="animation-authoring" disabled={running}>
          <legend className="sr-only">Výsledok animácie</legend>
          <Field label="Názov animácie">
            <input
              value={candidate.label}
              onChange={(event) =>
                setCandidate({ ...candidate, label: event.target.value })
              }
            />
          </Field>
          <Field label="Rýchlosť animácie (fps)">
            <input
              type="number"
              min={1}
              max={30}
              value={candidate.fps}
              onChange={(event) =>
                setCandidate({ ...candidate, fps: Number(event.target.value) })
              }
            />
          </Field>
          <AnimationPreview
            animation={candidate}
            index={current}
            onIndex={setIndex}
            playing={playing}
            onPlaying={setPlaying}
          />
          <AssetField
            label="Obrázok aktuálnej snímky"
            value={candidate.frames[current] ?? source}
            assets={assets}
            onAssets={onAssets}
            onChange={(frame) =>
              setCandidate(
                (previous) =>
                  previous && {
                    ...previous,
                    frames: replaceAt(previous.frames, current, frame),
                  },
              )
            }
          />
          <div className="row-actions">
            <button
              disabled={candidate.frames.length >= 24}
              onClick={() =>
                setCandidate({
                  ...candidate,
                  frames: [
                    ...candidate.frames,
                    candidate.frames[current] ?? source,
                  ],
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
                  frames: candidate.frames.filter(
                    (_, position) => position !== current,
                  ),
                });
                setIndex(Math.max(0, current - 1));
              }}
            >
              Odobrať snímku
            </button>
            <button
              disabled={current === 0}
              onClick={() => {
                const frames = [...candidate.frames];
                [frames[current - 1], frames[current]] = [
                  frames[current]!,
                  frames[current - 1]!,
                ];
                setCandidate({ ...candidate, frames });
                setIndex(current - 1);
              }}
            >
              ← Snímka
            </button>
            <button
              disabled={
                !canGenerate ||
                candidate.frames.length < 3 ||
                candidate.frames.length > 12 ||
                !content.animations?.some((entry) => entry.id === candidate.id)
              }
              onClick={() => void generate(current)}
            >
              Regenerovať túto snímku
            </button>
          </div>
          <div className="row-actions">
            <button onClick={() => commit(false)}>
              Pridať / aktualizovať animáciu
            </button>
            <button className="primary-button" onClick={() => commit(true)}>
              Priradiť postave
            </button>
            <button
              className="danger-button"
              disabled={
                !content.animations?.some((entry) => entry.id === candidate.id)
              }
              onClick={() => {
                onCommit(
                  (content.animations ?? []).filter(
                    (entry) => entry.id !== candidate.id,
                  ),
                  hotspot,
                );
                setCandidate(null);
              }}
            >
              Odstrániť definíciu
            </button>
          </div>
          <p className="field-note">
            Priradenie upraví návrh. Potom Uložiť do projektu zapisuje
            konfiguráciu. Pri odstránení oprav odkazy; súbory sa automaticky
            nemažú.
          </p>
        </fieldset>
      )}
    </details>
  );
}

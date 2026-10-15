import { useEffect, useRef, useState } from 'react';
import type {
  AnimationDefinition,
  AnimationKind,
  GameContent,
  Hotspot,
} from '../game/types';
import type {
  AnimationJob,
  AnimationServiceInfo,
  SourceInfo,
  AnimationBackground,
} from './animationTypes';
import {
  animationJobs,
  animationServiceInfo,
  animationSourceInfo,
  cancelAnimationJob,
  readAnimationJob,
  startAnimationJob,
  saveAnimationVideo,
} from './api';
import { AssetField, Field, SelectId } from './fields';
import { nextId, replaceAt } from './model';
import { AnimationPreview } from './AnimationPreview';
import { assetUrl } from '../game/assets';

const kindLabels: Record<AnimationKind, string> = {
  blink: 'Mrkanie',
  talk: 'Rozprávanie',
  expression: 'Výraz',
  idle: 'Idle pohyb',
};
const prompts: Record<AnimationKind, string> = {
  blink:
    'The character blinks once naturally, then returns to the original pose. Very subtle movement.',
  idle: 'The character breathes gently in place, with a subtle relaxed idle movement. Seamless resting pose.',
  talk: 'The character speaks calmly with small mouth movements and minimal head motion, then returns to rest.',
  expression:
    'The character briefly smiles, keeping the original pose and appearance.',
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
  const contentRef = useRef(content);
  useEffect(() => {
    contentRef.current = content;
  }, [content]);
  const [service, setService] = useState<AnimationServiceInfo>();
  const [info, setInfo] = useState<SourceInfo>();
  const [kind, setKind] = useState<AnimationKind>(initial?.kind ?? 'blink');
  const [prompt, setPrompt] = useState(
    initial?.generation?.prompt ?? prompts.blink,
  );
  const [duration, setDuration] = useState<2 | 3 | 5>(2);
  const [background, setBackground] = useState<AnimationBackground>(
    initial?.generation?.background ?? 'magenta',
  );
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(2);
  const [fps, setFps] = useState(12);
  const [keySimilarity, setKeySimilarity] = useState(0.2);
  const [jobId, setJobId] = useState('');
  const [job, setJob] = useState<AnimationJob>();
  const [message, setMessage] = useState('');
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
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
    let disposed = false,
      busy = false,
      finished = false;
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
          if (response.job.video) {
            onAssets(response.assets);
            setTrimStart(0);
            setTrimEnd(response.job.request.duration);
            if (response.job.result)
              setCandidate(
                contentRef.current.animations?.find(
                  (entry) => entry.id === response.job.result!.id,
                ) ?? response.job.result,
              );
            setMessage(
              'Pôvodné MP4 je uložené. Pozri video, vyber úsek a ulož herné snímky.',
            );
          } else
            setMessage(response.job.error ?? 'Generovanie skončilo bez videa.');
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
    const timer = window.setInterval(() => void poll(), 900);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [jobId, onAssets]);
  const running = submitting || job?.status === 'running';
  const video = job?.video ?? candidate?.generation?.video;
  const canGenerate =
    service?.configured &&
    service.processorAvailable &&
    info &&
    prompt.trim().length >= 3 &&
    !running &&
    !saving;
  const canProcess =
    job?.video &&
    service?.processorAvailable &&
    !running &&
    !saving &&
    Number.isFinite(trimStart) &&
    Number.isFinite(trimEnd) &&
    trimStart >= 0 &&
    trimEnd > trimStart &&
    trimEnd <= job.request.duration + 0.05 &&
    trimEnd - trimStart >= 0.08 &&
    Number.isInteger(fps) &&
    fps >= 1 &&
    fps <= 24 &&
    Math.ceil((trimEnd - trimStart) * fps) <= 120 &&
    keySimilarity >= 0.05 &&
    keySimilarity <= 0.5;
  async function generate() {
    if (!info) return;
    setSubmitting(true);
    setMessage('Odosielam celý asset…');
    setPlaying(false);
    try {
      const next = await startAnimationJob({
        source,
        sourceRevision: info.revision,
        prompt,
        kind,
        duration,
        background,
      });
      setCandidate(null);
      setJob(next);
      setJobId(next.id);
    } catch (error) {
      setSubmitting(false);
      setMessage(
        error instanceof Error ? error.message : 'Generovanie zlyhalo.',
      );
    }
  }
  async function saveFrames() {
    if (!job) return;
    setSaving(true);
    setMessage('FFmpeg spracúva video a ukladá PNG snímky…');
    try {
      const result = await saveAnimationVideo(job.id, {
        trimStart,
        trimEnd,
        fps,
        keySimilarity,
      });
      onAssets(result.assets);
      setCandidate(result.animation);
      setIndex(0);
      setPlaying(false);
      setJob({ ...job, result: result.animation });
      setMessage(
        'Video aj herné snímky sú na disku. Priraď animáciu postave a ulož projekt.',
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Spracovanie videa zlyhalo.',
      );
    } finally {
      setSaving(false);
    }
  }
  function select(id: string) {
    const selected = compatible.find((entry) => entry.id === id);
    setCandidate(selected ?? null);
    setIndex(0);
    setPlaying(false);
    setJob(undefined);
    setJobId('');
    if (selected) {
      setKind(selected.kind);
      setPrompt(selected.generation?.prompt ?? prompts[selected.kind]);
      setBackground(selected.generation?.background ?? 'magenta');
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
      'Animácia je v pracovnom projekte. Uložiť do projektu zapíše konfiguráciu do JSON.',
    );
  }
  const current = candidate ? Math.min(index, candidate.frames.length - 1) : 0;
  return (
    <details className="animation-panel">
      <summary>Animácie postavy · fal.ai</summary>
      <p className="field-note">
        Zdroj: {source}. Do fal.ai sa odošle celý asset. Produkcia prehráva iba
        lokálne PNG snímky.
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
      <fieldset className="animation-authoring" disabled={running || saving}>
        <legend className="sr-only">fal.ai zadanie</legend>
        <Field label="Typ animácie">
          <select
            value={kind}
            onChange={(event) => {
              const next = event.target.value as AnimationKind;
              setKind(next);
              setPrompt(prompts[next]);
            }}
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
            onChange={(event) => setPrompt(event.target.value)}
          />
        </Field>
        <Field label="Dĺžka AI videa">
          <select
            value={duration}
            onChange={(event) =>
              setDuration(Number(event.target.value) as 2 | 3 | 5)
            }
          >
            <option value={2}>2 sekundy</option>
            <option value={3}>3 sekundy</option>
            <option value={5}>5 sekúnd</option>
          </select>
        </Field>
        <Field label="Pozadie videa">
          <select
            value={background}
            onChange={(event) =>
              setBackground(event.target.value as AnimationBackground)
            }
          >
            <option value="magenta">Magenta → priehľadné snímky</option>
            <option value="green">Zelené → priehľadné snímky</option>
            <option value="keep">Ponechať pozadie (nepriehľadné)</option>
          </select>
        </Field>
        <p className="field-note">
          Pre PNG/WebP s priehľadnosťou zvoľ farbu, ktorú postava nepoužíva.
          Nepriehľadné pozadie sa automaticky neodstráni. Každé generovanie je
          jedno platené video; časový výber a extrakcia sú lokálne.
        </p>
        <p className="field-note">
          Model: {service?.model ?? 'fal.ai Wan 2.2 5B'}. Bez záruky rovnakej
          podoby alebo uzavretej slučky — skontroluj video a snímky.
        </p>
        {!service?.configured && (
          <p className="ai-unavailable">
            Nastav FAL_KEY v .env.local a reštartuj npm run dev. OpenAI kľúč sa
            na animácie nepoužíva. Ručný import a náhľad fungujú aj bez fal.ai.
          </p>
        )}
        {service && !service.processorAvailable && (
          <p className="ai-unavailable">
            FFmpeg chýba. Spusti npm ci alebo nastav absolútnu FFMPEG_PATH a
            reštartuj server.
          </p>
        )}
        <button
          className="primary-button"
          disabled={!canGenerate}
          onClick={() => void generate()}
        >
          Vygenerovať / regenerovať video
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
          {job.phase}
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
      {video && (
        <div className="video-processing">
          <h3>Video → herné snímky</h3>
          <video
            key={video}
            className="animation-video"
            aria-label="Náhľad fal.ai videa"
            src={assetUrl(video)}
            controls
            playsInline
            preload="metadata"
          />
          <a className="field-note" href={assetUrl(video)} download>
            Stiahnuť pôvodné MP4
          </a>
          {job?.video && (
            <fieldset
              className="animation-authoring"
              disabled={saving || running}
            >
              <legend className="sr-only">Spracovanie celého videa</legend>
              <div className="field-row">
                <Field label="Začiatok úseku (s)">
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={trimStart}
                    onChange={(event) =>
                      setTrimStart(Number(event.target.value))
                    }
                  />
                </Field>
                <Field label="Koniec úseku (s)">
                  <input
                    type="number"
                    min={0.1}
                    max={job.request.duration}
                    step={0.05}
                    value={trimEnd}
                    onChange={(event) => setTrimEnd(Number(event.target.value))}
                  />
                </Field>
              </div>
              <Field label="Extrakcia snímkov (fps)">
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={fps}
                  onChange={(event) => setFps(Number(event.target.value))}
                />
              </Field>
              {job.request.background !== 'keep' && (
                <Field label="Sila odstránenia pozadia">
                  <input
                    type="number"
                    min={0.05}
                    max={0.5}
                    step={0.01}
                    value={keySimilarity}
                    onChange={(event) =>
                      setKeySimilarity(Number(event.target.value))
                    }
                  />
                </Field>
              )}
              <p className="field-note">
                Výber: približne{' '}
                {Math.max(0, Math.ceil((trimEnd - trimStart) * fps))} snímkov,
                max. 120. Dlhšia strana do 512 px. Kľúčovanie sa týka celého
                snímku. Farba v oblečení sa môže tiež odstrániť.
              </p>
              <button
                className="primary-button"
                disabled={!canProcess}
                onClick={() => void saveFrames()}
              >
                {saving ? 'Spracúvam video…' : 'Uložiť herné snímky'}
              </button>
            </fieldset>
          )}
        </div>
      )}
      {candidate && (
        <fieldset className="animation-authoring" disabled={running || saving}>
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
              disabled={candidate.frames.length >= 120}
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
      )}{' '}
    </details>
  );
}

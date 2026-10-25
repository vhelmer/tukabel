import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameContent } from '../game/types';
import { validateProject } from '../game/validateProject';
import { getCodexStatus, getMaskSource, submitEditorJob } from './api';
import { applyCodexResult } from './codex';
import type { CodexContext, CodexStatus, CodexTask } from './codex';
import { artFingerprint } from './jobs';
import type { EditorJob } from './jobs';
import { Field } from './fields';
import { CombinedPreview } from './CharacterPreview';
import { AnimationPreview } from './AnimationPreview';

export function CodexPanel({
  active,
  context,
  selection,
  content,
  assets,
  jobs,
  selectedJob,
  onSubmitted,
  onDismiss,
  onAssets,
  onChange,
  locked = false,
}: {
  active: boolean;
  context: CodexContext;
  selection?: () => CodexContext['selection'];
  content: GameContent;
  assets: readonly string[];
  jobs: readonly EditorJob[];
  selectedJob: string;
  onSubmitted: (job: EditorJob) => void;
  onDismiss: (id: string) => void;
  onAssets: (ids: string[]) => void;
  onChange: (content: GameContent) => void;
  locked?: boolean;
}) {
  const [status, setStatus] = useState<CodexStatus>();
  const [prompt, setPrompt] = useState(
    context.mode === 'character'
      ? 'Připrav přirozené mrknutí a odlišné tvary úst pro mluvení. Zachovej původní kresbu, obrysy a všechny pixely mimo oči a ústa.'
      : 'Rozpohybuj vybranou oblast jemnou plynulou smyčkou. Zachovej kreslený styl, umístění a pevné okraje.',
  );
  const [task, setTask] = useState<CodexTask>(
    context.mode === 'character' ? 'blink-talk' : 'ambient',
  );
  const [count, setCount] = useState(5),
    [fps, setFps] = useState(12);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [preview, setPreview] = useState('combined'),
    [index, setIndex] = useState(0),
    [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const details = useRef<HTMLDetailsElement>(null);
  const mounted = useRef(false),
    applied = useRef('');
  useEffect(() => {
    mounted.current = true;
    void getCodexStatus()
      .then((data) => {
        if (mounted.current) setStatus(data);
      })
      .catch(() => {
        if (mounted.current) setMessage('Stav Codex CLI nelze načíst.');
      });
    return () => {
      mounted.current = false;
    };
  }, []);
  const candidates = jobs.filter(
    (j): j is Extract<EditorJob, { kind: 'codex' }> =>
      j.kind === 'codex' &&
      j.context.mode === context.mode &&
      j.context.sceneId === context.sceneId &&
      j.context.targetId === context.targetId,
  );
  const job = candidates.find((j) => j.id === selectedJob) ?? candidates.at(-1);
  const jobId = job?.id;
  useEffect(() => {
    if (jobId && details.current) details.current.open = true;
  }, [jobId]);
  const result = job?.result;
  useEffect(() => {
    if (result) onAssets(result.assets);
  }, [result, onAssets]);
  const stale =
    !!job &&
    (job.context.fingerprint !== context.fingerprint ||
      job.context.source !== context.source);
  const proposal = useMemo(
    () =>
      job?.result
        ? applyCodexResult(content, job.context, job.result)
        : undefined,
    [content, job],
  );
  const validation =
    proposal && result
      ? validateProject(proposal, [...new Set([...assets, ...result.assets])])
      : [];
  const scene = proposal?.scenes.find((s) => s.id === context.sceneId);
  const actor = scene?.hotspots.find(
    (h) =>
      h.id ===
      (context.mode === 'character' ? context.targetId : result?.clips[0]?.id),
  );
  const clip = result?.clips.find((c) => c.id === preview) ?? result?.clips[0];
  const [verified, setVerified] = useState<{ job: string; hash: string }>();
  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      const target = content.scenes
        .find((s) => s.id === context.sceneId)
        ?.hotspots.find((h) => h.id === context.targetId);
      const captured = {
        ...context,
        selection: selection?.(),
        protectedRegions:
          context.mode === 'character' && task === 'gesture'
            ? (content.animations ?? []).flatMap((clip) =>
                [target?.animation?.blink, target?.animation?.talk].includes(
                  clip.id,
                ) && clip.region
                  ? [clip.region]
                  : [],
              )
            : undefined,
      };
      const next = await submitEditorJob({
        kind: 'codex',
        label: 'Codex · ' + context.label,
        context: captured,
        input: { prompt, task, count, fps, confirmed: true },
      });
      onSubmitted(next);
      if (mounted.current)
        setMessage('Agent je ve frontě. Můžeš pokračovat v práci.');
    } catch (e) {
      if (mounted.current)
        setMessage(e instanceof Error ? e.message : 'Spuštění selhalo.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  // Read-only verification never applies an old draft after an asynchronous wait.
  useEffect(() => {
    if (!result || !jobId) return;
    let disposed = false;
    void getMaskSource(result.source)
      .then((source) => {
        if (source.sourceSha256 !== result.sourceSha256)
          throw Error('Zdrojový soubor se změnil. Připrav novou úlohu.');
        if (!disposed) setVerified({ job: jobId, hash: result.sourceSha256 });
      })
      .catch((error: unknown) => {
        if (!disposed)
          setMessage(
            error instanceof Error ? error.message : 'Ověření zdroje selhalo.',
          );
      });
    return () => {
      disposed = true;
    };
  }, [result, jobId]);
  return (
    <section
      className="codex-panel"
      aria-label={
        context.mode === 'character'
          ? 'Codex animace postavy'
          : 'Codex animace oblasti'
      }
    >
      <details
        ref={details}
        onToggle={(e) => setExpanded(e.currentTarget.open)}
      >
        <summary>Codex CLI · připravit nové animační snímky</summary>
        <p>
          Lokální agent připraví a spustí skript nad kopií obrázku. Výsledek
          nejprve zkontroluješ, potom přiřadíš do návrhu.
        </p>
        <p className="field-note">
          {status
            ? [status.version, status.model, status.effort, status.message]
                .filter(Boolean)
                .join(' · ')
            : 'Ověřuji místní Codex CLI…'}
        </p>
        <p className="field-note">
          Zdroj: {context.source}
          {context.mode === 'scene' ? ' · použije se výběr nad scénou' : ''}
        </p>
        <fieldset disabled={busy || locked}>
          <Field label="Úloha pro Codex">
            <select
              value={task}
              onChange={(e) => {
                const next = e.target.value as CodexTask;
                setTask(next);
                setPrompt(
                  next === 'gesture'
                    ? 'Postava se přirozeně poškrábe rukou na hlavě a vrátí ruku do původní polohy. Zachovej ukotvení hlavy, očí, úst a těla, původní styl, oblečení a obrysy. První i poslední snímek musí být originál.'
                    : next === 'blink'
                      ? 'Připrav přirozené mrknutí. Měň pouze oči, zachovej původní alfu a první i poslední snímek jako originál.'
                      : next === 'talk'
                        ? 'Připrav odlišné tvary úst pro mluvení. Měň pouze oblast úst, zachovej oči, oblečení a původní alfu.'
                        : next === 'blink-talk'
                          ? 'Připrav přirozené mrknutí a odlišné tvary úst pro mluvení. Zachovej původní kresbu, obrysy a všechny pixely mimo oči a ústa.'
                          : 'Rozpohybuj vybranou oblast jemnou plynulou smyčkou. Zachovej kreslený styl, umístění a pevné okraje.',
                );
                setCount(next === 'gesture' ? 12 : 5);
                setFps(next === 'gesture' ? 10 : 12);
              }}
            >
              {context.mode === 'character' ? (
                <>
                  <option value="blink-talk">
                    Mrkání a ústa · nezávislé klipy
                  </option>
                  <option value="blink">Mrkání</option>
                  <option value="talk">Tvary úst pro mluvení</option>
                  <option value="gesture">Běžné gesto postavy · náhodně</option>
                </>
              ) : (
                <option value="ambient">Plynulá animace vybrané oblasti</option>
              )}
            </select>
          </Field>
          {task === 'gesture' && (
            <p className="field-note">
              Například škrábání na hlavě, pokrčení ramen nebo úprava oblečení.
              Gesto se přehraje jednou a vrátí do klidu. Po přiřazení se spouští
              náhodně každé 2–5 sekund; interval upravíš v Přehrávání postavy.
              Hlavu drž na místě kvůli nezávislým očím a ústům. Pro pohyb ruky
              musí být na zdrojovém plátně dost místa.
            </p>
          )}
          <Field label="Zadání pro agenta">
            <textarea
              rows={4}
              maxLength={6000}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </Field>
          <div className="row-actions">
            <Field label="Počet snímků každého klipu">
              <input
                type="number"
                min={5}
                max={24}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </Field>
            <Field label="Rychlost nových klipů (fps)">
              <input
                type="number"
                min={1}
                max={30}
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
              />
            </Field>
          </div>
          <button
            disabled={!status?.available || !prompt.trim() || busy}
            onClick={() => void submit()}
          >
            Spustit místního Codex agenta
          </button>
        </fieldset>
        <p role="status">
          {job?.error ??
            (job && ['queued', 'running', 'cancelled'].includes(job.status)
              ? job.stage
              : message)}
        </p>
        {job?.status === 'running' && (
          <p className="field-note">
            Běh lze zastavit v přehledu Úlohy na pozadí.
          </p>
        )}
        {job?.result && result && proposal && (
          <div className="codex-result">
            <h3>Výsledek Codexu · ke kontrole</h3>
            <p>{result.notes}</p>
            <p className="field-note">Zadání: {job.context.instruction}</p>
            <p className="field-note">
              Zadání a reprodukční skripty: {result.manifest}
            </p>
            {stale && (
              <p role="alert">
                Zdroj nebo cílová vrstva se mezitím změnily. Výsledek nemůže
                přepsat novější úpravy.
              </p>
            )}
            {validation.length > 0 && (
              <p role="alert">{validation.join('\n')}</p>
            )}
            <Field label="Náhled výsledku Codexu">
              <select
                value={preview}
                onChange={(e) => {
                  setPreview(e.target.value);
                  setIndex(0);
                  setPlaying(false);
                }}
              >
                {context.mode === 'character' && (
                  <option value="combined">
                    Souběžné oči, ústa, gesta a idle
                  </option>
                )}
                {context.mode === 'scene' && (
                  <option value="combined">Smyčka oblasti</option>
                )}
                {result.clips.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} · {c.frames.length} snímků
                  </option>
                ))}
              </select>
            </Field>
            {!stale &&
              !validation.length &&
              (preview === 'combined' &&
              context.mode === 'character' &&
              actor ? (
                <CombinedPreview
                  active={active && expanded}
                  hotspot={actor}
                  clips={proposal.animations ?? []}
                />
              ) : (
                clip && (
                  <AnimationPreview
                    active={active && expanded}
                    animation={clip}
                    index={index}
                    onIndex={setIndex}
                    playing={playing}
                    onPlaying={setPlaying}
                  />
                )
              ))}
            <div className="row-actions">
              <button
                disabled={
                  busy ||
                  locked ||
                  stale ||
                  !!validation.length ||
                  verified?.job !== job.id ||
                  verified.hash !== result.sourceSha256
                }
                onClick={() => {
                  const current = content.scenes.find(
                    (s) => s.id === context.sceneId,
                  );
                  if (
                    !current ||
                    locked ||
                    artFingerprint(current, context.targetId) !==
                      job.context.fingerprint ||
                    stale ||
                    validation.length ||
                    applied.current === job.id
                  )
                    return;
                  applied.current = job.id;
                  onChange(proposal);
                  onDismiss(job.id);
                  setMessage(
                    'Animace jsou v návrhu. Uložit do projektu zapíše konfiguraci; Zpět vrátí přiřazení.',
                  );
                }}
              >
                Přiřadit výsledek do návrhu
              </button>
              <button onClick={() => onDismiss(job.id)}>
                Odložit výsledek Codexu
              </button>
            </div>
          </div>
        )}
      </details>
    </section>
  );
}

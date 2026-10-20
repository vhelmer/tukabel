import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameContent, Hotspot } from '../game/types';
import { validateProject } from '../game/validateProject';
import { getDirectionStatus, submitEditorJob } from './api';
import { directedBinding } from './jobs';
import type { EditorJob } from './jobs';
import { CombinedPreview } from './CharacterPreview';
import { Field } from './fields';

export function AnimationDirectionPanel({
  active,
  sceneId,
  hotspot,
  content,
  assets,
  jobs,
  selectedJob,
  onSubmitted,
  onDismiss,
  onHotspot,
}: {
  active: boolean;
  sceneId: string;
  hotspot: Hotspot;
  content: GameContent;
  assets: readonly string[];
  jobs: readonly EditorJob[];
  selectedJob: string;
  onSubmitted: (job: EditorJob) => void;
  onDismiss: (id: string) => void;
  onHotspot: (h: Hotspot) => void;
}) {
  const [prompt, setPrompt] = useState(
    'Postava občas prirodzene mrkne, pri rozprávaní pohybuje ústami a jemne sa pohupuje. Pôsobí trochu nervózne.',
  );
  const [status, setStatus] = useState<{
    configured: boolean;
    model: string;
  }>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const details = useRef<HTMLDetailsElement>(null);
  const [expanded, setExpanded] = useState(false);
  const mounted = useRef(false),
    applied = useRef('');
  useEffect(() => {
    mounted.current = true;
    void getDirectionStatus()
      .then((s) => {
        if (mounted.current) setStatus(s);
      })
      .catch(() => {
        if (mounted.current) setMessage('AI stav sa nepodarilo načítať.');
      });
    return () => {
      mounted.current = false;
    };
  }, []);
  const candidates = jobs.filter(
    (j): j is Extract<EditorJob, { kind: 'animation' }> =>
      j.kind === 'animation' &&
      j.context.sceneId === sceneId &&
      j.context.targetId === hotspot.id,
  );
  const job = candidates.find((j) => j.id === selectedJob) ?? candidates.at(-1);
  const jobId = job?.id;
  useEffect(() => {
    if (jobId && details.current) details.current.open = true;
  }, [jobId]);
  const clips = useMemo(
    () => (content.animations ?? []).filter((c) => c.source === hotspot.image),
    [content.animations, hotspot.image],
  );
  const stale =
    !!job &&
    (job.context.source !== hotspot.image ||
      JSON.stringify(job.context.binding) !==
        JSON.stringify(hotspot.animation ?? {}) ||
      JSON.stringify(job.context.clips) !== JSON.stringify(clips));
  const proposal = useMemo(
    () =>
      job?.result
        ? { ...hotspot, animation: directedBinding(job.context, job.result) }
        : undefined,
    [hotspot, job],
  );
  // Run the same full validation as Save, including regional overlap, references,
  // dialogue/voice mapping and all current edits, before offering Apply.
  const errors = proposal
    ? validateProject(
        {
          ...content,
          scenes: content.scenes.map((s) =>
            s.id === sceneId
              ? {
                  ...s,
                  hotspots: s.hotspots.map((h) =>
                    h.id === hotspot.id ? proposal : h,
                  ),
                }
              : s,
          ),
        },
        assets,
      )
    : [];
  async function submit() {
    if (busy) return;
    setBusy(true);
    setMessage('Odosielam úlohu…');
    try {
      const next = await submitEditorJob({
        kind: 'animation',
        label: `Pohyb · ${hotspot.label}`,
        context: {
          sceneId,
          targetId: hotspot.id,
          source: hotspot.image!,
          binding: hotspot.animation ?? {},
          clips,
        },
        input: { prompt, confirmed: true },
      });
      onSubmitted(next);
      if (mounted.current)
        setMessage('Návrh beží na pozadí. Môžeš pokračovať v práci.');
    } catch (e) {
      if (mounted.current)
        setMessage(e instanceof Error ? e.message : 'Odoslanie zlyhalo.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section className="animation-direction" aria-label="Textová réžia postavy">
      <details
        ref={details}
        onToggle={(e) => setExpanded(e.currentTarget.open)}
      >
        <summary>Textová réžia · experiment</summary>
        <p className="field-note">
          AI navrhne priradenia hotových klipov, interval mrkania a jemný pohyb
          celej postavy. Nevytvára nové snímky ani samostatný pohyb hlavy. Oči,
          ústa, dabing a ich mapovanie zostávajú nezávislé.
        </p>
        <Field label="Ako sa má postava správať?">
          <textarea
            rows={4}
            maxLength={4000}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </Field>
        <p className="field-note">
          {status?.configured
            ? `OpenAI · ${status.model} · jedno vedomé volanie API, bez automatického opakovania.`
            : 'Vyžaduje serverový OPENAI_API_KEY v .env.local a reštart Vite. Import a ručné nastavenia fungujú bez AI.'}
        </p>
        <button
          disabled={
            busy || !status?.configured || !prompt.trim() || hotspot.locked
          }
          onClick={() => void submit()}
        >
          Navrhnúť správanie cez AI (API kredit)
        </button>
        <p role="status">
          {job?.error ??
            (job && ['queued', 'running'].includes(job.status)
              ? job.stage
              : message)}
        </p>
        {proposal && job?.result && (
          <div className="direction-result">
            <h4>Návrh na kontrolu</h4>
            <p className="field-note">Zadanie: {job.context.instruction}</p>
            <p>{job.result.notes}</p>
            <dl>
              <dt>Oči</dt>
              <dd>
                {clips.find((c) => c.id === proposal.animation?.blink)?.label ??
                  'Vypnuté'}{' '}
                · {job.result.minMs / 1000}–{job.result.maxMs / 1000} s
              </dd>
              <dt>Ústa počas dialógu</dt>
              <dd>
                {clips.find((c) => c.id === proposal.animation?.talk)?.label ??
                  'Vypnuté'}
              </dd>
              <dt>Pohyb celej postavy</dt>
              <dd>
                {
                  { none: 'Vypnutý', breath: 'Dýchanie', sway: 'Pohupovanie' }[
                    job.result.motion
                  ]
                }
              </dd>
            </dl>
            {stale && (
              <p role="alert">
                Postava alebo klipy sa medzitým zmenili. Tento návrh nemôže
                prepísať novšie nastavenia.
              </p>
            )}
            {errors.length > 0 && <p role="alert">{errors.join('\n')}</p>}
            {!stale && !errors.length && (
              <CombinedPreview
                active={active && expanded}
                hotspot={proposal}
                clips={clips}
              />
            )}
            <div className="row-actions">
              <button
                disabled={stale || !!errors.length || hotspot.locked}
                onClick={() => {
                  if (
                    stale ||
                    errors.length ||
                    hotspot.locked ||
                    applied.current === job.id
                  )
                    return;
                  applied.current = job.id;
                  onHotspot(proposal);
                  onDismiss(job.id);
                  setMessage(
                    'Návrh je použitý. Uložiť do projektu zapíše konfiguráciu; Späť ho vráti.',
                  );
                }}
              >
                Použiť navrhnuté správanie
              </button>
              <button onClick={() => onDismiss(job.id)}>Zahodiť návrh</button>
            </div>
          </div>
        )}
      </details>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { GameContent, Hotspot, SceneDefinition } from '../game/types';
import { assetUrl } from '../game/assets';
import { centre, imagePlacement, rotateAround } from '../game/transforms';
import type { Point } from '../game/transforms';
import { polygonIssue } from '../game/polygon';
import { useImageSize } from './useImageSize';
import { submitEditorJob, getArtStatus } from './api';
import type { ArtworkResult } from './api';
import { MaskEditor } from './MaskEditor';
import { ExtractionComparison } from './ExtractionComparison';
import type { ObjectMask } from './masks';
import { AnimationPreview } from './AnimationPreview';
import { Field } from './fields';
import { artFingerprint } from './jobs';
import type { EditorJob } from './jobs';
import { nextId } from './model';

const presets: Record<string, string> = {
  edit: 'Uprav označený detail. Zachovaj kreslený štýl, perspektívu a svetlo pôvodnej lokácie.',
  extract:
    'Odstráň označený objekt a prirodzene dokresli pozadie za ním v rovnakom výtvarnom štýle.',
  remove:
    'Odstráň označený objekt a prirodzene dokresli pozadie za ním v rovnakom výtvarnom štýle.',
  generate:
    'Nová groteskná kreslená lokácia pre point-and-click adventúru. Zachovaj štýl a farebnosť referencie. Bez postáv, titulkov a používateľského rozhrania.',
};
export function SceneArtPanel({
  active,
  jobs,
  selectedJob,
  onSubmitted,
  onDismiss,
  content,
  scene,
  hotspot,
  selection,
  onSelection,
  onChange,
  onAssets,
  onScene,
  onSelect,
}: {
  active: boolean;
  jobs: readonly EditorJob[];
  selectedJob: string;
  onSubmitted: (job: EditorJob) => void;
  onDismiss: (id: string) => void;
  content: GameContent;
  scene: SceneDefinition;
  hotspot?: Hotspot;
  selection?: readonly Point[];
  onSelection: (points?: readonly Point[]) => void;
  onChange: (content: GameContent) => void;
  onAssets: (assets: string[]) => void;
  onScene: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const [operation, setOperation] =
    useState<ArtworkResult['operation']>('cutout');
  const openedJob = jobs.find(
    (job) =>
      job.kind === 'art' &&
      job.id === selectedJob &&
      job.context.sceneId === scene.id &&
      job.context.targetId === (hotspot?.id ?? ''),
  );
  const jobTarget = openedJob?.context.targetId ? 'object' : 'background';
  // Selecting a character must not silently retarget a selection on the scenery.
  // Explicitly opening a saved job still restores the source of that job.
  const [targetChoice, setTargetChoice] = useState({
    jobId: selectedJob,
    value: jobTarget,
  });
  const target =
    targetChoice.jobId === selectedJob ? targetChoice.value : jobTarget;
  const [prompt, setPrompt] = useState('');
  const [label, setLabel] = useState('Nový výrez');
  const [motion, setMotion] = useState('water');
  const [amplitude, setAmplitude] = useState(4),
    [fps, setFps] = useState(8),
    [count, setCount] = useState(16);
  const [status, setStatus] = useState<{
    configured: boolean;
    model: string;
    segmentation?: { grabcut: boolean; sam2: boolean };
  }>();
  const mounted = useRef(false),
    applied = useRef('');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [maskDraft, setMaskDraft] = useState<{
    scope: string;
    points?: readonly Point[];
  }>();
  const [objectMask, setObjectMask] = useState<{
    scope: string;
    mask: ObjectMask;
  }>();
  const [message, setMessage] = useState('');
  const [maskError, setMaskError] = useState<{ scope: string; text: string }>();
  const [busy, setBusy] = useState(false);
  const [index, setIndex] = useState(0),
    [playing, setPlaying] = useState(false);
  const object =
    target === 'object' && operation !== 'generate' ? hotspot : undefined;
  const source = object?.image ?? scene.background;
  const maskScope = JSON.stringify([
    source,
    object?.bounds,
    object?.rotation,
    object?.imageFit,
    selection,
  ]);
  const preparedMask =
    objectMask?.scope === maskScope ? objectMask.mask : undefined;
  const candidates = jobs.filter(
    (job): job is Extract<EditorJob, { kind: 'art' }> =>
      job.kind === 'art' &&
      job.context.sceneId === scene.id &&
      job.context.targetId === (object?.id ?? ''),
  );
  const job = candidates.find((j) => j.id === selectedJob) ?? candidates.at(-1);
  const result = job?.result ? { data: job.result, ...job.context } : undefined;
  const resultData = job?.result;
  useEffect(() => {
    if (resultData) onAssets(resultData.assets);
  }, [resultData, onAssets]);
  const size = useImageSize(source);
  const ai = !['cutout', 'loop'].includes(operation);
  const needsSelection = ['cutout', 'loop', 'extract', 'remove'].includes(
    operation,
  );
  useEffect(() => {
    let disposed = false;
    void getArtStatus()
      .then((s) => {
        if (!disposed) setStatus(s);
      })
      .catch(() => {
        if (!disposed)
          setMessage(
            'AI stav sa nepodarilo načítať; lokálne nástroje fungujú ďalej.',
          );
      });
    return () => {
      disposed = true;
    };
  }, []);
  function sourceSelection() {
    if (!size) throw Error('Počkaj na načítanie zdroja.');
    const placement: Pick<Hotspot, 'bounds' | 'rotation' | 'imageFit'> =
      object ?? {
        bounds: { x: 0, y: 0, width: scene.width, height: scene.height },
        imageFit: 'stretch' as const,
      };
    let points: Point[] | undefined;
    if (selection && operation !== 'generate') {
      const b = imagePlacement(placement.bounds, size, placement.imageFit);
      points = selection.map((p) => {
        const local = rotateAround(
          p,
          centre(placement.bounds),
          -(placement.rotation ?? 0),
        );
        return {
          x: ((local.x - b.x) * size.width) / b.width,
          y: ((local.y - b.y) * size.height) / b.height,
        };
      });
      if (
        points.some(
          (p) =>
            p.x < -0.001 ||
            p.y < -0.001 ||
            p.x > size.width + 0.001 ||
            p.y > size.height + 0.001,
        ) ||
        polygonIssue(points)
      ) {
        throw Error(
          'Výber musí celý ležať na zdrojovom obrázku. Zohľadňuje sa aj otočenie a priehľadný rám.',
        );
      }
      points = points.map((p) => ({
        x: Math.max(0, Math.min(size.width, p.x)),
        y: Math.max(0, Math.min(size.height, p.y)),
      }));
    }
    return { placement, points };
  }
  async function run() {
    if (!size || busy) return;
    let geometry: ReturnType<typeof sourceSelection>;
    try {
      geometry = sourceSelection();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Neplatný výber.');
      return;
    }
    const { placement, points } = geometry;
    setBusy(true);
    setPlaying(false);

    setMessage(
      ai
        ? 'AI spracúva obrázok… Môže to trvať niekoľko minút. Požiadavka sa neopakuje.'
        : 'Pripravujem a ukladám PNG assety…',
    );
    try {
      const submitted = await submitEditorJob({
        kind: 'art',
        label: label.trim() || 'Grafická úprava',
        context: {
          sceneId: scene.id,
          targetId: object?.id ?? '',
          label: label.trim() || 'Nový výrez',
          placement: {
            bounds: placement.bounds,
            rotation: placement.rotation,
            imageFit: placement.imageFit,
          },
          fingerprint: artFingerprint(scene, object?.id ?? ''),
        },
        input: {
          source,
          operation,
          selection: points,
          objectMask: ['cutout', 'extract', 'remove', 'edit'].includes(
            operation,
          )
            ? preparedMask
            : undefined,
          prompt: ai ? prompt : undefined,
          confirmed: ai ? true : undefined,
          motion,
          amplitude,
          fps,
          frameCount: count,
        },
      });
      onSubmitted(submitted);
      if (!mounted.current) return;
      setIndex(0);
      setMessage(
        'Úloha je vo fronte. Môžeš meniť lokáciu, uložiť návrh alebo pokračovať v práci.',
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Grafická operácia zlyhala.',
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function apply() {
    if (
      !result ||
      !job ||
      applied.current === job.id ||
      object?.locked ||
      result.data.source !== source ||
      result.fingerprint !== artFingerprint(scene, result.targetId)
    )
      return;
    applied.current = job.id;
    const { data, placement, targetId } = result;
    if (data.operation === 'generate') {
      const id = nextId(
        'scene',
        content.scenes.map((s) => s.id),
      );
      onChange({
        ...content,
        scenes: [
          ...content.scenes,
          {
            id,
            title: result.label || 'Nová lokácia',
            width: scene.width,
            height: scene.height,
            background: data.image,
            hotspots: [],
          },
        ],
      });
      onScene(id);
      onSelect('');
      onDismiss(job!.id);
      return;
    }
    let next = scene;
    if (['edit', 'remove', 'extract'].includes(data.operation)) {
      next = targetId
        ? {
            ...next,
            hotspots: next.hotspots.map((h) =>
              h.id === targetId
                ? { ...h, image: data.image, animation: undefined }
                : h,
            ),
          }
        : { ...next, background: data.image };
    }
    let layerId = '';
    if (['cutout', 'loop', 'extract'].includes(data.operation)) {
      layerId = nextId(
        'layer',
        next.hotspots.map((h) => h.id),
      );
      const layer: Hotspot = {
        id: layerId,
        label: result.label || 'Nový výrez',
        bounds: placement.bounds,
        rotation: placement.rotation,
        imageFit: placement.imageFit,
        image: data.cutout ?? data.image,
        onClick: [],
        decorative: true,
        animation: data.animation
          ? { idle: data.animation.id, idleLoop: true }
          : undefined,
      };
      const position = targetId
        ? next.hotspots.findIndex((h) => h.id === targetId) + 1
        : 0;
      next = {
        ...next,
        hotspots: [
          ...next.hotspots.slice(0, position),
          layer,
          ...next.hotspots.slice(position),
        ],
      };
    }
    onChange({
      ...content,
      scenes: content.scenes.map((s) => (s.id === scene.id ? next : s)),
      animations: data.animation
        ? [...(content.animations ?? []), data.animation]
        : content.animations,
    });

    onDismiss(job!.id);
    onSelection(undefined);
    if (layerId) onSelect(layerId);
    setMessage(
      'Výsledok je v návrhu scény. Uložiť do projektu zapíše aj jeho konfiguráciu. Späť vráti celú operáciu.',
    );
  }
  return (
    <section className="scene-art-panel" aria-label="Grafické nástroje scény">
      <h2>Výber a grafika</h2>
      <p className="field-note">
        Vyber obdĺžnik alebo polygón nástrojmi nad scénou. Výber patrí iba
        jednému zdrojovému obrázku; ostatné vrstvy zostávajú samostatné.
      </p>
      <fieldset disabled={busy || object?.locked}>
        <div className="art-settings">
          <Field label="Zdroj grafickej úpravy">
            <select
              value={target}
              disabled={operation === 'generate'}
              onChange={(e) => {
                setTargetChoice({ jobId: selectedJob, value: e.target.value });
                setMaskError(undefined);
              }}
            >
              <option value="background">Pozadie lokácie</option>
              <option value="object" disabled={!hotspot?.image}>
                Vybraná obrázková vrstva
              </option>
            </select>
          </Field>
          <Field label="Grafická operácia">
            <select
              value={operation}
              onChange={(e) => {
                const op = e.target.value as ArtworkResult['operation'];
                setOperation(op);
                setPrompt(presets[op] ?? '');
              }}
            >
              <option value="cutout">
                Kópia výberu → transparentná vrstva
              </option>
              <option value="loop">Výber → plynulá PNG slučka</option>
              <option value="edit">AI · upraviť výber / celý obrázok</option>
              <option value="remove">AI · odstrániť a opraviť pozadie</option>
              <option value="extract">
                AI · oddeliť objekt + opraviť pozadie
              </option>
              <option value="generate">
                AI · nová lokácia podľa referencie
              </option>
            </select>
          </Field>
          <Field label="Názov výslednej vrstvy alebo lokácie">
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
        </div>
        <p className="field-note">
          Zdroj: {source} {size && `· ${size.width} × ${size.height} px`} ·{' '}
          {selection ? `${selection.length} bodov výberu` : 'celý obrázok'}
        </p>
        {['cutout', 'extract', 'remove', 'edit'].includes(operation) && (
          <div className="mask-launcher">
            <button
              disabled={!size}
              onClick={() => {
                setMaskError(undefined);
                try {
                  setMaskDraft({
                    scope: maskScope,
                    points: sourceSelection().points,
                  });
                } catch (e) {
                  setMaskError({
                    scope: maskScope,
                    text:
                      (e instanceof Error ? e.message : 'Neplatný výber.') +
                      (object
                        ? ` Zdrojom je vrstva „${object.label}“. Pre výber na pozadí zvoľ Zdroj grafickej úpravy → Pozadie lokácie; polygón zostane zachovaný.`
                        : ''),
                  });
                }
              }}
            >
              Spresniť / upraviť masku objektu
            </button>
            {maskError?.scope === maskScope && (
              <p className="mask-launch-error" role="alert">
                {maskError.text}
              </p>
            )}
            {preparedMask && (
              <>
                <span>✓ Maska pripravená · {preparedMask.method}</span>
                <button onClick={() => setObjectMask(undefined)}>
                  Zrušiť masku
                </button>
              </>
            )}
            <p className="field-note">
              Najprv približne označ objekt. Polygón uzavri kliknutím na prvý
              bod alebo tlačidlom Dokončiť polygón. Potom spresni hranice a
              oprav ich štetcom. Maska vyberá pôvodné pixely vrátane čiernych
              obrysov; AI generuje iba pozadie.
            </p>
          </div>
        )}
        {operation === 'loop' && (
          <div className="art-settings">
            <Field label="Pohyb prostredia">
              <select
                value={motion}
                onChange={(e) => setMotion(e.target.value)}
              >
                <option value="water">Voda · vlnivý posun textúry</option>
                <option value="clouds">Mraky · posun sem a späť</option>
                <option value="smoke">Dym · zvlnenie a stúpanie textúry</option>
              </select>
            </Field>
            <Field label="Sila pohybu (px zdroja)">
              <input
                type="number"
                min="1"
                max="32"
                value={amplitude}
                onChange={(e) => setAmplitude(Number(e.target.value))}
              />
            </Field>
            <Field label="Počet snímok slučky">
              <input
                type="number"
                min="4"
                max="24"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </Field>
            <Field label="Rýchlosť slučky (fps)">
              <input
                type="number"
                min="1"
                max="30"
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
              />
            </Field>
            <p className="field-note">
              Lokálny efekt bez AI: jemný periodický pohyb pôvodných pixelov,
              pevné okraje. Nevytvára nové kreslené pózy.
            </p>
          </div>
        )}
        {ai && (
          <>
            <Field label="Pokyny pre AI">
              <textarea
                maxLength={4000}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
              />
            </Field>
            <p className="field-note">
              {status?.configured
                ? `OpenAI · ${status.model} · odosiela sa celý zdroj a maska výberu. Spustenie spotrebuje API kredit.`
                : 'AI vyžaduje OPENAI_API_KEY v .env.local a reštart Vite. Lokálne výrezy a slučky ho nepotrebujú.'}{' '}
              Mimo výberu zostanú pôvodné pixely. Úprava obrázka odpojí jeho
              staré animácie.
            </p>
          </>
        )}
        <div className="row-actions">
          <button
            className="primary-button"
            disabled={
              !size ||
              (needsSelection && !selection && !preparedMask) ||
              (ai && (!status?.configured || !prompt.trim()))
            }
            onClick={() => void run()}
          >
            {ai ? 'Spustiť AI úpravu (API kredit)' : 'Vytvoriť lokálny asset'}
          </button>
          <button disabled={!selection} onClick={() => onSelection(undefined)}>
            Zrušiť výber oblasti
          </button>
        </div>
      </fieldset>
      <p role="status" aria-label="Stav grafickej operácie" aria-live="polite">
        {busy && <span className="art-spinner" aria-hidden="true" />}
        {job?.status === 'succeeded'
          ? 'Assety sú uložené. Skontroluj náhľad a použi výsledok.'
          : (job?.error ??
            (job && ['queued', 'running'].includes(job.status)
              ? job.stage
              : message))}
      </p>
      {maskDraft && (
        <MaskEditor
          source={source}
          selection={maskDraft.points}
          initial={preparedMask}
          available={status?.segmentation}
          onClose={() => setMaskDraft(undefined)}
          onDone={(mask) => {
            setObjectMask({ scope: maskDraft.scope, mask });
            setMaskDraft(undefined);
            setMessage(
              'Maska je pripravená. Spusti vytvorenie výrezu alebo oddelenie s opravou pozadia.',
            );
          }}
        />
      )}
      {result && (
        <div className="art-result">
          <h3>Náhľad výsledku</h3>
          {result.fingerprint !== artFingerprint(scene, result.targetId) && (
            <p role="alert">
              Zdroj alebo jeho umiestnenie sa od zadania úlohy zmenili. Výsledok
              nemôže prepísať novšie úpravy; môžeš ich vrátiť alebo vytvoriť
              novú úlohu.
            </p>
          )}
          {result.data.animation ? (
            <AnimationPreview
              active={active}
              animation={result.data.animation}
              index={index}
              onIndex={setIndex}
              playing={playing}
              onPlaying={setPlaying}
            />
          ) : (
            <div className="art-comparison">
              <figure>
                <img
                  src={assetUrl(result.data.image)}
                  alt="Výsledok grafickej operácie"
                />
                <figcaption>
                  {result.data.cutout ? 'Opravené pozadie' : 'Nový asset'}
                </figcaption>
              </figure>
              {result.data.cutout && (
                <figure>
                  <img
                    src={assetUrl(result.data.cutout)}
                    alt="Oddelený transparentný objekt"
                  />
                  <figcaption>Samostatný objekt</figcaption>
                </figure>
              )}
            </div>
          )}
          <ExtractionComparison result={result.data} />
          <p className="field-note">
            Originál, maska a recept: {result.data.manifest}
          </p>
          <div className="row-actions">
            <button
              className="primary-button"
              disabled={
                result.data.source !== source ||
                object?.locked ||
                result.fingerprint !== artFingerprint(scene, result.targetId)
              }
              onClick={apply}
            >
              Použiť výsledok v scéne
            </button>
            <button
              onClick={() => {
                setPlaying(false);
                onDismiss(job!.id);
              }}
            >
              Zahodiť náhľad
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

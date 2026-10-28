import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameContent, Hotspot, SceneDefinition } from '../game/types';
import { assetUrl } from '../game/assets';
import {
  centre,
  croppedPlacement,
  imagePlacement,
  rotateAround,
} from '../game/transforms';
import type { Point } from '../game/transforms';
import { polygonIssue } from '../game/polygon';
import { useImageSize } from './useImageSize';
import {
  submitEditorJob,
  getArtStatus,
  getArtworkHistory,
  prepareArchivedArtwork,
} from './api';
import type { ArtworkResult } from './api';
import { MaskEditor } from './MaskEditor';
import { ExtractionComparison } from './ExtractionComparison';
import { InpaintInspector } from './InpaintInspector';
import type { ObjectMask } from './masks';
import { AnimationPreview } from './AnimationPreview';
import { Field } from './fields';
import { artFingerprint } from './jobs';
import type { EditorJob } from './jobs';
import { nextId } from './model';
import { CodexPanel } from './CodexPanel';
import {
  defaultImageModel,
  defaultImageQuality,
  imageModels,
  imageQualities,
  type ImageQuality,
} from './artSettings';

const presets: Record<string, string> = {
  asset: '',
  edit: 'Uprav označený detail. Zachovej kreslený styl, perspektivu a světlo původní lokace.',
  extract:
    'Odstraň označený objekt a přirozeně dokresli pozadí za ním ve stejném výtvarném stylu.',
  remove:
    'Odstraň označený objekt a přirozeně dokresli pozadí za ním ve stejném výtvarném stylu.',
  generate:
    'Nová groteskná kreslená lokace pro point-and-click adventuru. Zachovej styl a barevnost reference. Bez postav, titulků a uživatelského rozhraní.',
};
export function SceneArtPanel({
  active,
  jobs,
  selectedJob,
  onSubmitted,
  onDismiss,
  content,
  assets,
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
  assets: readonly string[];
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
  const [maskCutout, setMaskCutout] = useState(false);
  const openedJob = jobs.find(
    (job) =>
      (job.kind === 'art' ||
        (job.kind === 'codex' && job.context.mode === 'scene')) &&
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
  const [assetScale, setAssetScale] = useState<1 | 2>(1);
  const [alignmentChoice, setAlignmentChoice] = useState<
    'frame' | 'features'
  >();
  const [preparationError, setPreparationError] = useState<{
    manifest: string;
    text: string;
  }>();
  const [extractionMethod, setExtractionMethod] = useState<'mask' | 'openai'>(
    'mask',
  );
  const [repairPadding, setRepairPadding] = useState(12);
  const [repairFeather, setRepairFeather] = useState(2);
  const [modelChoice, setModelChoice] = useState<string>();
  const [qualityChoice, setQualityChoice] = useState<ImageQuality>();
  const [label, setLabel] = useState('Nový výřez');
  const [motion, setMotion] = useState('water');
  const [amplitude, setAmplitude] = useState(4),
    [fps, setFps] = useState(8),
    [count, setCount] = useState(16);
  const [status, setStatus] = useState<{
    configured: boolean;
    model: string;
    quality: ImageQuality;
    segmentation?: {
      grabcut: boolean;
      sam2: boolean;
      sam3?: boolean;
      vitmatte?: boolean;
      closedForm?: boolean;
    };
  }>();
  const alignmentMode =
    alignmentChoice ?? (status?.segmentation?.grabcut ? 'features' : 'frame');
  const model = modelChoice ?? status?.model ?? defaultImageModel;
  const quality = qualityChoice ?? status?.quality ?? defaultImageQuality;
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
    target === 'object' && !['generate', 'asset'].includes(operation)
      ? hotspot
      : undefined;
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
  const queuedJob =
    candidates.find((j) => j.id === selectedJob) ?? candidates.at(-1);
  const [archive, setArchive] = useState<{
    source: string;
    results: ArtworkResult[];
  }>();
  const [archivedJob, setArchivedJob] = useState<
    Extract<EditorJob, { kind: 'art' }> & { openedSelection: string }
  >();
  const job =
    archivedJob?.openedSelection === selectedJob &&
    archivedJob.context.sceneId === scene.id &&
    archivedJob.context.targetId === (object?.id ?? '') &&
    archivedJob.result?.source === source
      ? archivedJob
      : queuedJob;
  const dismissResult = () => {
    if (job === archivedJob) {
      setArchivedJob(undefined);
      if (job && jobs.some((item) => item.id === job.id)) onDismiss(job.id);
    } else if (job) onDismiss(job.id);
  };
  const result = job?.result ? { data: job.result, ...job.context } : undefined;
  const [backgroundChoice, setBackgroundChoice] = useState<{
    manifest: string;
    value: 'restored' | 'masked';
  }>();
  const variant =
    backgroundChoice && backgroundChoice.manifest === result?.data.manifest
      ? backgroundChoice.value
      : 'restored';
  const backgroundImage =
    result?.data.backgrounds?.[variant] ?? result?.data.image;
  const resultData = job?.result;
  useEffect(() => {
    if (resultData) onAssets(resultData.assets);
  }, [resultData, onAssets]);
  const size = useImageSize(source);
  const ai = !['cutout', 'loop'].includes(operation);
  const needsSelection = [
    'cutout',
    'loop',
    'extract',
    'remove',
    'asset',
  ].includes(operation);
  useEffect(() => {
    let disposed = false;
    void getArtStatus()
      .then((s) => {
        if (!disposed) setStatus(s);
      })
      .catch(() => {
        if (!disposed)
          setMessage(
            'AI stav se nepodařilo načíst; lokální nástroje fungují dále.',
          );
      });
    return () => {
      disposed = true;
    };
  }, []);
  function sourceSelection(forceSelection = false) {
    if (!size) throw Error('Počkej na načítání zdroje.');
    const placement: Pick<Hotspot, 'bounds' | 'rotation' | 'imageFit'> =
      object ?? {
        bounds: { x: 0, y: 0, width: scene.width, height: scene.height },
        imageFit: 'stretch' as const,
      };
    let points: Point[] | undefined;
    if (selection && (forceSelection || operation !== 'generate')) {
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
          'Výběr musí celý ležet na zdrojovém obrázku. Zohledňuje se i otočení a průhledný rám.',
        );
      }
      points = points.map((p) => ({
        x: Math.max(0, Math.min(size.width, p.x)),
        y: Math.max(0, Math.min(size.height, p.y)),
      }));
    }
    return { placement, points };
  }
  async function run(debugOnly = false) {
    if (!size || busy) return;
    if (maskCutout && !preparedMask) {
      setMessage(
        'Nejprve připrav masku objektu a potvrď ji tlačítkem Použít masku.',
      );
      return;
    }
    let geometry: ReturnType<typeof sourceSelection>;
    try {
      geometry = sourceSelection();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Neplatný výběr.');
      return;
    }
    const { placement, points } = geometry;
    setBusy(true);
    setPlaying(false);

    setMessage(
      debugOnly
        ? 'Připravuji diagnostiku masky a kontextu bez API…'
        : ai
          ? 'AI zpracovává obrázek… Může to trvat několik minut. Požadavek se neopakuje.'
          : 'Připravuji a ukládám PNG assety…',
    );
    try {
      const submitted = await submitEditorJob({
        kind: 'art',
        label: debugOnly
          ? `Diagnostika · ${label.trim() || 'výběr'}`
          : label.trim() || 'Grafická úprava',
        context: {
          sceneId: scene.id,
          targetId: object?.id ?? '',
          label: label.trim() || 'Nový výřez',
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
            ? preparedMask && { ...preparedMask, foreground: undefined }
            : undefined,
          prompt: ai ? prompt : undefined,
          model: ai ? model : undefined,
          quality: ai ? quality : undefined,
          confirmed: ai ? true : undefined,
          assetScale:
            operation === 'asset' ||
            (operation === 'extract' && extractionMethod === 'openai')
              ? assetScale
              : undefined,
          extractionMethod:
            operation === 'extract' ? extractionMethod : undefined,
          repairPadding,
          repairFeather,
          debugOnly,
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
        'Úloha je ve frontě. Můžeš měnit lokaci, uložit návrh nebo pokračovat v práci.',
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Grafická operace selhala.',
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const prepareExisting = useCallback(
    async (scale: 1 | 2 = assetScale) => {
      if (!job?.result || busy) return;
      const captured = job;
      setPreparationError(undefined);
      setBusy(true);
      setMessage('Připravuji uložený PNG bez API…');
      try {
        const response = await prepareArchivedArtwork(
          captured.result!.manifest,
          captured.result!.source,
          scale,
          alignmentMode,
        );
        if (!mounted.current) return;
        onAssets(response.assets);
        setArchive((current) =>
          current?.source === response.result.source
            ? { ...current, results: [response.result, ...current.results] }
            : current,
        );
        setArchivedJob({
          ...captured,
          result: { ...response.result, assets: response.assets },
          openedSelection: selectedJob,
        });
        setMessage(
          'Výřez je připravený bez nového API volání. Zkontroluj náhled a použij jej ve scéně.',
        );
      } catch (error) {
        if (mounted.current)
          setPreparationError({
            manifest: captured.result!.manifest,
            text:
              error instanceof Error
                ? error.message
                : 'Příprava výřezu selhala.',
          });
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [job, busy, assetScale, onAssets, selectedJob, alignmentMode],
  );
  const automaticPreparations = useRef(new Set<string>());
  useEffect(() => {
    const data = job?.result;
    const diagnostic = data?.assetDiagnostic;
    if (
      busy ||
      !job ||
      !data ||
      data.extractionMethod !== 'openai' ||
      data.operation !== 'extract' ||
      !(
        (data.blockedReason &&
          diagnostic &&
          diagnostic.borderPixels > 0 &&
          diagnostic.maxBorderAlpha <= 1 &&
          diagnostic.partialPixels + diagnostic.opaquePixels > 0) ||
        (!data.blockedReason && alignmentMode === 'features' && !data.alignment)
      ) ||
      data.source !== source ||
      object?.locked ||
      job.context.fingerprint !== artFingerprint(scene, job.context.targetId) ||
      automaticPreparations.current.has(data.manifest)
    )
      return;
    // One local attempt per archived output; never generate or retry paid work.
    const timer = window.setTimeout(() => {
      automaticPreparations.current.add(data.manifest);
      void prepareExisting(data.assetScale ?? 1);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    busy,
    job,
    source,
    scene,
    object?.locked,
    prepareExisting,
    alignmentMode,
  ]);
  const applyBlockedReason = !result
    ? 'Nejdříve otevři výsledek.'
    : busy
      ? 'Probíhá příprava výřezu. Počkej na dokončení.'
      : result.data.source !== source
        ? 'Výsledek patří jinému zdrojovému obrázku. Zvol původní zdroj grafické úpravy.'
        : result.data.debugOnly
          ? 'Diagnostika bez API není výsledek pro vložení do scény.'
          : result.data.blockedReason
            ? `Výřez ještě není připravený: ${result.data.blockedReason}`
            : object?.locked
              ? 'Cílová vrstva je zamčená. Odemkni ji v seznamu vrstev.'
              : result.fingerprint !== artFingerprint(scene, result.targetId)
                ? 'Zdroj nebo umístění cíle se od zadání změnily. Otevři výsledek z historie pro aktuální zdroj nebo vrať změnu cíle.'
                : undefined;
  function apply() {
    if (!result || !job || applyBlockedReason || applied.current === job.id)
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
            title: result.label || 'Nová lokace',
            width: scene.width,
            height: scene.height,
            background: data.image,
            hotspots: [],
          },
        ],
      });
      onScene(id);
      onSelect('');
      dismissResult();
      return;
    }
    let next = scene;
    if (['edit', 'remove', 'extract'].includes(data.operation)) {
      next = targetId
        ? {
            ...next,
            hotspots: next.hotspots.map((h) =>
              h.id === targetId
                ? { ...h, image: backgroundImage!, animation: undefined }
                : h,
            ),
          }
        : { ...next, background: backgroundImage! };
    }
    let layerId = '';
    if (['cutout', 'loop', 'extract', 'asset'].includes(data.operation)) {
      layerId = nextId(
        'layer',
        next.hotspots.map((h) => h.id),
      );
      const layer: Hotspot = {
        id: layerId,
        label: result.label || 'Nový výřez',
        ...(data.cutoutFrame
          ? croppedPlacement(placement, data.cutoutFrame)
          : placement),
        image: data.cutout ?? data.image,
        onClick: [],
        decorative: data.operation !== 'asset',
        animation: data.animation
          ? { idle: data.animation.id, idleLoop: true }
          : undefined,
      };
      const position =
        data.operation === 'asset'
          ? next.hotspots.length
          : targetId
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

    dismissResult();
    onSelection(undefined);
    if (layerId) onSelect(layerId);
    setMessage(
      'Výsledek je v návrhu scény. Uložit do projektu zapíše i jeho konfiguraci. Zpět vrátí celou operaci.',
    );
  }
  return (
    <section className="scene-art-panel" aria-label="Grafické nástroje scény">
      <h2>Výběr a grafika</h2>
      <p className="field-note">
        Vyber obdélník nebo polygon nástroji nad scénou. Výběr patří pouze
        jednomu zdrojovému obrázku; ostatní vrstvy zůstávají samostatné.
      </p>
      <fieldset disabled={busy || object?.locked}>
        <div className="art-settings">
          <Field label="Zdroj grafické úpravy">
            <select
              value={target}
              disabled={['generate', 'asset'].includes(operation)}
              onChange={(e) => {
                setTargetChoice({ jobId: selectedJob, value: e.target.value });
                setMaskError(undefined);
              }}
            >
              <option value="background">Pozadí lokace</option>
              <option value="object" disabled={!hotspot?.image}>
                Vybraná obrázková vrstva
              </option>
            </select>
          </Field>
          <Field label="Grafická operace">
            <select
              value={maskCutout ? 'mask-cutout' : operation}
              onChange={(e) => {
                const maskOnly = e.target.value === 'mask-cutout';
                const op = maskOnly
                  ? 'cutout'
                  : (e.target.value as ArtworkResult['operation']);
                setMaskCutout(maskOnly);
                setOperation(op);
                if (op === 'asset') {
                  setTargetChoice({ jobId: selectedJob, value: 'background' });
                  if (label === 'Nový výřez') setLabel('Nový asset');
                }
                setPrompt(presets[op] ?? '');
              }}
            >
              <option value="mask-cutout">
                Vyříznout objekt maskou → nová vrstva (SAM / ruční)
              </option>
              <option value="cutout">
                Kopie výběru → transparentní vrstva
              </option>
              <option value="loop">Výběr → plynulá PNG smyčka</option>
              <option value="edit">AI · upravit výběr / celý obrázek</option>
              <option value="asset">AI · vytvořit asset</option>
              <option value="remove">AI · odstranit a opravit pozadí</option>
              <option value="extract">
                AI · oddělit objekt + opravit pozadí
              </option>
              <option value="generate">AI · nová lokace podle reference</option>
            </select>
          </Field>
          <Field label="Název výsledné vrstvy nebo lokace">
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
        </div>
        <p className="field-note">
          Zdroj: {source} {size && `· ${size.width} × ${size.height} px`} ·{' '}
          {selection ? `${selection.length} bodů výběru` : 'celý obrázek'}
        </p>
        {maskCutout && (
          <p className="field-note">
            Připrav masku přes Zpřesnit / upravit masku objektu: použij SAM3,
            SAM2, ruční štětec nebo jemné hrany a potvrď Použít masku. Výřez se
            vytvoří lokálně z původních pixelů jako transparentní PNG a po
            kontrole jej vložíš do nové vrstvy přesně na původní místo. Původní
            obrázek se nemění. Pozadí se nedokresluje a OpenAI API ani jeho klíč
            nejsou potřeba.
          </p>
        )}
        {(operation === 'asset' ||
          (operation === 'extract' && extractionMethod === 'openai')) && (
          <Field label="Rozlišení uloženého assetu">
            <select
              value={assetScale}
              onChange={(e) => setAssetScale(Number(e.target.value) as 1 | 2)}
            >
              <option value={1}>1× · původní velikost</option>
              <option value={2}>2× · dvojnásobné rozlišení</option>
            </select>
            <span className="field-note">
              Mění počet pixelů PNG, nikoli velikost nebo polohu objektu ve
              scéně. API může vrátit větší pracovní obrázek.
            </span>
          </Field>
        )}
        {operation === 'asset' && (
          <p className="field-note">
            Označ místo pro nový objekt. Výběr určuje jeho umístění a maximální
            velikost, nikoli obrys. Základna objektu se zarovná na dolní hranu
            výběru. AI dostane pozadí a vyznačené místo jako reference a vytvoří
            transparentní PNG. Původní pozadí se nemění. Výsledek nejprve
            zkontroluj v náhledu a potom ho vlož jako novou interaktivní vrstvu.
          </p>
        )}
        {operation === 'extract' && (
          <>
            <Field label="Způsob výřezu objektu">
              <select
                value={extractionMethod}
                onChange={(e) =>
                  setExtractionMethod(e.target.value as 'mask' | 'openai')
                }
              >
                <option value="mask">
                  Původní pixely podle masky (SAM / ruční)
                </option>
                <option value="openai">OpenAI · transparentní výřez</option>
              </select>
            </Field>
            {extractionMethod === 'openai' && (
              <p className="field-note">
                OpenAI odstraní pozadí objektu a může jemně překreslit jeho
                kresbu. Připravená SAM maska nebo ruční výběr určuje původní rám
                a polohu; výsledek se do něj vejde bez deformace, s dolním
                středem na původním místě. Nepotřebuješ spouštět SAM. Oprava
                pozadí zůstává stejná. Spuštění provede dva placené API
                požadavky: opravu pozadí a výřez objektu. Zarovnání a obrys
                zkontroluj v náhledu před použitím.
              </p>
            )}
          </>
        )}
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
                      (e instanceof Error ? e.message : 'Neplatný výběr.') +
                      (object
                        ? ` Zdrojem je vrstva „${object.label}“. Pro výběr na pozadí zvol Zdroj grafické úpravy → Pozadí lokace; polygon zůstane zachovaný.`
                        : ''),
                  });
                }
              }}
            >
              Zpřesnit / upravit masku objektu
            </button>
            {maskError?.scope === maskScope && (
              <p className="mask-launch-error" role="alert">
                {maskError.text}
              </p>
            )}
            {preparedMask && (
              <>
                <span>✓ Maska připravená · {preparedMask.method}</span>
                <button onClick={() => setObjectMask(undefined)}>
                  Zrušit masku
                </button>
              </>
            )}
            <p className="field-note">
              Nejprve přibližně označ objekt. Polygon uzavři kliknutím na první
              bod nebo tlačítkem Dokončit polygon. Potom zpřesni hranice a oprav
              je štětcem. Maska vybírá původní pixely včetně černých obrysů.
              {ai
                ? ' AI generuje pouze pozadí.'
                : ' Lokální výřez zachová původní obrázek; vznikne samostatná transparentní vrstva.'}
            </p>
          </div>
        )}
        {operation === 'loop' && (
          <div className="art-settings">
            <Field label="Pohyb prostředí">
              <select
                value={motion}
                onChange={(e) => setMotion(e.target.value)}
              >
                <option value="water">Voda · vlnivý posun textury</option>
                <option value="clouds">Mraky · posun sem a zpět</option>
                <option value="smoke">Kouř · vlnění a stoupání textury</option>
              </select>
            </Field>
            <Field label="Síla pohybu (px zdroje)">
              <input
                type="number"
                min="1"
                max="32"
                value={amplitude}
                onChange={(e) => setAmplitude(Number(e.target.value))}
              />
            </Field>
            <Field label="Počet snímků smyčky">
              <input
                type="number"
                min="4"
                max="24"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </Field>
            <Field label="Rychlost smyčky (fps)">
              <input
                type="number"
                min="1"
                max="30"
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
              />
            </Field>
            <p className="field-note">
              Lokální efekt bez AI: jemný periodický pohyb původních pixelů,
              pevné okraje. Nevytváří nové kreslené pózy.
            </p>
          </div>
        )}
        {ai && (
          <>
            <div className="art-settings">
              <Field label="AI model obrázků">
                <select
                  value={model}
                  onChange={(e) => {
                    const next = e.target.value;
                    setModelChoice(next);
                    if (!imageQualities(next).includes(quality))
                      setQualityChoice(defaultImageQuality);
                  }}
                >
                  {imageModels(status?.model ?? defaultImageModel).map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Kvalita AI obrázku">
                <select
                  value={quality}
                  onChange={(e) =>
                    setQualityChoice(e.target.value as ImageQuality)
                  }
                >
                  {imageQualities(model).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {['extract', 'remove'].includes(operation) && (
              <>
                <Field label="Dočištění pozadí za obrysem (px zdroje)">
                  <input
                    type="number"
                    aria-label="Dočištění pozadí za obrysem (px zdroje)"
                    min={0}
                    max={64}
                    value={repairPadding}
                    onChange={(e) =>
                      setRepairPadding(
                        Math.max(
                          0,
                          Math.min(64, Math.round(Number(e.target.value) || 0)),
                        ),
                      )
                    }
                  />
                  <span className="field-note">
                    Odstraní i zbytky čar a stínu okolo objektu. Mění pozadí v
                    tomto přesahu; ořez objektu se počítá samostatně.
                  </span>
                </Field>
                <Field label="Přechod švu (px zdroje)">
                  <input
                    type="number"
                    aria-label="Přechod švu (px zdroje)"
                    min={0}
                    max={32}
                    value={repairFeather}
                    onChange={(e) =>
                      setRepairFeather(
                        Math.max(
                          0,
                          Math.min(32, Math.round(Number(e.target.value) || 0)),
                        ),
                      )
                    }
                  />
                  <span className="field-note">
                    Přechod k původnímu pozadí pouze v opravném přesahu. Účinná
                    šířka: {Math.min(repairPadding, repairFeather)} px. Nula =
                    tvrdý šev; objekt se nezměkčuje.
                  </span>
                </Field>
                <button
                  disabled={!size || (!selection && !preparedMask)}
                  onClick={() => void run(true)}
                >
                  Zkontrolovat přípravu (bez API)
                </button>
              </>
            )}
            <Field label="Pokyny pro AI">
              <textarea
                maxLength={4000}
                placeholder={
                  operation === 'asset'
                    ? 'Např. Přidej sem láhev od piva.'
                    : undefined
                }
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
              />
            </Field>
            <p className="field-note">
              {status?.configured
                ? `OpenAI · ${model} · ${quality} · ${operation === 'asset' ? 'referenční pozadí a vodítko umístění; výstup s průhledností' : 'odesílá se celý zdroj a maska výběru'}. Spuštění spotřebuje API kredit.`
                : 'AI vyžaduje OPENAI_API_KEY v .env.local a restart Vite. Lokální výřezy a smyčky ho nepotřebují.'}{' '}
              {operation === 'asset' ? (
                'Vznikne samostatný asset bez přepsání pozadí. Chování při kliknutí a případné sebrání do inventáře nastavíš v editoru nové vrstvy.'
              ) : (
                <>
                  V maskované variantě mimo výběr
                  {['extract', 'remove'].includes(operation)
                    ? ' a opravného přesahu'
                    : ''}{' '}
                  zůstanou původní pixely. Celé obnovené pozadí lze zvolit po
                  generování. Úprava obrázku odpojí jeho staré animace.
                </>
              )}
            </p>
          </>
        )}
        <div className="row-actions">
          <button
            className="primary-button"
            disabled={
              !size ||
              (maskCutout && !preparedMask) ||
              (needsSelection &&
                !selection &&
                (operation === 'asset' || !preparedMask)) ||
              (ai && (!status?.configured || !prompt.trim()))
            }
            onClick={() => void run()}
          >
            {maskCutout
              ? 'Vyříznout maskou do nové vrstvy'
              : ai
                ? 'Spustit AI úpravu (API kredit)'
                : 'Vytvořit lokální asset'}
          </button>
          <button disabled={!selection} onClick={() => onSelection(undefined)}>
            Zrušit výběr oblasti
          </button>
        </div>
      </fieldset>
      <CodexPanel
        locked={object?.locked}
        active={active}
        context={{
          mode: 'scene',
          sceneId: scene.id,
          targetId: object?.id ?? '',
          source,
          label: label || 'Animovaná oblast',
          fingerprint: artFingerprint(scene, object?.id ?? ''),
          placement: object
            ? {
                bounds: object.bounds,
                rotation: object.rotation,
                imageFit: object.imageFit,
              }
            : {
                bounds: {
                  x: 0,
                  y: 0,
                  width: scene.width,
                  height: scene.height,
                },
                imageFit: 'stretch',
              },
        }}
        selection={() => sourceSelection(true).points}
        content={content}
        assets={assets}
        jobs={jobs}
        selectedJob={selectedJob}
        onSubmitted={onSubmitted}
        onDismiss={onDismiss}
        onAssets={onAssets}
        onChange={onChange}
      />
      <div className="art-history">
        <button
          disabled={busy || !size}
          onClick={async () => {
            try {
              const history = await getArtworkHistory(source);
              if (!mounted.current) return;
              onAssets(history.assets);
              setArchive({ source, results: history.results });
              setMessage(
                history.results.length
                  ? 'Vyber uložený výsledek. Znovu se nic negeneruje.'
                  : 'Pro tento nezměněný zdroj není uložený použitelný výsledek.',
              );
            } catch (error) {
              if (mounted.current)
                setMessage(
                  error instanceof Error
                    ? error.message
                    : 'Archiv se nepodařilo načíst.',
                );
            }
          }}
        >
          Načíst dřívější výsledky (bez API)
        </button>
        {archive?.source === source && archive.results.length > 0 && (
          <Field label="Uložený výsledek">
            <select
              value={job === archivedJob ? (job?.result?.manifest ?? '') : ''}
              onChange={(e) => {
                const data = archive.results.find(
                  (r) => r.manifest === e.target.value,
                );
                if (!data) return;
                setArchivedJob({
                  id: `archive-${crypto.randomUUID()}`,
                  openedSelection: selectedJob,
                  kind: 'art',
                  label: 'Uložený výřez',
                  createdAt: '',
                  status: 'succeeded',
                  stage: 'Načteno z archivu',
                  result: data,
                  context: {
                    sceneId: scene.id,
                    targetId: object?.id ?? '',
                    label: label || 'Výřez z archivu',
                    fingerprint: artFingerprint(scene, object?.id ?? ''),
                    placement: object
                      ? {
                          bounds: object.bounds,
                          rotation: object.rotation,
                          imageFit: object.imageFit,
                        }
                      : {
                          bounds: {
                            x: 0,
                            y: 0,
                            width: scene.width,
                            height: scene.height,
                          },
                          imageFit: 'stretch',
                        },
                  },
                });
              }}
            >
              <option value="">Vyber výsledek…</option>
              {archive.results.map((r) => (
                <option key={r.manifest} value={r.manifest}>
                  {r.operation === 'extract' ? 'Oddělení' : 'Odstranění'} ·{' '}
                  {r.manifest.split('/')[1]} ·{' '}
                  {r.blockedReason ? 'vyžaduje přípravu' : 'připravené'} ·{' '}
                  {r.assetScale ?? 1}×
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <p role="status" aria-label="Stav grafické operace" aria-live="polite">
        {busy && <span className="art-spinner" aria-hidden="true" />}
        {job?.status === 'succeeded'
          ? 'Assety jsou uložené. Zkontroluj náhled a použij výsledek.'
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
              'Maska je připravená. Spusť vytvoření výřezu nebo oddělení s opravou pozadí.',
            );
          }}
        />
      )}
      {result && (
        <div className="art-result">
          <h3>
            {result.data.debugOnly ? 'Kontrola přípravy' : 'Náhled výsledku'}
          </h3>
          {result.data.debugOnly && (
            <p>Diagnostika přípravy · bez volání AI a bez změn scény.</p>
          )}
          {result.data.blockedReason && (
            <p role="alert">{result.data.blockedReason}</p>
          )}
          {result.data.extractionMethod === 'openai' &&
            result.data.operation === 'extract' &&
            !result.data.debugOnly && (
              <div className="row-actions">
                <Field label="Zarovnání připraveného výřezu">
                  <select
                    value={alignmentMode}
                    disabled={busy}
                    onChange={(e) =>
                      setAlignmentChoice(e.target.value as 'frame' | 'features')
                    }
                  >
                    <option value="features">
                      Podle detailů původního objektu
                    </option>
                    <option value="frame">Podle rámu výběru · přibližně</option>
                  </select>
                </Field>
                <Field label="Rozlišení připraveného výřezu">
                  <select
                    value={assetScale}
                    disabled={busy}
                    onChange={(e) =>
                      setAssetScale(Number(e.target.value) as 1 | 2)
                    }
                  >
                    <option value={1}>1× · původní velikost</option>
                    <option value={2}>2× · dvojnásobné rozlišení</option>
                  </select>
                </Field>
                <button
                  disabled={
                    busy ||
                    result.fingerprint !==
                      artFingerprint(scene, result.targetId)
                  }
                  onClick={() => void prepareExisting()}
                >
                  {alignmentMode === 'features'
                    ? 'Zarovnat podle původního obrázku (bez API)'
                    : 'Připravit uložený výřez (bez API)'}
                </button>
                {preparationError?.manifest === result.data.manifest && (
                  <p role="alert">{preparationError.text}</p>
                )}
                <p className="field-note">
                  Odstraní pouze zanedbatelnou alfu 1/255 a vytvoří nový soubor
                  z již zaplaceného PNG. Původní archiv zůstává zachovaný.
                  Skutečně useknutý nebo neprůhledný výstup se nepovolí.
                  Zarovnání podle detailů počítá posun, měřítko a malé natočení
                  pomocí OpenCV, lokálně nebo přes SSH; nepotřebuje nové OpenAI
                  volání. Při nedostatku shod ponechá dosavadní výsledek.
                </p>
              </div>
            )}
          {result.data.assetDiagnostic && (
            <section aria-label="Diagnostika odmítnutého assetu">
              <h4>Surový výstup OpenAI · nepoužitý ve scéně</h4>
              <p>
                {result.data.assetDiagnostic.width} ×{' '}
                {result.data.assetDiagnostic.height} px ·{' '}
                {result.data.assetDiagnostic.hasAlpha
                  ? 'PNG obsahuje alfa kanál'
                  : 'PNG nemá alfa kanál'}
                . Průhledné pixely:{' '}
                {result.data.assetDiagnostic.transparentPixels}; částečné:{' '}
                {result.data.assetDiagnostic.partialPixels}; neprůhledné:{' '}
                {result.data.assetDiagnostic.opaquePixels}. Neprůhlednost na
                okraji: {result.data.assetDiagnostic.borderPixels} pixelů,{' '}
                nejvyšší alfa {result.data.assetDiagnostic.maxBorderAlpha}/255.
              </p>
              <p className="field-note">
                Starší kontrola odmítala i jediný okrajový pixel s alfou 1/255.
                Slabá alfa může být zbytek pozadí; samotná hláška nedokazuje
                useknutý objekt. Pro slabou alfu použij přípravu uloženého
                výřezu bez API; nic se znovu negeneruje.
              </p>
              <div className="art-comparison">
                <figure className="checkerboard">
                  <img
                    src={assetUrl(result.data.assetDiagnostic.image)}
                    alt="Odmítnutý surový výstup OpenAI"
                  />
                </figure>
              </div>
              <p>
                <a
                  href={assetUrl(result.data.assetDiagnostic.image)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Otevřít původní PNG z API
                </a>
              </p>
              <p>
                <code>src/assets/{result.data.assetDiagnostic.image}</code>
              </p>
              <p>
                <a
                  href={assetUrl(
                    result.data.assetDiagnostic.image.replace(
                      /[^/]+$/,
                      result.data.extractionMethod === 'openai'
                        ? 'extraction-input.png'
                        : 'provider-input.png',
                    ),
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  Vstup pro OpenAI
                </a>
                {' · '}
                <a
                  href={assetUrl(
                    result.data.assetDiagnostic.image.replace(
                      /[^/]+$/,
                      result.data.extractionMethod === 'openai'
                        ? 'extraction-guide.png'
                        : 'placement-guide.png',
                    ),
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  Označené vodítko
                </a>
              </p>
            </section>
          )}
          {result.data.model && (
            <p className="field-note">
              OpenAI · {result.data.model} ·{' '}
              {result.data.quality ?? 'původní nastavení kvality'}
            </p>
          )}
          {result.fingerprint !== artFingerprint(scene, result.targetId) && (
            <p role="alert">
              Zdroj nebo jeho umístění se od zadání úlohy změnily. Výsledek
              nemůže přepsat novější úpravy; můžeš jejich vrátit nebo vytvořit
              novou úlohu.
            </p>
          )}
          {result.data.backgrounds && (
            <>
              <Field label="Pozadí pro scénu">
                <select
                  value={variant}
                  onChange={(e) =>
                    setBackgroundChoice({
                      manifest: result.data.manifest,
                      value: e.target.value as 'restored' | 'masked',
                    })
                  }
                >
                  <option value="restored">
                    Celý obnovený výsledek · provider-restored.png
                  </option>
                  <option value="masked">
                    Kompozice přes masku · image.png
                  </option>
                </select>
              </Field>
              <p className="field-note">
                {variant === 'restored'
                  ? 'Použije celý výsledek AI zarovnaný do původní scény. Může změnit i okolí mimo masku; nevrací původní stíny. Surový provider-returned.png obsahuje okraje modelového plátna a přímo do scény nepatří.'
                  : 'Zachová původní pixely mimo opravnou masku. Příliš těsná maska může vrátit stíny nebo obrysy odstraněného objektu.'}
              </p>
            </>
          )}
          {result.data.debugOnly || result.data.blockedReason ? null : result
              .data.animation ? (
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
              {result.data.preview && (
                <figure>
                  <img
                    src={assetUrl(result.data.preview)}
                    alt={
                      result.data.extractionMethod === 'openai'
                        ? 'Umístění objektu na původním pozadí'
                        : 'Nový asset na původním pozadí'
                    }
                  />
                  <figcaption>
                    {result.data.extractionMethod === 'openai'
                      ? 'Náhled umístění na původním pozadí'
                      : 'Náhled umístění · pozadí zůstává původní'}
                  </figcaption>
                </figure>
              )}
              <figure>
                <img
                  src={assetUrl(backgroundImage!)}
                  alt="Výsledek grafické operace"
                />
                <figcaption>
                  {['remove', 'extract'].includes(result.data.operation)
                    ? 'Opravené pozadí'
                    : 'Nový asset'}
                </figcaption>
              </figure>
              {result.data.cutout && (
                <figure>
                  <img
                    src={assetUrl(result.data.cutout)}
                    alt="Oddělený transparentní objekt"
                  />
                  <figcaption>Samostatný objekt</figcaption>
                </figure>
              )}
            </div>
          )}
          {result.data.extractionMethod === 'openai' && (
            <p className="field-note">
              {result.data.alignment
                ? `Zarovnáno podle detailů: ${result.data.alignment.inliers} ověřených shod, medián odchylky ${result.data.alignment.medianError.toFixed(2)} px v původním obrázku. Metrika shod nezaručuje stejný obrys nebo proporce překreslené postavy.`
                : 'Dosavadní umístění podle rámu je přibližné. Pro přesnější měřítko a polohu zvol zarovnání podle detailů.'}
              {result.data.alignmentMatches && (
                <>
                  {' '}
                  <a
                    href={assetUrl(result.data.alignmentMatches)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Zobrazit spárované detaily
                  </a>
                </>
              )}
            </p>
          )}
          {result.data.cutoutFrame && (
            <p className="field-note">
              Výřez: {result.data.cutoutFrame.width} ×{' '}
              {result.data.cutoutFrame.height} px · původní offset{' '}
              {result.data.cutoutFrame.x}, {result.data.cutoutFrame.y} px.
              Umístění ve scéně se přepočítá automaticky. Rozlišení PNG:{' '}
              {result.data.assetScale ?? 1}×.
            </p>
          )}
          <ExtractionComparison result={result.data} />
          {result.data.debug && (
            <InpaintInspector
              key={result.data.manifest}
              debug={result.data.debug}
            />
          )}
          <p className="field-note">
            Originál, maska a recept: {result.data.manifest}
          </p>
          {applyBlockedReason && (
            <p
              id="art-apply-blocked"
              role="status"
              aria-label="Důvod blokace použití"
            >
              {applyBlockedReason}
            </p>
          )}
          <div className="row-actions">
            <button
              className="primary-button"
              disabled={Boolean(applyBlockedReason)}
              title={applyBlockedReason}
              aria-describedby={
                applyBlockedReason ? 'art-apply-blocked' : undefined
              }
              onClick={apply}
            >
              Použít výsledek ve scéně
            </button>
            <button
              onClick={() => {
                setPlaying(false);
                dismissResult();
              }}
            >
              Zahodit náhled
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

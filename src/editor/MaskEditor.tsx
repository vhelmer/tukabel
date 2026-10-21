import { useCallback, useEffect, useRef, useState } from 'react';
import type { Point } from '../game/transforms';
import { getMaskSource, segmentMask, matteMask } from './api';
import type {
  MaskSource,
  ObjectMask,
  MattingResult,
  MattingSettings,
} from './masks';
import { maskBase64, paintMask, pngPixels } from './maskCanvas';
import { Field } from './fields';

type Snapshot = {
  pixels: Uint8Array;
  seeds: Uint8Array;
  method: ObjectMask['method'];
  refineEdges?: boolean;
  detailPass?: boolean;
  matting?: MattingSettings;
  foreground?: string;
  foregroundImage?: ImageData;
};
export function MaskEditor({
  source,
  selection,
  initial,
  available,
  onDone,
  onClose,
}: {
  source: string;
  selection?: readonly Point[];
  initial?: MattingResult;
  available?: {
    grabcut: boolean;
    sam2: boolean;
    sam3?: boolean;
    vitmatte?: boolean;
    closedForm?: boolean;
  };
  onDone: (mask: MattingResult) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    viewport = useRef<HTMLDivElement>(null);
  const working = useRef<
    | {
        source: MaskSource;
        image: ImageData;
        pixels: Uint8Array;
        seeds: Uint8Array;
        method: ObjectMask['method'];
        refineEdges?: boolean;
        detailPass?: boolean;
        matting?: MattingSettings;
        foreground?: string;
        foregroundImage?: ImageData;
      }
    | undefined
  >(undefined);
  const history = useRef<Snapshot[]>([]),
    stroke = useRef<
      | {
          before: Snapshot;
          pointerId: number;
          x: number;
          y: number;
        }
      | undefined
    >(undefined);
  const alive = useRef(false);
  const [focus, setFocus] = useState<Point>();
  const [size, setSize] = useState<MaskSource>();
  const [undoCount, setUndoCount] = useState(0);
  const [revision, setRevision] = useState(0),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('Načítám původní pixely…');
  const [tool, setTool] = useState<'add' | 'erase' | 'unknown' | 'inspect'>(
      'add',
    ),
    [view, setView] = useState('mask'),
    [radius, setRadius] = useState(8),
    [zoom, setZoom] = useState(1),
    [frameWidth, setFrameWidth] = useState(900);
  const [method, setMethod] = useState<'grabcut' | 'sam2' | 'sam3'>(
    available?.sam3 ? 'sam3' : available?.sam2 ? 'sam2' : 'grabcut',
  );
  const [refineEdges, setRefineEdges] = useState(initial?.refineEdges ?? true);
  const [detailPass, setDetailPass] = useState(initial?.detailPass ?? false);
  const [mattingMethod, setMattingMethod] = useState<
    'vitmatte' | 'closed-form'
  >(
    initial?.matting?.method === 'closed-form' ||
      initial?.matting?.method === 'vitmatte'
      ? initial.matting.method
      : available?.vitmatte
        ? 'vitmatte'
        : 'closed-form',
  );
  const [edgeRadius, setEdgeRadius] = useState(initial?.matting?.radius || 4);
  const [decontaminate, setDecontaminate] = useState(
    initial?.matting?.decontaminate ?? true,
  );
  const [previewBackground, setPreviewBackground] = useState('checker');
  const [foregroundDirty, setForegroundDirty] = useState(false);
  const redraw = useCallback(() => {
    const d = working.current;
    setForegroundDirty(!!d?.matting?.decontaminate && !d.foreground);
    setRevision((v) => v + 1);
  }, []);
  async function decodeForeground(data?: string) {
    if (!data) return undefined;
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const el = document.createElement('canvas');
    el.width = img.naturalWidth;
    el.height = img.naturalHeight;
    const ctx = el.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, el.width, el.height);
  }
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    alive.current = true;
    return () => {
      alive.current = false;
      el.close();
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const original = await getMaskSource(source);
        const image = new Image();
        image.src = `data:image/png;base64,${original.data}`;
        await image.decode();
        const layer = window.document.createElement('canvas');
        layer.width = original.width;
        layer.height = original.height;
        const ctx = layer.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(image, 0, 0);
        const imageData = ctx.getImageData(
          0,
          0,
          original.width,
          original.height,
        );
        const restored =
          initial?.sourceSha256 === original.sourceSha256 ? initial : undefined;
        let pixels: Uint8Array;
        if (restored)
          pixels = await pngPixels(
            restored.data,
            original.width,
            original.height,
          );
        else {
          ctx.clearRect(0, 0, original.width, original.height);
          if (selection?.length) {
            ctx.beginPath();
            selection.forEach((p, i) =>
              i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
            );
            ctx.closePath();
            ctx.fillStyle = '#fff';
            ctx.fill();
          }
          const selected = ctx.getImageData(
            0,
            0,
            original.width,
            original.height,
          ).data;
          pixels = new Uint8Array(original.width * original.height);
          for (let p = 0; p < pixels.length; p++)
            pixels[p] = selected[p * 4 + 3]! >= 128 ? 255 : 0;
        }
        if (disposed) return;
        const draft: NonNullable<typeof working.current> = {
          source: original,
          image: imageData,
          pixels,
          seeds: new Uint8Array(pixels.length),
          method: restored?.method ?? 'manual',
          refineEdges: restored?.refineEdges,
          detailPass: restored?.detailPass,
          matting: restored?.matting,
          foreground: restored?.foreground,
        };
        draft.foregroundImage = await decodeForeground(restored?.foreground);
        if (disposed) return;
        working.current = draft;
        setSize(original);
        setReady(true);
        redraw();
        setMessage(
          'Zeleným štětcem označ objekt, červeným pozadí. Zpřesnění hledá hranice v původním obrázku; barvy nemění.',
        );
      } catch (e) {
        if (!disposed)
          setMessage(e instanceof Error ? e.message : 'Načítání selhalo.');
      }
    })();
    return () => {
      disposed = true;
    };
  }, [source, selection, initial, redraw]);
  useEffect(() => {
    const el = viewport.current!;
    const observer = new ResizeObserver(() => setFrameWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const d = working.current,
      el = canvas.current;
    if (!d || !el) return;
    const ctx = el.getContext('2d')!,
      result = new ImageData(
        new Uint8ClampedArray(d.image.data),
        d.source.width,
        d.source.height,
      );
    for (let p = 0; p < d.pixels.length; p++) {
      const i = p * 4;
      if (view === 'cutout') {
        const a = d.pixels[p]!;
        if (
          a > 0 &&
          a < 255 &&
          d.image.data[i + 3] === 255 &&
          d.matting?.decontaminate &&
          d.foregroundImage
        )
          for (let c = 0; c < 3; c++)
            result.data[i + c] = d.foregroundImage.data[i + c]!;
        result.data[i + 3] = d.matting
          ? Math.min(d.image.data[i + 3]!, a)
          : Math.round((d.image.data[i + 3]! * a) / 255);
      }
      if (view === 'alpha') {
        result.data[i] = result.data[i + 1] = result.data[i + 2] = d.pixels[p]!;
        result.data[i + 3] = 255;
      }
      if (view === 'mask') {
        const inside = !!d.pixels[p];
        result.data[i] = Math.round(
          result.data[i]! * 0.65 + (inside ? 20 : 210) * 0.35,
        );
        result.data[i + 1] = Math.round(
          result.data[i + 1]! * 0.65 + (inside ? 220 : 20) * 0.35,
        );
        result.data[i + 2] = Math.round(result.data[i + 2]! * 0.65 + 35 * 0.35);
        if (d.seeds[p]) {
          result.data[i] = d.seeds[p] === 128 ? 255 : 0;
          result.data[i + 1] =
            d.seeds[p] === 255 ? 255 : d.seeds[p] === 64 ? 170 : 0;
          if (d.seeds[p] === 64) result.data[i] = 255;
          result.data[i + 2] = 0;
        }
      }
    }
    ctx.putImageData(result, 0, 0);
  }, [revision, ready, view]);
  useEffect(() => {
    if (!focus || !ready || !canvas.current || !viewport.current || !size)
      return;
    const el = canvas.current,
      view = viewport.current;
    const scale = el.getBoundingClientRect().width / size.width;
    view.scrollLeft = focus.x * scale - view.clientWidth / 2;
    view.scrollTop = focus.y * scale - view.clientHeight / 2;
  }, [focus, zoom, ready, size, frameWidth]);
  function focusObject() {
    const d = working.current;
    if (!d) return;
    let x0 = d.source.width,
      y0 = d.source.height,
      x1 = 0,
      y1 = 0;
    for (let p = 0; p < d.pixels.length; p++)
      if (d.pixels[p]) {
        const x = p % d.source.width,
          y = Math.floor(p / d.source.width);
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    if (x1 < x0) return;
    const base = Math.min(
      1,
      frameWidth / d.source.width,
      520 / d.source.height,
    );
    const target = Math.min(
      frameWidth / ((x1 - x0 + 24) * base),
      Math.min(520, viewport.current!.clientHeight) / ((y1 - y0 + 24) * base),
    );
    setZoom([8, 4, 2, 1].find((v) => v <= target) ?? 1);
    setFocus({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
  }
  function snapshot(): Snapshot {
    const d = working.current!;
    return {
      pixels: d.pixels.slice(),
      seeds: d.seeds.slice(),
      method: d.method,
      refineEdges: d.refineEdges,
      detailPass: d.detailPass,
      matting: d.matting,
      foreground: d.foreground,
      foregroundImage: d.foregroundImage,
    };
  }
  function remember(before: Snapshot) {
    history.current = [...history.current.slice(-5), before];
    setUndoCount(history.current.length);
  }
  function rollback() {
    const d = working.current;
    if (d && stroke.current) {
      Object.assign(d, stroke.current.before);
      stroke.current = undefined;
      redraw();
    }
  }
  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const b = e.currentTarget.getBoundingClientRect(),
      s = working.current!.source;
    return {
      x: ((e.clientX - b.left) * s.width) / b.width,
      y: ((e.clientY - b.top) * s.height) / b.height,
    };
  }
  function paint(x: number, y: number) {
    const d = working.current!;
    paintMask(
      d.pixels,
      d.seeds,
      d.source.width,
      d.source.height,
      x,
      y,
      radius,
      tool === 'unknown' ? 'unknown' : tool === 'add',
    );
    d.method = 'manual';
    d.refineEdges = undefined;
    d.detailPass = undefined;
    // Foreground estimation depends on the complete matte. Never show stale
    // edge colors and then silently recompute different ones during export.
    d.foreground = undefined;
    d.foregroundImage = undefined;
  }
  async function refine() {
    const d = working.current;
    if (!d || busy) return;
    setBusy(true);
    setMessage(
      `${method === 'grabcut' ? 'GrabCut' : `SAM ${method === 'sam3' ? '3' : '2'}${refineEdges ? ' + původní hrany' : ''}`} hledá hranice objektu…`,
    );
    try {
      const before = snapshot();
      const result = await segmentMask(
        source,
        {
          ...d.source,
          data: maskBase64(d.pixels, d.source.width, d.source.height),
          method: d.method,
          matting: d.matting,
        },
        maskBase64(d.seeds, d.source.width, d.source.height),
        method,
        refineEdges,
        detailPass,
      );
      const pixels = await pngPixels(result.data, result.width, result.height);
      if (!alive.current) return;
      remember(before);
      d.pixels = pixels;
      d.method = result.method;
      d.refineEdges = result.refineEdges;
      d.detailPass = result.detailPass;
      d.matting = undefined;
      d.foreground = undefined;
      d.foregroundImage = undefined;
      redraw();
      setView('cutout');
      setMessage(
        'Zkontroluj obrys, díry i tenké čáry. Štětcem oprav chyby; zpřesnění můžeš zopakovat.',
      );
    } catch (e) {
      if (alive.current)
        setMessage(e instanceof Error ? e.message : 'Segmentace selhala.');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function applyMatting() {
    const d = working.current;
    if (!d || busy) return;
    setBusy(true);
    setMessage(
      `${mattingMethod === 'vitmatte' ? 'ViTMatte' : 'Closed-form'} počíta alfu a barvy hrany…`,
    );
    try {
      const before = snapshot();
      const settings: MattingSettings = {
        method: mattingMethod,
        radius: edgeRadius,
        decontaminate,
      };
      const result = await matteMask(
        source,
        {
          ...d.source,
          data: maskBase64(d.pixels, d.source.width, d.source.height),
          method: d.method,
          matting: d.matting,
        },
        maskBase64(d.seeds, d.source.width, d.source.height),
        settings,
      );
      const pixels = await pngPixels(result.data, result.width, result.height);
      const foregroundImage = await decodeForeground(result.foreground);
      if (!alive.current) return;
      remember(before);
      Object.assign(d, {
        pixels,
        matting: result.matting,
        foreground: result.foreground,
        foregroundImage,
      });
      redraw();
      setView('cutout');
      setMessage(
        'Alfa je hotová. Porovnej hrany na bílé i černé, případně uprav jisté pixely štětcem a zopakuj matting.',
      );
    } catch (e) {
      if (alive.current)
        setMessage(e instanceof Error ? e.message : 'Matting selhal.');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const scale = size
    ? Math.min(1, frameWidth / size.width, 520 / size.height) * zoom
    : 1;
  return (
    <dialog
      className="mask-editor"
      aria-label="Maska objektu"
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        if (stroke.current) rollback();
        else onClose();
      }}
    >
      <header>
        <div>
          <h2>Přesná maska objektu</h2>
          <p>Výřez tvoří původní kresba. AI později opraví pouze pozadí.</p>
        </div>
        <button onClick={onClose}>Zavřít bez použití</button>
      </header>
      <fieldset disabled={!ready || busy}>
        <div className="mask-toolbar">
          <Field label="Nástroj masky">
            <select
              value={tool}
              onChange={(e) => setTool(e.target.value as typeof tool)}
            >
              <option value="add">+ Ponechat objekt · zelený štětec</option>
              <option value="erase">− Odebrat pozadí · červený štětec</option>
              <option value="unknown">
                Hrana na přepočet · oranžový štětec
              </option>
              <option value="inspect">Prohlížet / posouvat</option>
            </select>
          </Field>
          <Field label="Poloměr štětce (px zdroje)">
            <input
              type="number"
              min={1}
              max={100}
              value={radius}
              onChange={(e) =>
                setRadius(
                  Math.max(1, Math.min(100, Number(e.target.value) || 1)),
                )
              }
            />
          </Field>
          <Field label="Zobrazení masky">
            <select value={view} onChange={(e) => setView(e.target.value)}>
              <option value="mask">Zelená = objekt · červená = pozadí</option>
              <option value="cutout">Výřez na šachovnici</option>
              <option value="alpha">Alfa · černá až bílá 0–255</option>
              <option value="original">Původní obrázek</option>
            </select>
          </Field>
          <Field label="Pozadí kontroly hran">
            <select
              value={previewBackground}
              onChange={(e) => setPreviewBackground(e.target.value)}
            >
              <option value="checker">Šachovnice</option>
              <option value="white">Biele</option>
              <option value="black">Černé</option>
            </select>
          </Field>
          <Field label="Přiblížení masky">
            <select
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            >
              {[1, 2, 4, 8].map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
          </Field>
          <button onClick={focusObject}>Přiblížit objekt</button>
          <button
            disabled={!undoCount}
            onClick={() => {
              Object.assign(working.current!, history.current.pop());
              setUndoCount(history.current.length);
              redraw();
            }}
          >
            Zpět v masce
          </button>
        </div>
      </fieldset>
      <div ref={viewport} className="mask-viewport">
        {ready && size && (
          <canvas
            ref={canvas}
            width={size.width}
            height={size.height}
            aria-label="Plátno segmentační masky"
            style={{
              width: size.width * scale,
              height: size.height * scale,
              touchAction: tool === 'inspect' ? 'auto' : 'none',
              cursor: tool === 'inspect' ? 'grab' : 'crosshair',
              imageRendering: scale >= 1 ? 'pixelated' : 'auto',
              backgroundImage:
                previewBackground === 'checker' ? undefined : 'none',
              backgroundColor:
                previewBackground === 'black'
                  ? '#000'
                  : previewBackground === 'white'
                    ? '#fff'
                    : undefined,
            }}
            onPointerDown={(e) => {
              if (
                busy ||
                tool === 'inspect' ||
                e.button !== 0 ||
                stroke.current ||
                !e.isPrimary
              )
                return;
              e.preventDefault();
              const p = point(e);
              stroke.current = {
                before: snapshot(),
                pointerId: e.pointerId,
                ...p,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
              paint(p.x, p.y);
              redraw();
            }}
            onPointerMove={(e) => {
              const s = stroke.current;
              if (!s || s.pointerId !== e.pointerId) return;
              const p = point(e),
                steps = Math.ceil(
                  Math.hypot(p.x - s.x, p.y - s.y) / Math.max(1, radius / 2),
                );
              for (let i = 1; i <= steps; i++)
                paint(
                  s.x + ((p.x - s.x) * i) / steps,
                  s.y + ((p.y - s.y) * i) / steps,
                );
              s.x = p.x;
              s.y = p.y;
              redraw();
            }}
            onPointerUp={(e) => {
              if (stroke.current?.pointerId !== e.pointerId) return;
              remember(stroke.current.before);
              stroke.current = undefined;
              redraw();
            }}
            onPointerCancel={rollback}
            onLostPointerCapture={rollback}
          />
        )}
      </div>
      <p role="status">{message}</p>
      <label className="upload-button">
        Načíst PNG masku
        <input
          type="file"
          accept="image/png"
          disabled={!ready || busy}
          onChange={async (e) => {
            const file = e.target.files?.[0],
              d = working.current;
            if (!file || !d) return;
            if (file.size > 4 * 1024 * 1024) {
              setMessage('PNG maska může mít nejvýše 4 MB.');
              return;
            }
            try {
              const bytes = new Uint8Array(await file.arrayBuffer());
              let binary = '';
              for (let i = 0; i < bytes.length; i += 8192)
                binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
              const next = await pngPixels(
                btoa(binary),
                d.source.width,
                d.source.height,
              );
              if (!alive.current) return;
              remember(snapshot());
              d.pixels = next;
              d.matting = next.some((v) => v > 0 && v < 255)
                ? { method: 'import', radius: 0, decontaminate: false }
                : undefined;
              d.foreground = undefined;
              d.foregroundImage = undefined;
              d.seeds.fill(0);
              d.method = 'manual';
              d.refineEdges = undefined;
              d.detailPass = undefined;
              redraw();
              setView('cutout');
              setMessage(
                'Maska načtená. Bílá ponechává objekt, černá ho odstraní; rozměry a pixely zdroje zůstávají původní.',
              );
            } catch (error) {
              if (alive.current)
                setMessage(
                  error instanceof Error
                    ? error.message
                    : 'Masku se nepodařilo načíst.',
                );
            }
          }}
        />
      </label>
      <div className="mask-toolbar">
        <Field label="Segmentace hranic">
          <select
            value={method}
            disabled={busy}
            onChange={(e) => setMethod(e.target.value as typeof method)}
          >
            <option value="grabcut">GrabCut · lokálně barvy a hrany</option>
            <option value="sam3" disabled={!available?.sam3}>
              SAM 3 · lokální AI model
            </option>
            <option value="sam2" disabled={!available?.sam2}>
              SAM 2 · lokální AI model
            </option>
          </select>
        </Field>
        {method !== 'grabcut' && (
          <label className="mask-edge-toggle">
            <input
              type="checkbox"
              checked={detailPass}
              disabled={busy}
              onChange={(e) => setDetailPass(e.target.checked)}
            />{' '}
            Detailní přechod · experimentální
          </label>
        )}
        {method !== 'grabcut' && (
          <label className="mask-edge-toggle">
            <input
              type="checkbox"
              checked={refineEdges}
              disabled={busy}
              onChange={(e) => setRefineEdges(e.target.checked)}
            />{' '}
            Dotáhnout obrysy a tenké části
          </label>
        )}
        <button
          disabled={!ready || busy || !available?.[method]}
          onClick={() => void refine()}
        >
          Zpřesnit hranice objektu
        </button>
      </div>
      {!available?.sam3 && (
        <p className="field-note">
          SAM 3 není připravený. Spusť npm run setup:sam3; váhy vyžadují
          schválený přístup na Hugging Face. SAM 2 a ruční úpravy zůstávají
          dostupné.
        </p>
      )}
      <fieldset disabled={!ready || busy} className="mask-matting">
        <legend>2. Jemné hrany · alpha matting</legend>
        <div className="mask-toolbar">
          <Field label="Metoda alpha mattingu">
            <select
              value={mattingMethod}
              onChange={(e) =>
                setMattingMethod(e.target.value as typeof mattingMethod)
              }
            >
              <option value="vitmatte" disabled={!available?.vitmatte}>
                ViTMatte + přesné kreslené hrany
              </option>
              <option value="closed-form" disabled={!available?.closedForm}>
                Closed-form · původní barvy
              </option>
            </select>
          </Field>
          <Field label="Pásmo nejistých hran (px zdroje)">
            <input
              type="number"
              min={1}
              max={32}
              value={edgeRadius}
              onChange={(e) =>
                setEdgeRadius(
                  Math.max(
                    1,
                    Math.min(32, Math.round(Number(e.target.value) || 1)),
                  ),
                )
              }
            />
          </Field>
          <label className="mask-edge-toggle">
            <input
              type="checkbox"
              checked={decontaminate}
              onChange={(e) => setDecontaminate(e.target.checked)}
            />
            Odstranit barevný lem
          </label>
          <button
            disabled={
              !(mattingMethod === 'vitmatte'
                ? available?.vitmatte
                : available?.closedForm)
            }
            onClick={() => void applyMatting()}
          >
            Vypočítat jemnou alfu
          </button>
        </div>
        <p className="field-note">
          Nejprve vyber objekt nebo zpřesni SAM. Zelená/červená určují jisté
          vnitřek/pozadí, oranžová uvolní hranu na přepočet. Model mění alfu, ne
          kresbu. Odstranění lemu odhaduje původní barvu pouze na poloprůhledném
          okraji; vypnutím zachováš všechna RGB. Nástroje: npm run
          setup:matting.
        </p>
      </fieldset>
      <div className="mask-toolbar">
        <button
          className="primary-button"
          disabled={!ready || busy || foregroundDirty}
          onClick={() => {
            const d = working.current!;
            if (!d.pixels.some((v) => v > 0)) {
              setMessage('Maska je prázdná. Označ objekt zeleným štětcem.');
              return;
            }
            onDone({
              ...d.source,
              data: maskBase64(d.pixels, d.source.width, d.source.height),
              method: d.method,
              refineEdges: d.refineEdges,
              detailPass: d.detailPass,
              matting: d.matting,
              foreground: d.foreground,
            });
          }}
        >
          Použít masku
        </button>
        {foregroundDirty && (
          <p className="field-note">
            Po úpravě masky znovu vypočítej jemnou alfu, aby náhled barev
            odpovídal exportu. Nebo vypni odstranění lemu a přepočítej.
          </p>
        )}
      </div>
      {!available?.grabcut && (
        <p className="field-note">
          Automatické zpřesnění: spusť npm run setup:segmentation a restartuj
          Vite. Ruční maskování funguje i bez Pythonu.
        </p>
      )}
      {method !== 'grabcut' && (
        <p className="field-note">
          SAM odhadne tvar objektu. Dotažení obrysů použije barvy a hrany
          původního obrázku v pásmu 12 px okolo hranice. Chybějící anténu nebo
          čáru přejeď zeleným štětcem, nežádoucí pozadí červeným. Tyto pixely
          zůstanou zachované i po dalším zpřesnění.
        </p>
      )}
      <p className="field-note">
        Výběr má původní rozměry a zarovnání. Binární výřez zachová původní RGB
        a alfu. Matting zachová všechny pevné pixely; průhlednost hrany a
        případné dočištění barvy se ukládají samostatně v receptu.
      </p>
    </dialog>
  );
}

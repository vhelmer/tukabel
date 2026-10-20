import { useEffect, useRef, useState } from 'react';
import type { Point } from '../game/transforms';
import { getMaskSource, segmentMask } from './api';
import type { MaskSource, ObjectMask } from './masks';
import { maskBase64, paintMask, pngPixels } from './maskCanvas';
import { Field } from './fields';

type Snapshot = {
  pixels: Uint8Array;
  seeds: Uint8Array;
  method: ObjectMask['method'];
  refineEdges?: boolean;
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
  initial?: ObjectMask;
  available?: { grabcut: boolean; sam2: boolean };
  onDone: (mask: ObjectMask) => void;
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
    [message, setMessage] = useState('Načítavam pôvodné pixely…');
  const [tool, setTool] = useState<'add' | 'erase' | 'inspect'>('add'),
    [view, setView] = useState('mask'),
    [radius, setRadius] = useState(8),
    [zoom, setZoom] = useState(1),
    [frameWidth, setFrameWidth] = useState(900);
  const [method, setMethod] = useState<'grabcut' | 'sam2'>(
    available?.sam2 ? 'sam2' : 'grabcut',
  );
  const [refineEdges, setRefineEdges] = useState(initial?.refineEdges ?? true);
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
        let pixels: Uint8Array;
        if (initial?.sourceSha256 === original.sourceSha256)
          pixels = await pngPixels(
            initial.data,
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
        working.current = {
          source: original,
          image: imageData,
          pixels,
          seeds: new Uint8Array(pixels.length),
          method: initial?.method ?? 'manual',
          refineEdges: initial?.refineEdges,
        };
        setSize(original);
        setReady(true);
        setRevision((v) => v + 1);
        setMessage(
          'Zeleným štetcom označ objekt, červeným pozadie. Spresnenie hľadá hranice v pôvodnom obrázku; farby nemení.',
        );
      } catch (e) {
        if (!disposed)
          setMessage(e instanceof Error ? e.message : 'Načítanie zlyhalo.');
      }
    })();
    return () => {
      disposed = true;
    };
  }, [source, selection, initial]);
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
      if (view === 'cutout' && !d.pixels[p]) result.data[i + 3] = 0;
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
          result.data[i + 1] = d.seeds[p] === 255 ? 255 : 0;
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
      setRevision((v) => v + 1);
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
      tool === 'add',
    );
    d.method = 'manual';
    d.refineEdges = undefined;
  }
  async function refine() {
    const d = working.current;
    if (!d || busy) return;
    setBusy(true);
    setMessage(
      `${method === 'sam2' ? (refineEdges ? 'SAM 2 + pôvodné hrany' : 'SAM 2') : 'GrabCut'} hľadá hranice objektu…`,
    );
    try {
      const before = snapshot();
      const result = await segmentMask(
        source,
        {
          ...d.source,
          data: maskBase64(d.pixels, d.source.width, d.source.height),
          method: d.method,
        },
        maskBase64(d.seeds, d.source.width, d.source.height),
        method,
        refineEdges,
      );
      const pixels = await pngPixels(result.data, result.width, result.height);
      if (!alive.current) return;
      remember(before);
      d.pixels = pixels;
      d.method = result.method;
      d.refineEdges = result.refineEdges;
      setRevision((v) => v + 1);
      setView('cutout');
      setMessage(
        'Skontroluj obrys, diery aj tenké čiary. Štetcom oprav chyby; spresnenie môžeš zopakovať.',
      );
    } catch (e) {
      if (alive.current)
        setMessage(e instanceof Error ? e.message : 'Segmentácia zlyhala.');
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
          <h2>Presná maska objektu</h2>
          <p>Výrez tvorí pôvodná kresba. AI neskôr opraví iba pozadie.</p>
        </div>
        <button onClick={onClose}>Zavrieť bez použitia</button>
      </header>
      <fieldset disabled={!ready || busy}>
        <div className="mask-toolbar">
          <Field label="Nástroj masky">
            <select
              value={tool}
              onChange={(e) => setTool(e.target.value as typeof tool)}
            >
              <option value="add">+ Ponechať objekt · zelený štetec</option>
              <option value="erase">− Odobrať pozadie · červený štetec</option>
              <option value="inspect">Prehliadať / posúvať</option>
            </select>
          </Field>
          <Field label="Polomer štetca (px zdroja)">
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
          <Field label="Zobrazenie masky">
            <select value={view} onChange={(e) => setView(e.target.value)}>
              <option value="mask">Zelená = objekt · červená = pozadie</option>
              <option value="cutout">Výrez na šachovnici</option>
              <option value="original">Pôvodný obrázok</option>
            </select>
          </Field>
          <Field label="Priblíženie masky">
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
          <button onClick={focusObject}>Priblížiť objekt</button>
          <button
            disabled={!undoCount}
            onClick={() => {
              Object.assign(working.current!, history.current.pop());
              setUndoCount(history.current.length);
              setRevision((v) => v + 1);
            }}
          >
            Späť v maske
          </button>
        </div>
      </fieldset>
      <div ref={viewport} className="mask-viewport">
        {ready && size && (
          <canvas
            ref={canvas}
            width={size.width}
            height={size.height}
            aria-label="Plátno segmentačnej masky"
            style={{
              width: size.width * scale,
              height: size.height * scale,
              touchAction: tool === 'inspect' ? 'auto' : 'none',
              cursor: tool === 'inspect' ? 'grab' : 'crosshair',
              imageRendering: scale >= 1 ? 'pixelated' : 'auto',
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
              setRevision((v) => v + 1);
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
              setRevision((v) => v + 1);
            }}
            onPointerUp={(e) => {
              if (stroke.current?.pointerId !== e.pointerId) return;
              remember(stroke.current.before);
              stroke.current = undefined;
              setRevision((v) => v + 1);
            }}
            onPointerCancel={rollback}
            onLostPointerCapture={rollback}
          />
        )}
      </div>
      <p role="status">{message}</p>
      <label className="upload-button">
        Načítať PNG masku
        <input
          type="file"
          accept="image/png"
          disabled={!ready || busy}
          onChange={async (e) => {
            const file = e.target.files?.[0],
              d = working.current;
            if (!file || !d) return;
            if (file.size > 4 * 1024 * 1024) {
              setMessage('PNG maska môže mať najviac 4 MB.');
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
              d.pixels = next.map((v) => (v >= 128 ? 255 : 0));
              d.seeds.fill(0);
              d.method = 'manual';
              d.refineEdges = undefined;
              setRevision((v) => v + 1);
              setView('cutout');
              setMessage(
                'Maska načítaná. Biela ponecháva objekt, čierna ho odstráni; rozmery a pixely zdroja zostávajú pôvodné.',
              );
            } catch (error) {
              if (alive.current)
                setMessage(
                  error instanceof Error
                    ? error.message
                    : 'Masku sa nepodarilo načítať.',
                );
            }
          }}
        />
      </label>
      <div className="mask-toolbar">
        <Field label="Segmentácia hraníc">
          <select
            value={method}
            disabled={busy}
            onChange={(e) => setMethod(e.target.value as typeof method)}
          >
            <option value="grabcut">GrabCut · lokálne farby a hrany</option>
            <option value="sam2" disabled={!available?.sam2}>
              SAM 2 · lokálny AI model
            </option>
          </select>
        </Field>
        {method === 'sam2' && (
          <label className="mask-edge-toggle">
            <input
              type="checkbox"
              checked={refineEdges}
              disabled={busy}
              onChange={(e) => setRefineEdges(e.target.checked)}
            />{' '}
            Dotiahnuť obrysy a tenké časti
          </label>
        )}
        <button
          disabled={!ready || busy || !available?.[method]}
          onClick={() => void refine()}
        >
          Spresniť hranice objektu
        </button>
        <button
          className="primary-button"
          disabled={!ready || busy}
          onClick={() => {
            const d = working.current!;
            if (!d.pixels.includes(255)) {
              setMessage('Maska je prázdna. Označ objekt zeleným štetcom.');
              return;
            }
            onDone({
              ...d.source,
              data: maskBase64(d.pixels, d.source.width, d.source.height),
              method: d.method,
              refineEdges: d.refineEdges,
            });
          }}
        >
          Použiť masku
        </button>
      </div>
      {!available?.grabcut && (
        <p className="field-note">
          Automatické spresnenie: spusti npm run setup:segmentation a reštartuj
          Vite. Ručné maskovanie funguje aj bez Pythonu.
        </p>
      )}
      {method === 'sam2' && (
        <p className="field-note">
          SAM 2 odhadne tvar objektu. Dotiahnutie obrysov použije farby a hrany
          pôvodného obrázka v pásme 12 px okolo hranice. Chýbajúcu anténu alebo
          čiaru prejdi zeleným štetcom, nežiaduce pozadie červeným. Tieto pixely
          zostanú zachované aj po ďalšom spresnení.
        </p>
      )}
      <p className="field-note">
        Bez rozmazávania a zmeny RGB. Vybrané pixely zachovávajú pôvodnú
        priehľadnosť. Výber má pôvodné rozmery a zarovnanie; maska sa uloží s
        výsledným assetom.
      </p>
    </dialog>
  );
}

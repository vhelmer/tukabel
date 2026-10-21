import { useState } from 'react';
import { assetUrl } from '../game/assets';
import type { InpaintDebug } from './inpaintDebug';
import { Field } from './fields';

export function InpaintInspector({ debug }: { debug: InpaintDebug }) {
  const [step, setStep] = useState<keyof InpaintDebug['files']>('input');
  const [zoom, setZoom] = useState('fit');
  const [overlay, setOverlay] = useState(true);
  const steps: [keyof InpaintDebug['files'], string][] = [
    ['original', '1 · Původní obrázek'],
    ['objectMask', '2 · Maska objektu · bílá = objekt'],
    ['expandedMask', '3 · Rozšířená maska · bílá = inpainting'],
    ['input', '4 · Přesný vstup / kontext pro model'],
    ['returned', '5 · Surový výsledek modelu'],
    ['final', '6 · Maskovaná kompozice celého zdroje'],
    ['apiMask', 'API maska · průhledné = povolená úprava'],
    ['blendMask', 'Přechod kompozice · bílá = 100 % výsledku'],
    ['roundTrip', 'Kontrolní návrat bez AI · pouze škálování'],
    ['restored', 'Výsledek po návratu do souřadnic scény'],
    ['difference', 'Rozdíl modelu oproti návratu bez AI · 4×'],
  ];
  const path = debug.files[step];
  const { geometry: g, metrics: m } = debug;
  const providerSpace = ['input', 'apiMask', 'returned'].includes(step);
  const size =
    step === 'returned'
      ? (g.returned ?? g.canvas)
      : providerSpace
        ? g.canvas
        : g.context;
  return (
    <details className="inpaint-inspector" open>
      <summary>Diagnostika inpaintingu · jednotlivé kroky</summary>
      <p>
        Model dostává celý zdroj {g.context.width} × {g.context.height}, ne
        lokální výřez. Pracovní plátno: {g.canvas.width} × {g.canvas.height};
        obrázek v něm: {g.content.width} × {g.content.height}, odsazení x=
        {g.content.left}, y={g.content.top}. Výsledek se vrací tou stejnou
        transformací. Žádný color matching.
      </p>
      <div className="art-settings">
        <Field label="Krok diagnostiky">
          <select
            value={step}
            onChange={(e) => setStep(e.target.value as typeof step)}
          >
            {steps.map(([id, label]) => (
              <option key={id} value={id} disabled={!debug.files[id]}>
                {label}
                {!debug.files[id] ? ' · ještě není k dispozici' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Zvětšení diagnostiky">
          <select value={zoom} onChange={(e) => setZoom(e.target.value)}>
            <option value="fit">Celý obrázek</option>
            <option value="1">1:1 · původní pixely</option>
            <option value="2">2× · kontrola hran</option>
          </select>
        </Field>
      </div>
      {['objectMask', 'expandedMask', 'blendMask'].includes(step) && (
        <label>
          <input
            type="checkbox"
            checked={overlay}
            onChange={(e) => setOverlay(e.target.checked)}
          />{' '}
          Překrýt masku původním obrázkem
        </label>
      )}
      <div className="inpaint-viewport checkerboard">
        <div
          className="inpaint-image"
          style={{
            width: zoom === 'fit' ? '100%' : size.width * Number(zoom),
            imageRendering: zoom === 'fit' ? 'auto' : 'pixelated',
          }}
        >
          {path && (
            <img src={assetUrl(path)} alt="Diagnostický krok inpaintingu" />
          )}
          {overlay &&
            ['objectMask', 'expandedMask', 'blendMask'].includes(step) && (
              <img
                className="inpaint-overlay"
                style={{ mixBlendMode: 'screen' }}
                src={assetUrl(debug.files.original)}
                alt="Původní obrázek pod maskou"
              />
            )}
        </div>
      </div>
      {path && (
        <a href={assetUrl(path)} target="_blank" rel="noreferrer">
          Otevřít přesný PNG soubor ({size.width} × {size.height}) ↗
        </a>
      )}
      {!debug.files.returned && (
        <p>
          Kontrola přípravy bez API. Model nebyl volaný; kroky 5 a 6 vzniknou až
          po výslovném spuštění AI úpravy.
        </p>
      )}
      <p>
        Objekt: {m.objectPixels} px · rozšířená maska: {m.expandedPixels} px ·
        přesah: {m.padding} px · přechod švu: {m.feather} px ({m.featherPixels}{' '}
        částečných pixelů). Ztracené pixely objektu po škálování masky:{' '}
        {m.lostObjectPixels}. Nejvyšší zásah na vnější hranici:{' '}
        {m.boundaryMaxWeight}/255.
      </p>
      <p>
        RGB odchylka samotného škálování: {m.roundTripMae}/255.
        {m.contextMae !== undefined && (
          <> Odchylka modelu v chráněném kontextu: {m.contextMae}/255.</>
        )}
        {m.seamMae !== undefined && (
          <> Odchylka v 4px prstenci okolo opravy: {m.seamMae}/255.</>
        )}
        {m.outsideChanges !== undefined && (
          <> Změny mimo opravné masky ve finále: {m.outsideChanges} px.</>
        )}{' '}
        Nulová odchylka nepotvrzuje správnost výběru ani kvalitu hrany; porovnej
        obrázky.
      </p>
      {debug.warnings.map((warning) => (
        <p role="note" key={warning}>
          {warning}
        </p>
      ))}
    </details>
  );
}

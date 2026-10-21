import { useState } from 'react';
import { assetUrl } from '../game/assets';
import type { InpaintDebug } from './inpaintDebug';
import { Field } from './fields';

export function InpaintInspector({ debug }: { debug: InpaintDebug }) {
  const [step, setStep] = useState<keyof InpaintDebug['files']>('input');
  const [zoom, setZoom] = useState('fit');
  const [overlay, setOverlay] = useState(true);
  const steps: [keyof InpaintDebug['files'], string][] = [
    ['original', '1 · Pôvodný obrázok'],
    ['objectMask', '2 · Maska objektu · biela = objekt'],
    ['expandedMask', '3 · Rozšírená maska · biela = inpainting'],
    ['input', '4 · Presný vstup / kontext pre model'],
    ['returned', '5 · Surový výsledok modelu'],
    ['final', '6 · Finálna kompozícia celého zdroja'],
    ['apiMask', 'API maska · priehľadné = povolená úprava'],
    ['blendMask', 'Prechod kompozície · biela = 100 % výsledku'],
    ['roundTrip', 'Kontrolný návrat bez AI · iba škálovanie'],
    ['restored', 'Výsledok po návrate do súradníc scény'],
    ['difference', 'Rozdiel modelu oproti návratu bez AI · 4×'],
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
        Model dostáva celý zdroj {g.context.width} × {g.context.height}, nie
        lokálny výrez. Pracovné plátno: {g.canvas.width} × {g.canvas.height};
        obrázok v ňom: {g.content.width} × {g.content.height}, odsadenie x=
        {g.content.left}, y={g.content.top}. Výsledok sa vracia tou istou
        transformáciou. Žiadny color matching.
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
                {!debug.files[id] ? ' · ešte nie je k dispozícii' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Zväčšenie diagnostiky">
          <select value={zoom} onChange={(e) => setZoom(e.target.value)}>
            <option value="fit">Celý obrázok</option>
            <option value="1">1:1 · pôvodné pixely</option>
            <option value="2">2× · kontrola hrán</option>
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
          Prekryť masku pôvodným obrázkom
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
                alt="Pôvodný obrázok pod maskou"
              />
            )}
        </div>
      </div>
      {path && (
        <a href={assetUrl(path)} target="_blank" rel="noreferrer">
          Otvoriť presný PNG súbor ({size.width} × {size.height}) ↗
        </a>
      )}
      {!debug.files.returned && (
        <p>
          Kontrola prípravy bez API. Model nebol volaný; kroky 5 a 6 vzniknú až
          po výslovnom spustení AI úpravy.
        </p>
      )}
      <p>
        Objekt: {m.objectPixels} px · rozšírená maska: {m.expandedPixels} px ·
        presah: {m.padding} px · prechod švu: {m.feather} px ({m.featherPixels}{' '}
        čiastočných pixelov). Stratené pixely objektu po škálovaní masky:{' '}
        {m.lostObjectPixels}. Najvyšší zásah na vonkajšej hranici:{' '}
        {m.boundaryMaxWeight}/255.
      </p>
      <p>
        RGB odchýlka samotného škálovania: {m.roundTripMae}/255.
        {m.contextMae !== undefined && (
          <> Odchýlka modelu v chránenom kontexte: {m.contextMae}/255.</>
        )}
        {m.seamMae !== undefined && (
          <> Odchýlka v 4px prstenci okolo opravy: {m.seamMae}/255.</>
        )}
        {m.outsideChanges !== undefined && (
          <> Zmeny mimo opravnej masky vo finále: {m.outsideChanges} px.</>
        )}{' '}
        Nulová odchýlka nepotvrdzuje správnosť výberu ani kvalitu hrany;
        porovnaj obrázky.
      </p>
      {debug.warnings.map((warning) => (
        <p role="note" key={warning}>
          {warning}
        </p>
      ))}
    </details>
  );
}

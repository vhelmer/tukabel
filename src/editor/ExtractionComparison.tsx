import { useState } from 'react';
import { assetUrl } from '../game/assets';
import type { ArtworkResult } from './api';
import { Field } from './fields';

export function ExtractionComparison({ result }: { result: ArtworkResult }) {
  const [view, setView] = useState('compare'),
    [split, setSplit] = useState(50);
  if (!result.original || !result.reassembled) return null;
  const path = {
    original: result.original,
    reassembled: result.reassembled,
    difference: result.difference,
    background: result.image,
    cutout: result.cutoutFull ?? result.cutout,
    repair: result.repairMask,
  }[view];
  return (
    <section className="extraction-comparison" aria-label="Porovnání oddělení">
      <h3>
        {result.extractionMethod === 'openai'
          ? 'Kontrola umístění OpenAI výřezu'
          : 'Kontrola přesného zarovnání'}
      </h3>
      <p>
        {result.extractionMethod === 'openai'
          ? 'Objekt je překreslený OpenAI a proporčně vložený do původního rámu. Srovnání ukazuje objekt na maskované variantě opraveného pozadí; neposuzuje pixelovou shodu s originálem.'
          : (result.reconstruction?.unexpectedPixels ??
                result.reconstruction?.changedPixels) === 0
            ? result.reconstruction?.edgePixels !== undefined
              ? 'Výřez: 0 chyb v pevných pixelech a zarovnání. Jemná alfa se vyhodnocuje samostatně.'
              : 'Výřez: 0 chyb při zachování původních pixelů a zarovnání.'
            : 'Zkontroluj výsledek oproti originálu.'}
      </p>
      {result.reconstruction?.edgePixels !== undefined && (
        <p>
          Matting: {result.reconstruction.edgePixels} změněných okrajových
          pixelů. Modrá označuje jemnou hranu; zkontroluj ji na kontrastním
          pozadí.
        </p>
      )}
      {!!result.reconstruction?.cleanupPixels && (
        <p>
          Pozadí v opravném přesahu: {result.reconstruction.cleanupPixels}{' '}
          záměrně upravených pixelů. Zlatá v rozdílu označuje toto dočištění.
        </p>
      )}
      <Field label="Porovnání výřezu">
        <select value={view} onChange={(e) => setView(e.target.value)}>
          <option value="compare">
            Originál ↔ pozadí + objekt na původním místě
          </option>
          <option value="original">Původní obrázek</option>
          <option value="cutout">Výřez na šachovnici</option>
          <option value="background">Opravené pozadí bez objektu</option>
          {result.repairMask && (
            <option value="repair">Maska opravy pozadí · bílá = oprava</option>
          )}
          {result.difference && (
            <option value="difference">
              Rozdíl · zlatá = pozadí, modrá = alfa, červená = chyba
            </option>
          )}
        </select>
      </Field>
      {view === 'compare' && (
        <Field label="Posuvník porovnání">
          <input
            type="range"
            min={0}
            max={100}
            value={split}
            onChange={(e) => setSplit(Number(e.target.value))}
          />
        </Field>
      )}
      <div className="extraction-stack checkerboard">
        <img
          src={assetUrl(
            view === 'compare' ? result.original : (path ?? result.original),
          )}
          alt="Kontrola výřezu proti originálu"
        />
        {view === 'compare' && (
          <>
            <img
              className="extraction-overlay"
              style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
              src={assetUrl(result.reassembled)}
              alt="Složené pozadí a oddělený objekt"
            />
            <span
              className="comparison-divider"
              style={{ left: `${split}%` }}
            />
          </>
        )}
      </div>
      <p className="field-note">
        Exportovaný asset je oříznutý podle nenulové alfy; offset v receptu
        zachovává přesnou pozici. Kontrola zde používá archivní celé plátno a
        maskovanou kompozici, nikoli volitelné celé obnovené pozadí. Zkontroluj
        také samotný výřez: přesné složení potvrzuje zarovnání, ne správné
        rozpoznání objektu.
      </p>
    </section>
  );
}

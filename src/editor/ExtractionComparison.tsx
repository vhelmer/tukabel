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
    cutout: result.cutout,
    repair: result.repairMask,
  }[view];
  return (
    <section
      className="extraction-comparison"
      aria-label="Porovnanie oddelenia"
    >
      <h3>Kontrola presného zarovnania</h3>
      <p>
        {(result.reconstruction?.unexpectedPixels ??
          result.reconstruction?.changedPixels) === 0
          ? 'Výrez: 0 chýb pri zachovaní pôvodných pixelov a zarovnania.'
          : 'Skontroluj výsledok oproti originálu.'}
      </p>
      {!!result.reconstruction?.cleanupPixels && (
        <p>
          Pozadie v opravnom presahu: {result.reconstruction.cleanupPixels}{' '}
          zámerne upravených pixelov. Zlatá v rozdiele označuje toto dočistenie.
        </p>
      )}
      <Field label="Porovnanie výrezu">
        <select value={view} onChange={(e) => setView(e.target.value)}>
          <option value="compare">
            Originál ↔ pozadie + objekt na pôvodnom mieste
          </option>
          <option value="original">Pôvodný obrázok</option>
          <option value="cutout">Výrez na šachovnici</option>
          <option value="background">Opravené pozadie bez objektu</option>
          {result.repairMask && (
            <option value="repair">
              Maska opravy pozadia · biela = oprava
            </option>
          )}
          <option value="difference">
            Rozdiel · zlatá = dočistenie, červená = chyba
          </option>
        </select>
      </Field>
      {view === 'compare' && (
        <Field label="Posuvník porovnania">
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
          alt="Kontrola výrezu proti originálu"
        />
        {view === 'compare' && (
          <>
            <img
              className="extraction-overlay"
              style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
              src={assetUrl(result.reassembled)}
              alt="Zložené pozadie a pôvodný výrez"
            />
            <span
              className="comparison-divider"
              style={{ left: `${split}%` }}
            />
          </>
        )}
      </div>
      <p className="field-note">
        Výrez má celé pôvodné plátno. Nič sa neorezáva, neposúva ani neškáluje.
        Skontroluj tiež samotný výrez: presné zloženie potvrdzuje zarovnanie,
        nie správne rozpoznanie objektu.
      </p>
    </section>
  );
}

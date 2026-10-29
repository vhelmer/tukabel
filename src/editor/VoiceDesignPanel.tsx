import { useEffect, useRef, useState } from 'react';
import { assetUrl } from '../game/assets';
import { generateVoiceDesign, saveVoiceDesign } from './api';
import { Field } from './fields';
import type { SavedDesignVoice, VoiceDesignResult } from './voiceDesign';

export function VoiceDesignPanel({
  characterName,
  onVoice,
}: {
  characterName: string;
  onVoice: (voice: SavedDesignVoice) => void;
}) {
  const [description, setDescription] = useState('');
  const [text, setText] = useState(
    'Počúvaj ma pozorne! Ten kábel sa nemohol len tak vypariť. Niekto tu niečo tají, a ja sa pravdu dozviem, aj keby som mal prevrátiť celú dedinu hore nohami!',
  );
  const [name, setName] = useState(characterName);
  const [result, setResult] = useState<VoiceDesignResult>();
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const mounted = useRef(false);
  const pending = useRef(false);
  const latestOnVoice = useRef(onVoice);
  useEffect(() => {
    latestOnVoice.current = onVoice;
  }, [onVoice]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      if (mounted.current)
        setMessage(
          error instanceof Error ? error.message : 'Voice Design selhal.',
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <details className="voice-design">
      <summary>Voice Design · nový charakterový hlas</summary>
      <p className="field-note">
        Popiš barvu, výšku, chrapot, tempo a herecký projev. Vytvoření tří
        ukázek čerpá kredity ElevenLabs. Poslechni je a vybraný hlas samostatně
        ulož do svého účtu.
      </p>
      <Field label="Popis hlasu (20–1000 znaků)">
        <textarea
          value={description}
          minLength={20}
          maxLength={1000}
          disabled={busy}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Field label="Ukázkový text (100–1000 znaků)">
        <textarea
          value={text}
          minLength={100}
          maxLength={1000}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <button
        disabled={
          busy || description.trim().length < 20 || text.trim().length < 100
        }
        onClick={() =>
          void run(async () => {
            const designed = await generateVoiceDesign({ description, text });
            if (!mounted.current) return;
            setResult(designed);
            setSelected(0);
            setSaved(false);
            setMessage('Tři ukázky jsou archivované. Vyber hlas po poslechu.');
          })
        }
      >
        Vygenerovat 3 ukázky (čerpá kredity)
      </button>
      {result && (
        <>
          {result.previews.map((preview, index) => (
            <div key={preview.generatedVoiceId}>
              <label>
                <input
                  type="radio"
                  name={`voice-design-${result.manifest}`}
                  checked={selected === index}
                  disabled={busy || saved}
                  onChange={() => setSelected(index)}
                />
                Ukázka {index + 1}
              </label>
              <audio controls preload="none" src={assetUrl(preview.audio)} />
            </div>
          ))}
          <Field label="Název uloženého hlasu">
            <input
              value={name}
              maxLength={100}
              disabled={busy || saved}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <button
            disabled={busy || saved || !name.trim()}
            onClick={() =>
              void run(async () => {
                const preview = result.previews[selected];
                if (!preview) return;
                const registration = await saveVoiceDesign({
                  manifest: result.manifest,
                  previewIndex: selected,
                  generatedVoiceId: preview.generatedVoiceId,
                  name,
                });
                if (!mounted.current) return;
                latestOnVoice.current(registration);
                setSaved(true);
                setMessage(
                  'Hlas je uložený v ElevenLabs a přiřazený do návrhu postavy. Změnu projektu potvrď tlačítkem Uložit do projektu.',
                );
              })
            }
          >
            Uložit vybraný hlas a přiřadit do návrhu
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}

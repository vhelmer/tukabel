import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  DialogueNode,
  GameContent,
  Hotspot,
  VoiceSettings,
} from '../game/types';
import { defaultVoice, mouthShapes } from '../game/speech';
import { assetUrl } from '../game/assets';
import { useDialogueAudio } from '../ui/DialogueAudio';
import { CombinedPreview } from './CharacterPreview';
import { Field, SelectId } from './fields';
import {
  analyzeSpeech,
  generateSpeech,
  getSpeechCatalog,
  getSpeechStatus,
  uploadSpeech,
} from './api';
import type { SpeechCatalog } from './api';

export function VoicePanel({
  hotspot,
  content,
  onHotspot,
}: {
  hotspot: Hotspot;
  content: GameContent;
  onHotspot: (h: Hotspot) => void;
}) {
  const [catalog, setCatalog] = useState<SpeechCatalog>(),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const voice = hotspot.animation?.voice ?? defaultVoice;
  const model = catalog?.models.find((m) => m.id === voice.modelId);
  const update = (next: VoiceSettings) =>
    onHotspot({
      ...hotspot,
      animation: {
        ...hotspot.animation,
        voice: next.voiceId ? next : undefined,
      },
    });
  const talk = content.animations?.find(
    (c) => c.id === hotspot.animation?.talk,
  );
  return (
    <>
      <details className="voice-settings">
        <summary>Hlas ElevenLabs</summary>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await getSpeechCatalog();
              if (mounted.current) {
                setCatalog(result);
                setMessage(
                  result.hasMore
                    ? 'Zobrazených prvých 100 hlasov. Ďalší hlas zadaj cez ID.'
                    : 'Hlasy načítané.',
                );
              }
            } catch (e) {
              if (mounted.current)
                setMessage(
                  e instanceof Error ? e.message : 'Načítanie zlyhalo.',
                );
            } finally {
              if (mounted.current) setBusy(false);
            }
          }}
        >
          Načítať hlasy a modely
        </button>
        <Field label="ElevenLabs Voice ID">
          <input
            list="eleven-voices"
            value={voice.voiceId}
            onChange={(e) => update({ ...voice, voiceId: e.target.value })}
          />
        </Field>
        <datalist id="eleven-voices">
          {catalog?.voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </datalist>
        <Field label="ElevenLabs Model ID">
          <input
            list="eleven-models"
            value={voice.modelId}
            disabled={!voice.voiceId}
            onChange={(e) => update({ ...voice, modelId: e.target.value })}
          />
        </Field>
        <datalist id="eleven-models">
          {(
            catalog?.models ?? [
              { id: 'eleven_multilingual_v2', label: 'Multilingual v2' },
              { id: 'eleven_flash_v2_5', label: 'Flash v2.5' },
              { id: 'eleven_v3', label: 'Eleven v3' },
            ]
          ).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </datalist>
        {model && !model.languages.includes('sk') && (
          <p className="field-note">
            Model neuvádza slovenčinu. Vyber model s podporou sk.
          </p>
        )}
        {(['stability', 'similarityBoost', 'style', 'speed'] as const).map(
          (key) => (
            <Field
              key={key}
              label={
                {
                  stability: 'Stabilita hlasu',
                  similarityBoost: 'Podobnosť hlasu',
                  style: 'Výraznosť prejavu',
                  speed: 'Rýchlosť reči',
                }[key]
              }
            >
              <input
                type="number"
                min={key === 'speed' ? 0.7 : 0}
                max={key === 'speed' ? 1.2 : 1}
                step={
                  voice.modelId.startsWith('eleven_v3') && key === 'stability'
                    ? 0.5
                    : 0.05
                }
                disabled={
                  !voice.voiceId ||
                  (key === 'style' &&
                    (model
                      ? !model.style
                      : /^eleven_v[34]/.test(voice.modelId)))
                }
                value={voice[key]}
                onChange={(e) =>
                  update({ ...voice, [key]: Number(e.target.value) })
                }
              />
            </Field>
          ),
        )}
        <label>
          <input
            type="checkbox"
            disabled={
              !voice.voiceId ||
              (model
                ? !model.speakerBoost
                : /^eleven_v[34]/.test(voice.modelId))
            }
            checked={voice.useSpeakerBoost}
            onChange={(e) =>
              update({ ...voice, useSpeakerBoost: e.target.checked })
            }
          />
          Zvýraznenie podobnosti hlasu
        </label>
        <p className="field-note">
          Klient nepozná API kľúč. Generovanie sa spúšťa iba ručne v záložke
          Dabing a lip-sync.
        </p>
        {message && <p role="status">{message}</p>}
      </details>
      <details
        className="mouth-mapping"
        open={Boolean(hotspot.animation?.mouthShapes)}
      >
        <summary>Tvary úst Rhubarb</summary>
        {!talk?.region ? (
          <p>Najprv priraď lokálny klip Rozprávanie.</p>
        ) : (
          <>
            <p className="field-note">
              Priraď aspoň pokoj X a otvorené ústa C. Bez mapovania hrá bežná
              slučka. Čísla sú snímky priradeného klipu. X = pokoj, A = zavreté,
              B = zuby, C/D = otvorené, E/F = zaokrúhlené, G = F/V, H = L.
              Chýbajúce otvorené tvary použijú C → B → X → prvý snímok; A
              použije X.
            </p>
            {mouthShapes.map((shape) => (
              <SelectId
                key={shape}
                label={`Tvar úst ${shape}`}
                value={String(hotspot.animation?.mouthShapes?.[shape] ?? '')}
                empty="Automatický fallback"
                values={talk.frames.map((_, i) => ({
                  id: String(i),
                  label: `Snímka ${i + 1}`,
                }))}
                onChange={(value) => {
                  const map = { ...hotspot.animation?.mouthShapes };
                  if (value === '') delete map[shape];
                  else map[shape] = Number(value);
                  onHotspot({
                    ...hotspot,
                    animation: { ...hotspot.animation, mouthShapes: map },
                  });
                }}
              />
            ))}
          </>
        )}
      </details>
    </>
  );
}

export function SpeechPanel({
  active,
  sceneId,
  hotspot,
  content,
  onNode,
  onAssets,
}: {
  active: boolean;
  sceneId: string;
  hotspot: Hotspot;
  content: GameContent;
  onNode: (dialogueId: string, node: DialogueNode) => void;
  onAssets: (assets: string[]) => void;
}) {
  const entries = content.dialogues.flatMap((d) =>
    d.nodes.map((n) => ({
      id: JSON.stringify([d.id, n.id]),
      label: `${d.id} · ${n.speaker}: ${n.text.slice(0, 45)}`,
      dialogue: d.id,
      node: n,
    })),
  );
  const initial =
    entries.find(
      (e) =>
        e.node.actor?.sceneId === sceneId &&
        e.node.actor.hotspotId === hotspot.id,
    ) ??
    entries.find((e) => e.dialogue === hotspot.animation?.dialogueId) ??
    entries[0];
  const [selected, setSelected] = useState(initial?.id ?? ''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [status, setStatus] = useState<{ elevenLabs: boolean; rhubarb: boolean }>();
  const entry = entries.find((e) => e.id === selected) ?? entries[0],
    node = entry?.node;
  const latest = useRef({ onNode, onAssets });
  useEffect(() => {
    latest.current = { onNode, onAssets };
  }, [onNode, onAssets]);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    void getSpeechStatus()
      .then((s) => {
        if (mounted.current) setStatus(s);
      })
      .catch(() => {
        if (mounted.current) setMessage('Stav služieb sa nepodarilo načítať.');
      });
    return () => {
      mounted.current = false;
    };
  }, []);
  const resolved = useMemo(
    () =>
      node?.speech
        ? {
            ...node,
            speech: {
              ...node.speech,
              audio: assetUrl(node.speech.audio),
              lipSync: node.speech.lipSync
                ? assetUrl(node.speech.lipSync)
                : undefined,
            },
          }
        : node,
    [node],
  );
  const [previewPaused, setPreviewPaused] = useState(false);
  const audio = useDialogueAudio(
    resolved,
    hotspot.animation,
    previewPaused,
    active,
    false,
  );
  async function run(kind: 'generate' | 'upload' | 'analyze', file?: File) {
    if (!node || !entry) return;
    setBusy(true);
    setMessage(
      kind === 'analyze' ? 'Rhubarb analyzuje zvuk…' : 'Pripravujem dabing…',
    );
    try {
      const result =
        kind === 'analyze'
          ? await analyzeSpeech(node.speech!.audio)
          : kind === 'upload'
            ? await uploadSpeech(node.text, file!)
            : await generateSpeech(node.text, hotspot.animation!.voice!);
      if (!mounted.current) return;
      latest.current.onAssets(result.assets);
      latest.current.onNode(entry.dialogue, {
        ...node,
        actor: { sceneId, hotspotId: hotspot.id },
        speech:
          'audio' in result
            ? { audio: result.audio, text: result.text }
            : { ...node.speech!, lipSync: result.lipSync },
      });
      setConfirmed(false);
      setMessage(
        'Hotovo. Náhľad používa uložený asset. Uložiť do projektu zapíše väzbu do JSON.',
      );
    } catch (e) {
      if (mounted.current)
        setMessage(e instanceof Error ? e.message : 'Spracovanie zlyhalo.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="speech-studio">
      <div className="speech-preview-pane">
        {audio.controls}
        <div className="speech-character-preview">
          <CombinedPreview
            active={active}
            hotspot={hotspot}
            clips={content.animations ?? []}
            speechPlayback={audio.clock}
            onPlaybackChange={(playing) => setPreviewPaused(!playing)}
          />
        </div>
      </div>
      <div className="speech-authoring-column">
        <fieldset disabled={busy}>
          <SelectId
            label="Dabovaná replika"
            value={entry?.id ?? ''}
            values={entries}
            onChange={(id) => {
              setSelected(id);
              setMessage('');
              setConfirmed(false);
            }}
          />
          {node && (
            <>
              <Field label="Text dabovanej repliky">
                <textarea
                  value={node.text}
                  onChange={(e) =>
                    onNode(entry!.dialogue, { ...node, text: e.target.value })
                  }
                />
              </Field>
              <p className="field-note">
                {node.text.length} znakov. Hlas nastav vľavo v Hlas ElevenLabs.{' '}
                {status &&
                  `ElevenLabs: ${status.elevenLabs ? 'pripravené' : 'chýba kľúč'} · Rhubarb: ${status.rhubarb ? 'pripravený' : 'chýba RHUBARB_BIN'}`}
              </p>
              {node.speech && node.speech.text !== node.text && (
                <p role="alert">
                  Text sa zmenil. Vytvor alebo nahraj nový dabing; hra zatiaľ
                  použije text bez starého audia.
                </p>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                Potvrdzujem platené generovanie tejto repliky
              </label>
              <div className="row-actions">
                <button
                  disabled={
                    !confirmed ||
                    !hotspot.animation?.voice ||
                    !node.text.trim() ||
                    status?.elevenLabs === false
                  }
                  onClick={() => void run('generate')}
                >
                  Vygenerovať dabing ElevenLabs
                </button>
                <label className="upload-button">
                  Nahrať WAV
                  <input
                    aria-label="Nahrať dabing WAV"
                    type="file"
                    accept=".wav,audio/wav"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void run('upload', f);
                      e.target.value = '';
                    }}
                  />
                </label>
                <button
                  disabled={
                    !node.speech ||
                    node.speech.text !== node.text ||
                    status?.rhubarb === false
                  }
                  onClick={() => void run('analyze')}
                >
                  Analyzovať Rhubarb
                </button>
                <button
                  onClick={() =>
                    onNode(entry!.dialogue, {
                      ...node,
                      actor: { sceneId, hotspotId: hotspot.id },
                    })
                  }
                >
                  Priradiť hovoriacu postavu
                </button>
                <button
                  disabled={!node.speech}
                  onClick={() =>
                    onNode(entry!.dialogue, { ...node, speech: undefined })
                  }
                >
                  Odpojiť dabing
                </button>
              </div>
              {node.speech && (
                <p className="field-note">
                  {node.speech.audio}
                  <br />
                  {node.speech.lipSync ??
                    'Časovanie úst ešte nie je vytvorené.'}
                </p>
              )}
            </>
          )}
        </fieldset>
        <p role="status" aria-label="Stav dabingu">
          {message}
        </p>
      </div>
    </div>
  );
}

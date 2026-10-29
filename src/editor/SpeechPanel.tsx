import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  DialogueNode,
  GameContent,
  Hotspot,
  VoiceSettings,
} from '../game/types';
import {
  defaultVoice,
  modelFeatures,
  mouthShapes,
  suggestedModels,
} from '../game/speech';
import { assetUrl } from '../game/assets';
import { useDialogueAudio } from '../ui/DialogueAudio';
import { CombinedPreview } from './CharacterPreview';
import { Field, SelectId } from './fields';
import { SubtitleEditor } from './SubtitleEditor';
import { VoiceDesignPanel } from './VoiceDesignPanel';
import {
  analyzeSpeech,
  generateSpeech,
  getSpeechCatalog,
  getSpeechStatus,
  retireVoiceDesign,
  uploadSpeech,
} from './api';
import type { SpeechCatalog } from './api';

export function VoicePanel({
  sceneId,
  hotspot,
  content,
  onHotspot,
}: {
  sceneId: string;
  hotspot: Hotspot;
  content: GameContent;
  onHotspot: (h: Hotspot) => void;
}) {
  const [catalog, setCatalog] = useState<SpeechCatalog>(),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const retiring = useRef(false);
  const latest = useRef({ hotspot, onHotspot });
  useEffect(() => {
    latest.current = { hotspot, onHotspot };
  }, [hotspot, onHotspot]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const voice: VoiceSettings = hotspot.animation?.voice ?? defaultVoice;
  const assignedVoices = content.scenes.flatMap((scene) =>
    scene.hotspots.flatMap((actor) =>
      actor.animation?.voice ? [actor.animation.voice] : [],
    ),
  );
  const fixedCount = new Set(
    assignedVoices.filter((v) => v.slot === 'static').map((v) => v.voiceId),
  ).size;
  const rotatingCount = new Set(
    assignedVoices
      .filter((v) => v.slot === 'rotating' && !v.retired)
      .map((v) => v.voiceId),
  ).size;
  const model = catalog?.models.find((m) => m.id === voice.modelId);
  const features = modelFeatures(voice.modelId);
  const models = catalog?.models ?? suggestedModels;
  const selectModel = (id: string) =>
    update({
      ...voice,
      modelId: id,
      stability: modelFeatures(id).discreteStability
        ? Math.round(voice.stability * 2) / 2
        : voice.stability,
    });
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
      <VoiceDesignPanel
        key={hotspot.id}
        characterName={hotspot.label}
        onVoice={(registration) =>
          update({
            ...voice,
            voiceId: registration.voiceId,
            designRegistration: registration.manifest,
            designPrompt: undefined,
            slot: voice.slot ?? 'rotating',
            retired: undefined,
            retirementManifest: undefined,
          })
        }
      />
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
                    ? 'Zobrazených prvních 100 hlasů. Další hlas zadej přes ID.'
                    : 'Hlasy načtené.',
                );
              }
            } catch (e) {
              if (mounted.current)
                setMessage(
                  e instanceof Error ? e.message : 'Načítání selhalo.',
                );
            } finally {
              if (mounted.current) setBusy(false);
            }
          }}
        >
          Načíst hlasy a modely
        </button>
        <Field label="ElevenLabs Voice ID">
          <input
            list="eleven-voices"
            value={voice.voiceId}
            onChange={(e) =>
              update({
                ...voice,
                voiceId: e.target.value,
                designRegistration: undefined,
                designPrompt: undefined,
                retired: undefined,
                retirementManifest: undefined,
              })
            }
          />
        </Field>
        <Field label="Správa hlasového slotu">
          <select
            value={voice.slot ?? ''}
            disabled={
              busy ||
              !voice.voiceId ||
              voice.retired === true ||
              voice.slot === 'static'
            }
            onChange={(e) =>
              update({
                ...voice,
                slot: (e.target.value || undefined) as VoiceSettings['slot'],
              })
            }
          >
            <option value="">Bez správy slotu</option>
            <option
              value="static"
              disabled={voice.slot !== 'static' && fixedCount >= 8}
            >
              Stálý hlas · chráněný před smazáním
            </option>
            <option
              value="rotating"
              disabled={voice.slot !== 'rotating' && rotatingCount >= 2}
            >
              Rotační hlas · po ověření uvolnit
            </option>
          </select>
        </Field>
        <p className="field-note">
          Stálé hlasy {fixedCount}/8 · obsazené rotační sloty {rotatingCount}/2.
        </p>
        <Field label="Zadání pro obnovu Voice Design">
          <textarea
            value={voice.designPrompt ?? ''}
            minLength={20}
            maxLength={1000}
            onChange={(e) =>
              update({
                ...voice,
                designPrompt: e.target.value || undefined,
              })
            }
          />
        </Field>
        <p className="field-note">
          Volitelné zadání pro příští obnovu uvolněného hlasu. Samotná úprava
          hlas nevytváří; změna aktivního hlasu vyžaduje nový Voice Design.
        </p>
        {voice.slot === 'static' && (
          <p className="field-note">
            Stálý hlas nelze přes správu rotace smazat.
          </p>
        )}
        {voice.retired && (
          <p role="status">
            Hlas byl uvolněn z účtu. Místní WAV, titulky a lip-sync zůstávají
            funkční. Pro nové repliky nejprve vytvoř nový hlas přes Voice
            Design.
          </p>
        )}
        {voice.slot === 'rotating' &&
          voice.designRegistration &&
          !voice.retired && (
            <>
              <p className="field-note">
                Nejprve ulož projekt. Uvolnění ověří všechny hrané repliky,
                původ WAV, titulky a lip-sync; poté smaže pouze tento rotační
                hlas z ElevenLabs.
              </p>
              <button
                disabled={busy}
                onClick={async () => {
                  if (retiring.current) return;
                  retiring.current = true;
                  setBusy(true);
                  setMessage('Ověřuji uložené repliky před uvolněním hlasu…');
                  try {
                    const result = await retireVoiceDesign({
                      sceneId,
                      hotspotId: hotspot.id,
                      expectedVoice: voice,
                    });
                    if (!mounted.current) return;
                    const current = latest.current.hotspot;
                    if (current.animation?.voice?.voiceId !== result.voiceId)
                      return;
                    latest.current.onHotspot({
                      ...current,
                      animation: {
                        ...current.animation,
                        voice: {
                          ...current.animation.voice,
                          retired: true,
                          retirementManifest: result.manifest,
                        },
                      },
                    });
                    setMessage(
                      `Ověřeno ${result.verifiedLines} replik. Hlas je uvolněný; ulož evidenci do projektu.`,
                    );
                  } catch (error) {
                    if (mounted.current)
                      setMessage(
                        error instanceof Error
                          ? error.message
                          : 'Uvolnění hlasu selhalo.',
                      );
                  } finally {
                    retiring.current = false;
                    if (mounted.current) setBusy(false);
                  }
                }}
              >
                Ověřit dabing a uvolnit rotační hlas (smaže z účtu)
              </button>
            </>
          )}
        <datalist id="eleven-voices">
          {catalog?.voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </datalist>
        <Field label="Model ElevenLabs">
          <select
            value={voice.modelId}
            disabled={!voice.voiceId}
            onChange={(e) => selectModel(e.target.value)}
          >
            {!models.some((m) => m.id === voice.modelId) && (
              <option value={voice.modelId}>
                {voice.modelId} (vlastní ID)
              </option>
            )}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {modelFeatures(m.id).audioTags ? ' · audio tagy' : ''}
              </option>
            ))}
          </select>
        </Field>
        <p className="field-note">
          {catalog
            ? 'Modely načtené z API.'
            : 'Předvolby; dostupnost ověří API při generování.'}{' '}
          {features.audioTags
            ? 'Podporuje [laughs], [crying], [whispers].'
            : 'Podpora emočních audio tagů není potvrzená; pro tagy vyber Eleven v3 nebo v4.'}
        </p>
        <Field label="ElevenLabs Model ID">
          <input
            value={voice.modelId}
            disabled={!voice.voiceId}
            onChange={(e) => selectModel(e.target.value)}
          />
        </Field>
        {model?.maxCharacters && (
          <p className="field-note">
            Limit modelu: {model.maxCharacters} znaků (editor nejvýše 5000).
          </p>
        )}
        {model && !model.languages.includes('sk') && (
          <p className="field-note">
            Model neuvádí slovenštinu. Vyber model s podporou sk.
          </p>
        )}
        {(['stability', 'similarityBoost', 'style', 'speed'] as const).map(
          (key) => (
            <Field
              key={key}
              label={
                {
                  stability: 'Stabilita hlasu',
                  similarityBoost: 'Podobnost hlasu',
                  style: 'Výraznost projevu',
                  speed: 'Rychlost řeči',
                }[key]
              }
            >
              <input
                type="number"
                min={key === 'speed' ? 0.7 : 0}
                max={key === 'speed' ? 1.2 : 1}
                step={
                  features.discreteStability && key === 'stability' ? 0.5 : 0.05
                }
                disabled={
                  !voice.voiceId ||
                  (key === 'speed' && !(model?.speed ?? features.speed)) ||
                  (key === 'style' &&
                    (model ? !model.style : features.expressive))
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
              (model ? !model.speakerBoost : features.expressive)
            }
            checked={voice.useSpeakerBoost}
            onChange={(e) =>
              update({ ...voice, useSpeakerBoost: e.target.checked })
            }
          />
          Zvýraznění podobnosti hlasu
        </label>
        <p className="field-note">
          Klient nepozná API klíč. Generování se spouští pouze ručně v záložce
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
          <p>Nejprve přiřaď lokální klip Mluvení.</p>
        ) : (
          <>
            <p className="field-note">
              Přiřaď aspoň klid X a otevřené ústa C. Bez mapování se přehrává
              běžná smyčka. Čísla jsou snímky přiřazeného klipu. X = klid, A =
              zavřené, B = zuby, C/D = otevřené, E/F = zaoblené, G = F/V, H = L.
              Chybějící otevřené tvary použijí C → B → X → první snímek; A
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
                  label: `Snímek ${i + 1}`,
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
        if (mounted.current) setMessage('Stav služeb se nepodařilo načíst.');
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
              alignment: node.speech.alignment
                ? assetUrl(node.speech.alignment)
                : undefined,
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
    `${entry?.dialogue}/${node?.id}`,
  );
  async function run(kind: 'generate' | 'upload' | 'analyze', file?: File) {
    if (!node || !entry) return;
    setBusy(true);
    setMessage(
      kind === 'analyze' ? 'Rhubarb analyzuje zvuk…' : 'Připravuji dabing…',
    );
    try {
      const result =
        kind === 'analyze'
          ? await analyzeSpeech(node.speech!.audio)
          : kind === 'upload'
            ? await uploadSpeech(node.text, file!, node.subtitle)
            : await generateSpeech(
                node.text,
                hotspot.animation!.voice!,
                node.subtitle,
              );
      if (!mounted.current) return;
      latest.current.onAssets(result.assets);
      latest.current.onNode(entry.dialogue, {
        ...node,
        actor: { sceneId, hotspotId: hotspot.id },
        speech:
          'audio' in result
            ? {
                audio: result.audio,
                text: result.text,
                alignment: result.alignment,
                subtitles: result.subtitles,
              }
            : { ...node.speech!, lipSync: result.lipSync },
      });
      setConfirmed(false);
      setMessage(
        'Hotovo. Náhled používá uložený asset. Uložit do projektu zapíše vazbu do JSON.',
      );
    } catch (e) {
      if (mounted.current)
        setMessage(e instanceof Error ? e.message : 'Zpracování selhalo.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="speech-studio">
      <div className="speech-preview-pane">
        {audio.controls}
        <div
          className="speech-caption"
          role="status"
          aria-label="Náhled titulků"
        >
          {audio.subtitle || '\u00a0'}
        </div>
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
              <Field label="Text dabované repliky">
                <textarea
                  value={node.text}
                  onChange={(e) =>
                    onNode(entry!.dialogue, { ...node, text: e.target.value })
                  }
                />
              </Field>
              <p className="field-note">
                Text dabingu může obsahovat audio tagy, např. [laughs] nebo
                [whispers], pokud je vybraný model podporuje. Hra je automaticky
                skryje v titulcích.
              </p>
              <p className="field-note">
                {node.text.length} znaků. Hlas nastav vlevo v Hlas ElevenLabs.{' '}
                {status &&
                  `ElevenLabs: ${status.elevenLabs ? 'připravené' : 'chybí klíč'} · Rhubarb: ${status.rhubarb ? 'připravený' : 'chybí RHUBARB_BIN'}`}
              </p>
              {node.speech && node.speech.text !== node.text && (
                <p role="alert">
                  Text se změnil. Vytvoř nebo nahraj nový dabing; hra zatím
                  použije text bez starého audia.
                </p>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                Potvrzuji placené generování této repliky
              </label>
              <div className="row-actions">
                <button
                  disabled={
                    !confirmed ||
                    !hotspot.animation?.voice ||
                    hotspot.animation.voice.retired === true ||
                    !node.text.trim() ||
                    status?.elevenLabs === false
                  }
                  onClick={() => void run('generate')}
                >
                  Vygenerovat dabing ElevenLabs
                </button>
                <label className="upload-button">
                  Nahrát WAV
                  <input
                    aria-label="Nahrát dabing WAV"
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
                  Analyzovat Rhubarb
                </button>
                <button
                  onClick={() =>
                    onNode(entry!.dialogue, {
                      ...node,
                      actor: { sceneId, hotspotId: hotspot.id },
                    })
                  }
                >
                  Přiřadit mluvící postavu
                </button>
                <button
                  disabled={!node.speech}
                  onClick={() =>
                    onNode(entry!.dialogue, { ...node, speech: undefined })
                  }
                >
                  Odpojit dabing
                </button>
              </div>
              {node.speech && (
                <p className="field-note">
                  {node.speech.audio}
                  <br />
                  {node.speech.lipSync ?? 'Časování úst ještě není vytvořené.'}
                </p>
              )}
              <SubtitleEditor
                node={node}
                track={audio.subtitleTrack}
                automatic={audio.automaticSubtitles}
                duration={audio.duration}
                caption={audio.subtitle}
                onSeek={audio.seek}
                onChange={(next) => onNode(entry!.dialogue, next)}
              />
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

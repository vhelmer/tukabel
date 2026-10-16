import { useRef } from 'react';
import type { DialogueNode, SubtitleCue, SubtitleTrack } from '../game/types';
import {
  splitSubtitle,
  stripAudioTags,
  subtitleText,
  subtitleTrackIssue,
} from '../game/subtitles';
import { Field } from './fields';

export function SubtitleTextField({
  node,
  onChange,
}: {
  node: DialogueNode;
  onChange: (node: DialogueNode) => void;
}) {
  return (
    <>
      <Field label="Vlastný text titulkov (voliteľné)">
        <textarea
          value={node.subtitle ?? ''}
          placeholder={stripAudioTags(node.text)}
          onChange={(e) =>
            onChange({ ...node, subtitle: e.target.value || undefined })
          }
        />
      </Field>
      <p className="field-note">
        Prázdne pole použije repliku bez hranatých zátvoriek. Text dabingu a
        jeho audio sa úpravou titulkov nemenia.
      </p>
    </>
  );
}

export function SubtitleEditor({
  node,
  track,
  automatic,
  duration,
  caption,
  onChange,
  onSeek,
}: {
  node: DialogueNode;
  track: SubtitleTrack;
  automatic: SubtitleTrack;
  duration: number;
  caption: string;
  onChange: (node: DialogueNode) => void;
  onSeek: (seconds: number) => void;
}) {
  const caret = useRef<{ index: number; position: number } | undefined>(
    undefined,
  );
  const current = node.speech?.text === node.text;
  const update = (cues: readonly SubtitleCue[]) => {
    if (!node.speech) return;
    onChange({
      ...node,
      speech: {
        ...node.speech,
        subtitles: { text: subtitleText(node), timing: 'manual', cues },
      },
    });
  };
  const issue = subtitleTrackIssue(track, duration || 180);
  return (
    <section className="subtitle-editor" aria-label="Editor titulkov">
      <h3>Titulky</h3>
      <SubtitleTextField node={node} onChange={onChange} />
      {current && (
        <>
          <p
            className="field-note"
            role="status"
            aria-label="Časovanie titulkov"
          >
            {track.timing === 'alignment'
              ? 'Časovanie podľa ElevenLabs.'
              : track.timing === 'manual'
                ? 'Ručne upravené časovanie.'
                : 'Odhad podľa dĺžky textu. Pri WAV alebo prepísanom preklade uprav časy podľa posluchu.'}{' '}
            Časy sú v sekundách. Zmeny uloží Uložiť do projektu.
          </p>
          <button
            disabled={!duration}
            onClick={() =>
              onChange({
                ...node,
                speech: { ...node.speech!, subtitles: automatic },
              })
            }
          >
            Obnoviť automatické titulky
          </button>
          {issue && (
            <p role="alert">
              Úseky sa nesmú prekrývať a musia byť v rozsahu audia (0–
              {duration.toFixed(2)} s).
            </p>
          )}
          <ol className="subtitle-cues">
            {track.cues.map((cue, index) => (
              <li
                key={index}
                className={cue.text === caption ? 'is-current' : ''}
              >
                <div className="subtitle-cue-times">
                  {(['start', 'end'] as const).map((key) => (
                    <Field
                      key={key}
                      label={`${key === 'start' ? 'Začiatok' : 'Koniec'} titulku ${index + 1}`}
                    >
                      <input
                        type="number"
                        min="0"
                        max={duration || 180}
                        step="0.05"
                        value={Number(cue[key].toFixed(3))}
                        onChange={(e) =>
                          update(
                            track.cues.map((c, i) =>
                              i === index
                                ? { ...c, [key]: Number(e.target.value) }
                                : c,
                            ),
                          )
                        }
                      />
                    </Field>
                  ))}
                </div>
                <Field label={`Text titulku ${index + 1}`}>
                  <textarea
                    value={cue.text}
                    onSelect={(e) => {
                      caret.current = {
                        index,
                        position: e.currentTarget.selectionStart,
                      };
                    }}
                    onChange={(e) =>
                      update(
                        track.cues.map((c, i) =>
                          i === index ? { ...c, text: e.target.value } : c,
                        ),
                      )
                    }
                  />
                </Field>
                <div className="row-actions">
                  <button
                    disabled={!duration}
                    onClick={() => onSeek(cue.start)}
                  >
                    Náhľad úseku {index + 1}
                  </button>
                  <button
                    disabled={!cue.text.trim().includes(' ')}
                    onClick={() =>
                      update(
                        track.cues.flatMap((c, i) =>
                          i === index
                            ? splitSubtitle(
                                c,
                                caret.current?.index === index
                                  ? caret.current.position
                                  : undefined,
                              )
                            : [c],
                        ),
                      )
                    }
                  >
                    Rozdeliť úsek {index + 1}
                  </button>
                  <button
                    disabled={index === track.cues.length - 1}
                    onClick={() =>
                      update(
                        track.cues.flatMap((c, i) =>
                          i === index
                            ? [
                                {
                                  start: c.start,
                                  end: track.cues[i + 1]!.end,
                                  text: `${c.text} ${track.cues[i + 1]!.text}`,
                                },
                              ]
                            : i === index + 1
                              ? []
                              : [c],
                        ),
                      )
                    }
                  >
                    Zlúčiť úsek {index + 1} s ďalším
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

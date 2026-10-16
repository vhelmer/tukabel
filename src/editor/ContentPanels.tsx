import { useState } from 'react';
import type {
  DialogueDefinition,
  DialogueNode,
  GameContent,
} from '../game/types';
import {
  AssetField,
  ConditionField,
  EffectsField,
  Field,
  RulesField,
  SelectId,
} from './fields';
import { nextId, replaceAt } from './model';
import { SubtitleTextField } from './SubtitleEditor';

interface Props {
  content: GameContent;
  onChange: (content: GameContent) => void;
}
export function ItemsPanel({
  content,
  onChange,
  assets,
  onAssets,
}: Props & { assets: readonly string[]; onAssets: (ids: string[]) => void }) {
  const [selected, setSelected] = useState(content.items[0]?.id ?? '');
  const item =
    content.items.find((entry) => entry.id === selected) ?? content.items[0];
  return (
    <section className="content-panel">
      <h2>Predmety inventára</h2>
      <div className="field-row">
        <SelectId
          label="Predmet"
          value={item?.id ?? ''}
          values={content.items}
          onChange={setSelected}
        />
        <button
          onClick={() => {
            const id = nextId(
              'item',
              content.items.map((entry) => entry.id),
            );
            onChange({
              ...content,
              items: [
                ...content.items,
                {
                  id,
                  label: 'Nový predmet',
                  description: 'Popis predmetu.',
                  icon: '◈',
                },
              ],
            });
            setSelected(id);
          }}
        >
          + Predmet
        </button>
      </div>
      {item && (
        <div key={item.id} className="editor-card">
          <p className="field-note">Stále ID: {item.id}</p>
          <Field label="Názov predmetu">
            <input
              value={item.label}
              onChange={(event) =>
                onChange({
                  ...content,
                  items: content.items.map((entry) =>
                    entry.id === item.id
                      ? { ...item, label: event.target.value }
                      : entry,
                  ),
                })
              }
            />
          </Field>
          <Field label="Popis predmetu">
            <textarea
              value={item.description}
              onChange={(event) =>
                onChange({
                  ...content,
                  items: content.items.map((entry) =>
                    entry.id === item.id
                      ? { ...item, description: event.target.value }
                      : entry,
                  ),
                })
              }
            />
          </Field>
          <Field label="Symbol predmetu">
            <input
              value={item.icon}
              onChange={(event) =>
                onChange({
                  ...content,
                  items: content.items.map((entry) =>
                    entry.id === item.id
                      ? { ...item, icon: event.target.value }
                      : entry,
                  ),
                })
              }
            />
          </Field>
          <AssetField
            label="Inventárová ikonka"
            optional
            value={item.image ?? ''}
            assets={assets}
            onAssets={onAssets}
            onChange={(image) =>
              onChange({
                ...content,
                items: content.items.map((entry) =>
                  entry.id === item.id
                    ? { ...item, image: image || undefined }
                    : entry,
                ),
              })
            }
          />
          <button
            className="danger-button"
            onClick={() =>
              onChange({
                ...content,
                items: content.items.filter((entry) => entry.id !== item.id),
              })
            }
          >
            Odstrániť predmet
          </button>
        </div>
      )}
      <p className="field-note">
        Predmety sa pridávajú a odoberajú efektmi interakcií. Obrázok je
        voliteľný; bez neho sa zobrazí symbol.
      </p>
    </section>
  );
}

export function DialoguesPanel({
  content,
  onChange,
  selectedDialogue,
  onSelectDialogue,
  initialNodeId = '',
  assets,
  onAssets,
}: Props & {
  initialNodeId?: string;
  assets: readonly string[];
  onAssets: (ids: string[]) => void;
  selectedDialogue: string;
  onSelectDialogue: (id: string) => void;
}) {
  const [nodeId, setNodeId] = useState(initialNodeId);
  const dialogue =
    content.dialogues.find((entry) => entry.id === selectedDialogue) ??
    content.dialogues[0];
  const node =
    dialogue?.nodes.find((entry) => entry.id === nodeId) ?? dialogue?.nodes[0];
  const updateDialogue = (next: DialogueDefinition) =>
    onChange({
      ...content,
      dialogues: content.dialogues.map((entry) =>
        entry.id === next.id ? next : entry,
      ),
    });
  const updateNode = (next: DialogueNode) => {
    if (dialogue)
      updateDialogue({
        ...dialogue,
        nodes: dialogue.nodes.map((entry) =>
          entry.id === next.id ? next : entry,
        ),
      });
  };
  return (
    <section className="content-panel">
      <h2>Dialógy a odpovede</h2>
      <div className="field-row">
        <SelectId
          label="Dialóg"
          value={dialogue?.id ?? ''}
          values={content.dialogues}
          onChange={(id) => {
            onSelectDialogue(id);
            setNodeId('');
          }}
        />
        <button
          onClick={() => {
            const id = nextId(
              'dialogue',
              content.dialogues.map((entry) => entry.id),
            );
            onChange({
              ...content,
              dialogues: [
                ...content.dialogues,
                {
                  id,
                  start: 'start',
                  nodes: [
                    {
                      id: 'start',
                      speaker: 'Postava',
                      text: 'Nový rozhovor.',
                      choices: [{ id: 'leave', text: 'Dovidenia.' }],
                    },
                  ],
                },
              ],
            });
            onSelectDialogue(id);
            setNodeId('');
          }}
        >
          + Dialóg
        </button>
      </div>
      {dialogue && (
        <>
          <SelectId
            label="Začiatočný uzol"
            value={dialogue.start}
            values={dialogue.nodes}
            onChange={(start) => updateDialogue({ ...dialogue, start })}
          />
          <div className="field-row">
            <SelectId
              label="Uzol dialógu"
              value={node?.id ?? ''}
              values={dialogue.nodes}
              onChange={setNodeId}
            />
            <button
              onClick={() => {
                const id = nextId(
                  'node',
                  dialogue.nodes.map((entry) => entry.id),
                );
                updateDialogue({
                  ...dialogue,
                  nodes: [
                    ...dialogue.nodes,
                    {
                      id,
                      speaker: node?.speaker ?? 'Postava',
                      text: 'Nová replika.',
                      choices: [{ id: 'leave', text: 'Dovidenia.' }],
                    },
                  ],
                });
                setNodeId(id);
              }}
            >
              + Uzol
            </button>
          </div>
          {node && (
            <div className="editor-card" key={`${dialogue.id}/${node.id}`}>
              <Field label="Hovoriaca postava">
                <input
                  value={node.speaker}
                  onChange={(event) =>
                    updateNode({ ...node, speaker: event.target.value })
                  }
                />
              </Field>
              <AssetField
                label="Portrét hovoriacej postavy"
                value={node.portrait ?? ''}
                optional
                assets={assets}
                onAssets={onAssets}
                onChange={(portrait) =>
                  updateNode({ ...node, portrait: portrait || undefined })
                }
              />
              <Field label="Replika">
                <textarea
                  value={node.text}
                  onChange={(event) =>
                    updateNode({ ...node, text: event.target.value })
                  }
                />
              </Field>
              <SubtitleTextField node={node} onChange={updateNode} />
              {node.speech && (
                <p className="field-note">
                  Dabing:{' '}
                  {node.speech.text === node.text
                    ? 'aktuálny'
                    : 'text sa zmenil – nahrávka je zastaralá'}
                  . Správa hlasu, zvuku a lip-syncu je v Animácie → Dabing a
                  lip-sync.
                </p>
              )}
              <h3>Možnosti odpovede</h3>
              {node.choices.map((choice, index) => (
                <details key={choice.id} className="choice-card" open>
                  <summary>
                    {index + 1}. {choice.text}
                  </summary>
                  <Field label="Text odpovede">
                    <input
                      value={choice.text}
                      onChange={(event) =>
                        updateNode({
                          ...node,
                          choices: replaceAt(node.choices, index, {
                            ...choice,
                            text: event.target.value,
                          }),
                        })
                      }
                    />
                  </Field>
                  <SelectId
                    label="Ďalší uzol"
                    value={choice.next ?? ''}
                    values={dialogue.nodes}
                    empty="Ukončiť rozhovor"
                    onChange={(next) =>
                      updateNode({
                        ...node,
                        choices: replaceAt(node.choices, index, {
                          ...choice,
                          next: next || undefined,
                        }),
                      })
                    }
                  />
                  <Field label="Správa po odpovedi">
                    <input
                      value={choice.message ?? ''}
                      onChange={(event) =>
                        updateNode({
                          ...node,
                          choices: replaceAt(node.choices, index, {
                            ...choice,
                            message: event.target.value || undefined,
                          }),
                        })
                      }
                    />
                  </Field>
                  <ConditionField
                    content={content}
                    value={choice.when}
                    onChange={(when) =>
                      updateNode({
                        ...node,
                        choices: replaceAt(node.choices, index, {
                          ...choice,
                          when,
                        }),
                      })
                    }
                  />
                  <EffectsField
                    content={content}
                    value={choice.effects}
                    onChange={(effects) =>
                      updateNode({
                        ...node,
                        choices: replaceAt(node.choices, index, {
                          ...choice,
                          effects,
                        }),
                      })
                    }
                  />
                  <button
                    onClick={() =>
                      updateNode({
                        ...node,
                        choices: node.choices.filter(
                          (entry) => entry.id !== choice.id,
                        ),
                      })
                    }
                  >
                    Odstrániť odpoveď
                  </button>
                </details>
              ))}
              <button
                onClick={() =>
                  updateNode({
                    ...node,
                    choices: [
                      ...node.choices,
                      {
                        id: nextId(
                          'choice',
                          node.choices.map((entry) => entry.id),
                        ),
                        text: 'Nová odpoveď.',
                      },
                    ],
                  })
                }
              >
                + Odpoveď
              </button>
              <button
                className="danger-button"
                onClick={() =>
                  updateDialogue({
                    ...dialogue,
                    nodes: dialogue.nodes.filter(
                      (entry) => entry.id !== node.id,
                    ),
                  })
                }
              >
                Odstrániť uzol
              </button>
            </div>
          )}
          <button
            className="danger-button"
            onClick={() =>
              onChange({
                ...content,
                dialogues: content.dialogues.filter(
                  (entry) => entry.id !== dialogue.id,
                ),
              })
            }
          >
            Odstrániť dialóg
          </button>
          <p className="field-note">
            Odpoveď bez ďalšieho uzla ukončí rozhovor. Na postave otvor dialóg
            efektom „Otvoriť dialóg“.
          </p>
        </>
      )}
    </section>
  );
}

export function PuzzlesPanel({ content, onChange }: Props) {
  const [newFlag, setNewFlag] = useState('');
  return (
    <section className="content-panel">
      <h2>Herný projekt a hádanky</h2>
      <Field label="Verzia obsahu">
        <input
          value={content.id}
          onChange={(event) => onChange({ ...content, id: event.target.value })}
        />
      </Field>
      <SelectId
        label="Úvodná lokácia"
        value={content.startScene}
        values={content.scenes.map((scene) => ({
          id: scene.id,
          label: scene.title,
        }))}
        onChange={(startScene) => onChange({ ...content, startScene })}
      />
      <Field label="Úvodná správa">
        <textarea
          value={content.initialMessage}
          onChange={(event) =>
            onChange({ ...content, initialMessage: event.target.value })
          }
        />
      </Field>
      <h3>Príznaky postupu</h3>
      <p className="field-note">
        Nepomenované / nenastavené príznaky sú false. Použi ich v podmienkach a
        nastavuj efektmi.
      </p>
      <div className="flag-list">
        {content.flags.map((id) => (
          <span key={id}>
            {id}
            <button
              aria-label={`Odstrániť príznak ${id}`}
              onClick={() =>
                onChange({
                  ...content,
                  flags: content.flags.filter((entry) => entry !== id),
                })
              }
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="field-row">
        <Field label="Nový príznak">
          <input
            value={newFlag}
            onChange={(event) => setNewFlag(event.target.value)}
            placeholder="napr. doorOpen"
          />
        </Field>
        <button
          disabled={
            !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(newFlag) ||
            content.flags.includes(newFlag)
          }
          onClick={() => {
            onChange({ ...content, flags: [...content.flags, newFlag] });
            setNewFlag('');
          }}
        >
          + Príznak
        </button>
      </div>
      <h3>Kombinácie predmetov</h3>
      {content.combinations.map((entry, index) => (
        <div className="editor-card" key={index}>
          <div className="field-row">
            <SelectId
              label="Prvý predmet"
              value={entry.items[0]}
              values={content.items}
              onChange={(id) =>
                onChange({
                  ...content,
                  combinations: replaceAt(content.combinations, index, {
                    ...entry,
                    items: [id, entry.items[1]],
                  }),
                })
              }
            />
            <SelectId
              label="Druhý predmet"
              value={entry.items[1]}
              values={content.items}
              onChange={(id) =>
                onChange({
                  ...content,
                  combinations: replaceAt(content.combinations, index, {
                    ...entry,
                    items: [entry.items[0], id],
                  }),
                })
              }
            />
          </div>
          <RulesField
            content={content}
            value={entry.rules}
            onChange={(rules) =>
              onChange({
                ...content,
                combinations: replaceAt(content.combinations, index, {
                  ...entry,
                  rules,
                }),
              })
            }
          />
          <button
            className="danger-button"
            onClick={() =>
              onChange({
                ...content,
                combinations: content.combinations.filter(
                  (_, position) => position !== index,
                ),
              })
            }
          >
            Odstrániť kombináciu
          </button>
        </div>
      ))}
      <button
        disabled={content.items.length < 2}
        onClick={() =>
          onChange({
            ...content,
            combinations: [
              ...content.combinations,
              {
                items: [content.items[0]!.id, content.items[1]!.id],
                rules: [{ message: 'Predmety si skombinoval.' }],
              },
            ],
          })
        }
      >
        + Kombinácia
      </button>
    </section>
  );
}

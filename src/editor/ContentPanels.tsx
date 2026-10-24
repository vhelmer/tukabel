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
      <h2>Předměty inventáře</h2>
      <div className="field-row">
        <SelectId
          label="Předmět"
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
          + Předmět
        </button>
      </div>
      {item && (
        <div key={item.id} className="editor-card">
          <p className="field-note">Stále ID: {item.id}</p>
          <Field label="Název předmětu">
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
          <Field label="Popis předmětu">
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
          <Field label="Symbol předmětu">
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
            label="Inventární ikonka"
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
            Odstranit předmět
          </button>
        </div>
      )}
      <p className="field-note">
        Předměty se přidávají a odebírají efekty interakcí. Obrázek je
        volitelný; bez něj se zobrazí symbol.
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
}: Props & {
  initialNodeId?: string;
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
      <h2>Dialogy a odpovědi</h2>
      <div className="field-row">
        <SelectId
          label="Dialog"
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
          + Dialog
        </button>
      </div>
      {dialogue && (
        <>
          <SelectId
            label="Počáteční uzel"
            value={dialogue.start}
            values={dialogue.nodes}
            onChange={(start) => updateDialogue({ ...dialogue, start })}
          />
          <Field label="Začátek dialogu">
            <select
              value={dialogue.entry ?? 'choices'}
              onChange={(event) =>
                updateDialogue({
                  ...dialogue,
                  entry: event.target.value === 'speech' ? 'speech' : undefined,
                })
              }
            >
              <option value="choices">Nabídnout možnosti</option>
              <option value="speech">Přehrát úvodní repliku automaticky</option>
            </select>
          </Field>
          <p className="field-note">
            Běžný rozhovor začne možnostmi. Automatická replika se hodí pro
            reakci na předmět: v pravidle jeho použití přidej efekt „Otevřít
            dialog“ a vyber tento dialog. Bez odpovědí se po dohrání či
            přeskočení sám zavře; jinak teprve nabídne další možnosti.
          </p>
          <div className="field-row">
            <SelectId
              label="Uzel dialogu"
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
              + Uzel
            </button>
          </div>
          {node && (
            <div className="editor-card" key={`${dialogue.id}/${node.id}`}>
              <Field label="Mluvící postava">
                <input
                  value={node.speaker}
                  onChange={(event) =>
                    updateNode({ ...node, speaker: event.target.value })
                  }
                />
              </Field>
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
                    ? 'aktuální'
                    : 'text se změnil – nahrávka je zastaralá'}
                  . Zpráva hlasu, zvuku a lip-syncu je v Animace → Dabing a
                  lip-sync.
                </p>
              )}
              <h3>Možnosti odpovědi</h3>
              {node.choices.map((choice, index) => (
                <details key={choice.id} className="choice-card" open>
                  <summary>
                    {index + 1}. {choice.text}
                  </summary>
                  <Field label="Text odpovědi">
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
                    label="Další uzel"
                    value={choice.next ?? ''}
                    values={dialogue.nodes}
                    empty="Ukončit rozhovor"
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
                  <Field label="Zpráva po odpovědi">
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
                    Odstranit odpověď
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
                + Odpověď
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
                Odstranit uzel
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
            Odstranit dialog
          </button>
          <p className="field-note">
            Odpověď bez dalšího uzlu ukončí rozhovor. Na postavě otevři dialog
            efektem „Otevřít dialog“.
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
      <h2>Herní projekt a hádanky</h2>
      <Field label="Verze obsahu">
        <input
          value={content.id}
          onChange={(event) => onChange({ ...content, id: event.target.value })}
        />
      </Field>
      <SelectId
        label="Úvodní lokace"
        value={content.startScene}
        values={content.scenes.map((scene) => ({
          id: scene.id,
          label: scene.title,
        }))}
        onChange={(startScene) => onChange({ ...content, startScene })}
      />
      <Field label="Úvodní zpráva">
        <textarea
          value={content.initialMessage}
          onChange={(event) =>
            onChange({ ...content, initialMessage: event.target.value })
          }
        />
      </Field>
      <h3>Příznaky postupu</h3>
      <p className="field-note">
        Nepojmenované / nenastavené příznaky jsou false. Použij jejich v
        podmínkách a nastavuj efekty.
      </p>
      <div className="flag-list">
        {content.flags.map((id) => (
          <span key={id}>
            {id}
            <button
              aria-label={`Odstranit příznak ${id}`}
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
        <Field label="Nový příznak">
          <input
            value={newFlag}
            onChange={(event) => setNewFlag(event.target.value)}
            placeholder="např. doorOpen"
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
          + Příznak
        </button>
      </div>
      <h3>Kombinace předmětů</h3>
      {content.combinations.map((entry, index) => (
        <div className="editor-card" key={index}>
          <div className="field-row">
            <SelectId
              label="První předmět"
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
              label="Druhý předmět"
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
            Odstranit kombinaci
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
        + Kombinace
      </button>
    </section>
  );
}

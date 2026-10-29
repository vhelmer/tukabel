import { useMemo, useState } from 'react';
import type { Condition, Effect, GameContent, GameState } from '../game/types';
import { matches } from '../game/state';

export type GraphTarget =
  | { type: 'scene'; sceneId: string; hotspotId: string }
  | { type: 'dialogue'; id: string; nodeId: string }
  | { type: 'tasks'; id: string }
  | { type: 'worldMap' }
  | { type: 'puzzles' };
interface Row {
  label: string;
  when?: Condition;
  requires: string[];
  outcomes: string[];
  message: string;
  target: GraphTarget;
}
function describe(condition?: Condition): string[] {
  if (!condition) return [];
  if ('flag' in condition)
    return [`${condition.flag} = ${condition.value ?? true}`];
  if ('item' in condition) return [`V inventáři: ${condition.item}`];
  if ('not' in condition)
    return [`NE (${describe(condition.not).join(' A ')})`];
  return condition.all.flatMap(describe);
}
function effectText(effect: Effect) {
  return effect.type === 'flag'
    ? `${effect.id} ← ${effect.value}`
    : `${{ addItem: '+ předmět', removeItem: '− předmět', scene: '→ lokace', unlockScene: 'odemknout lokaci', dialogue: '→ dialog', startTask: '+ úkol', completeTask: '✓ úkol', minigame: '▶ minihra' }[effect.type]}: ${effect.id}`;
}
function graphRows(content: GameContent): Row[] {
  const rows: Row[] = [];
  for (const point of content.worldMap?.points ?? []) {
    if (!point.unlockWhen) continue;
    rows.push({
      label: 'Mapa · ' + point.label,
      when: point.unlockWhen,
      requires: describe(point.unlockWhen),
      outcomes: [
        'Odemknout lokaci: ' + point.sceneId,
        ...(point.fastTravel === false ? ['Přístup pouze přechodem'] : []),
      ],
      message: '',
      target: { type: 'worldMap' },
    });
  }
  for (const task of content.tasks ?? []) {
    for (const [when, outcome] of [
      [task.startWhen, '+ zapsat do deníku'],
      [task.completeWhen, '✓ přeškrtnout v deníku'],
    ] as const) {
      if (!when) continue;
      rows.push({
        label: 'Úkol · ' + task.text,
        when,
        requires: describe(when),
        outcomes: [outcome + ': ' + task.id],
        message: '',
        target: { type: 'tasks', id: task.id },
      });
    }
  }
  for (const scene of content.scenes)
    for (const hotspot of scene.hotspots) {
      for (const [interaction, rules] of [
        ['click', hotspot.onClick] as const,
        ...Object.entries(hotspot.uses ?? {}).map(
          ([item, rules]) => [`use:${item}`, rules] as const,
        ),
      ])
        for (const [index, rule] of rules.entries()) {
          const usedItem = interaction.startsWith('use:')
            ? interaction.slice(4)
            : null;
          const all = [
            hotspot.visibleWhen,
            rule.when,
            usedItem ? { item: usedItem } : undefined,
          ].filter((entry): entry is Condition => Boolean(entry));
          rows.push({
            label: `${scene.title} / ${hotspot.label} · ${interaction} #${index + 1}`,
            when: { all },
            requires: [`Lokace: ${scene.id}`, ...all.flatMap(describe)],
            outcomes: (rule.effects ?? []).map(effectText),
            message: rule.message ?? '',
            target: { type: 'scene', sceneId: scene.id, hotspotId: hotspot.id },
          });
        }
    }
  for (const dialogue of content.dialogues)
    for (const node of dialogue.nodes)
      for (const choice of node.choices)
        rows.push({
          label: `${dialogue.id}/${node.id} · ${choice.text}`,
          when: choice.when,
          requires: [
            `Uzel: ${dialogue.id}/${node.id}`,
            ...describe(choice.when),
          ],
          outcomes: [
            ...(choice.effects ?? []).map(effectText),
            choice.next
              ? `→ uzel: ${dialogue.id}/${choice.next}`
              : 'Konec rozhovoru',
          ],
          message: choice.next
            ? `→ uzel ${choice.next}${choice.message ? ` · ${choice.message}` : ''}`
            : `Konec rozhovoru${choice.message ? ` · ${choice.message}` : ''}`,
          target: { type: 'dialogue', id: dialogue.id, nodeId: node.id },
        });
  for (const combination of content.combinations)
    for (const rule of combination.rules) {
      const when: Condition = {
        all: [
          ...combination.items.map((item) => ({ item })),
          ...(rule.when ? [rule.when] : []),
        ],
      };
      rows.push({
        label: `Kombinace ${combination.items.join(' + ')}`,
        when,
        requires: describe(when),
        outcomes: (rule.effects ?? []).map(effectText),
        message: rule.message ?? '',
        target: { type: 'puzzles' },
      });
    }
  return rows;
}
export function LogicGraph({
  content,
  state,
  onNavigate,
}: {
  content: GameContent;
  state: GameState;
  onNavigate: (target: GraphTarget) => void;
}) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => graphRows(content), [content]);
  const filtered = rows.filter((row) =>
    [row.label, row.message, ...row.requires, ...row.outcomes]
      .join(' ')
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  let offset = 48;
  const positions: { row: Row; y: number; height: number }[] = [];
  for (const row of filtered) {
    const height = Math.max(
      108,
      56 + Math.max(row.requires.length, row.outcomes.length) * 20,
    );
    positions.push({ row, y: offset, height });
    offset += height + 18;
  }
  const short = (text: string, length = 36) =>
    text.length > length ? `${text.slice(0, length - 1)}…` : text;
  return (
    <section className="logic-panel">
      <h2>Mapa logiky</h2>
      <p className="field-note">
        Podmínky → akce / odpověď → efekty. Pořadí pravidel je důležité: vyhraje
        první splněné. Zelená znamená splněné podmínky podle posledního herního
        náhledu; nezaručuje dosažitelnost akce. Klik na akci otevře její
        definici.
      </p>
      <label className="editor-field">
        <span>Hledat ID, objekt, předmět nebo příznak</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="např. powered nebo cable"
        />
      </label>
      <div className="graph-scroll">
        <svg
          className="logic-graph"
          viewBox={`0 0 1040 ${offset}`}
          width="1040"
          height={offset}
          role="img"
          aria-label="Graf podmínek, interakcí a následků"
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0 0 10 5 0 10Z" fill="#c3ae79" />
            </marker>
          </defs>
          <text x="20" y="24">
            POTŘEBUJE
          </text>
          <text x="370" y="24">
            AKCE / UDÁLOST
          </text>
          <text x="760" y="24">
            ZMĚNÍ
          </text>
          {positions.map(({ row, y, height }, index) => (
            <g key={index}>
              <path
                d={`M290 ${y + height / 2}H350 M690 ${y + height / 2}H740`}
                stroke="#c3ae79"
                strokeWidth="2"
                markerEnd="url(#arrow)"
              />
              <rect
                x="10"
                y={y}
                width="280"
                height={height}
                rx="8"
                fill={matches(state, row.when) ? '#274b3e' : '#26323b'}
                stroke="#61756b"
              />
              {(row.requires.length ? row.requires : ['Vždy']).map(
                (text, line) => (
                  <text key={line} x="24" y={y + 30 + line * 20}>
                    <title>{text}</title>
                    {short(text, 32)}
                  </text>
                ),
              )}
              <g
                role="button"
                tabIndex={0}
                aria-label={`Upravit ${row.label}`}
                onClick={() => onNavigate(row.target)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onNavigate(row.target);
                  }
                }}
                className="graph-action"
              >
                <title>
                  {row.label}
                  {'\n'}
                  {row.message}
                </title>
                <rect
                  x="350"
                  y={y}
                  width="340"
                  height={height}
                  rx="8"
                  fill="#354237"
                  stroke="#e6bc6a"
                />
                <text x="365" y={y + 30} className="graph-title">
                  {short(row.label, 39)}
                </text>
                <text x="365" y={y + 58}>
                  {short(row.message, 40)}
                </text>
                <text x="365" y={y + height - 16}>
                  Upravit ↗
                </text>
              </g>
              <rect
                x="740"
                y={y}
                width="290"
                height={height}
                rx="8"
                fill="#26323b"
                stroke="#61756b"
              />
              {(row.outcomes.length ? row.outcomes : ['Bez změny stavu']).map(
                (text, line) => (
                  <text key={line} x="755" y={y + 30 + line * 20}>
                    <title>{text}</title>
                    {short(text, 34)}
                  </text>
                ),
              )}
            </g>
          ))}
        </svg>
      </div>
      {!filtered.length && <p>Žádné pravidla nevyhovují filtru.</p>}
    </section>
  );
}

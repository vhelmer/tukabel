import type { DialogueDefinition } from '../types';

export const dialogues: readonly DialogueDefinition[] = [
  {
    id: 'caretaker',
    start: 'greeting',
    nodes: [
      {
        id: 'greeting',
        speaker: 'Skúšobný správca',
        text: 'Vitaj v testovacej prevádzke. Dvere fungujú, keď funguje router. Tak sme to objednali.',
        choices: [
          { id: 'askRepair', text: 'Ako opravím router?', next: 'repair' },
          {
            id: 'report',
            text: 'Router už svieti.',
            when: { flag: 'powered' },
            next: 'done',
          },
          { id: 'bye', text: 'Zatiaľ sa rozhliadnem.' },
        ],
      },
      {
        id: 'repair',
        speaker: 'Skúšobný správca',
        text: 'Kábel leží pri stoličke. Oprav ho izolačnou páskou a použi na router. Zásuvku nechaj na pokoji, toto je len bezpečná maketa.',
        choices: [
          {
            id: 'getTape',
            text: 'Môžem si vziať pásku?',
            when: { not: { flag: 'tapeGiven' } },
            effects: [
              { type: 'flag', id: 'tapeGiven', value: true },
              { type: 'addItem', id: 'tape' },
            ],
            message: 'Správca ti podal izolačnú pásku.',
            next: 'greeting',
          },
          { id: 'back', text: 'Rozumiem. Ešte niečo…', next: 'greeting' },
          { id: 'leave', text: 'Idem na to.' },
        ],
      },
      {
        id: 'done',
        speaker: 'Skúšobný správca',
        text: 'Výborne. Dvere do dvora sú odomknuté. Tam už na teba čaká len koniec ukážky.',
        choices: [{ id: 'finish', text: 'Vďaka, idem sa pozrieť.' }],
      },
    ],
  },
];

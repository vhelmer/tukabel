import { demoScene } from '../scenes/demoScene';
import { courtyard } from '../scenes/courtyard';
import type { GameContent } from '../types';
import { items } from './items';
import { dialogues } from './dialogues';
import { validateContent } from '../validateContent';

export const content: GameContent = {
  id: 'tukabel-demo-1',
  startScene: 'workshop',
  initialMessage:
    'Oživ router a otvor dvere do dvora. Správca ti poradí. Toto je krátka skúška herných systémov.',
  flags: ['tapeGiven', 'cableTaken', 'powered', 'completed'],
  scenes: [demoScene, courtyard],
  items,
  dialogues,
  combinations: [
    {
      items: ['cable', 'tape'],
      rules: [
        {
          message: 'Páska drží. Máš opravený kábel.',
          effects: [
            { type: 'removeItem', id: 'cable' },
            { type: 'removeItem', id: 'tape' },
            { type: 'addItem', id: 'fixedCable' },
          ],
        },
      ],
    },
  ],
};

const errors = validateContent(content);
if (errors.length)
  throw new Error(`Invalid game content:\n${errors.join('\n')}`);

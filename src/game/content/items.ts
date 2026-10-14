import type { ItemDefinition } from '../types';

export const items: readonly ItemDefinition[] = [
  {
    id: 'cable',
    label: 'Poškodený kábel',
    description: 'Prerušená izolácia. Pred zapojením ho treba opraviť páskou.',
    icon: '〰',
  },
  {
    id: 'tape',
    label: 'Izolačná páska',
    description: 'Univerzálna odpoveď údržby. Skús ju spojiť s káblom.',
    icon: '◉',
  },
  {
    id: 'fixedCable',
    label: 'Opravený kábel',
    description: 'Izolácia drží. Kábel môže ísť do skúšobného routera.',
    icon: '⌁',
  },
];

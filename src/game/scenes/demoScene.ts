import background from '../../assets/demo-room.svg?url';
import type { SceneDefinition } from '../types';

export const demoScene: SceneDefinition = {
  id: 'demo-room',
  title: 'Skúšobňa',
  width: 1280,
  height: 720,
  background,
  hotspots: [
    {
      id: 'router',
      label: 'Router',
      response: 'Dve antény. Tri kontrolky. Nula ochoty spolupracovať.',
      bounds: { x: 300, y: 340, width: 285, height: 180 },
    },
    {
      id: 'mug',
      label: 'Hrnček',
      response: 'Káva už vychladla. Technický problém ostáva horúci.',
      bounds: { x: 665, y: 415, width: 160, height: 135 },
    },
    {
      id: 'socket',
      label: 'Zásuvka',
      response: 'Zásuvka je pripravená. Zvyšok je otázka správneho zapojenia.',
      bounds: { x: 1030, y: 300, width: 125, height: 160 },
    },
  ],
};

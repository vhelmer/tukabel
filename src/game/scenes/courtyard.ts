import background from '../../assets/courtyard.svg?url';
import type { SceneDefinition } from '../types';

export const courtyard: SceneDefinition = {
  id: 'courtyard',
  title: 'Skúšobný dvor',
  width: 1280,
  height: 720,
  background,
  hotspots: [
    {
      id: 'return',
      label: 'Späť do skúšobne',
      bounds: { x: 60, y: 160, width: 245, height: 410 },
      defaultVerb: 'use',
      actions: {
        use: [
          {
            message: 'Späť v skúšobni. Router stále funguje.',
            effects: [{ type: 'scene', id: 'workshop' }],
          },
        ],
        look: [{ message: 'Dvere ostali otvorené. Technický pokrok.' }],
      },
    },
    {
      id: 'sign',
      label: 'Skúšobná tabuľa',
      bounds: { x: 580, y: 220, width: 500, height: 240 },
      defaultVerb: 'look',
      actions: {
        look: [
          {
            message:
              'Ukážka dokončená! Rozhovor, inventár, kombinovanie, hádanka aj prechod fungujú. Skutočný príbeh príde neskôr.',
          },
        ],
      },
    },
  ],
};

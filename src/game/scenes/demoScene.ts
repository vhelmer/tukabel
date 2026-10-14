import background from '../../assets/demo-room.svg?url';
import cable from '../../assets/cable.svg?url';
import caretaker from '../../assets/caretaker.svg?url';
import type { SceneDefinition } from '../types';

export const demoScene: SceneDefinition = {
  id: 'workshop',
  title: 'Skúšobňa',
  width: 1280,
  height: 720,
  background,
  hotspots: [
    {
      id: 'router',
      label: 'Router',
      bounds: { x: 300, y: 340, width: 285, height: 180 },
      defaultVerb: 'look',
      tintWhen: { flag: 'powered' },
      actions: {
        look: [
          {
            when: { flag: 'powered' },
            message: 'Router svieti. Dvere do dvora sú odomknuté.',
          },
          { message: 'Dve antény. Tri kontrolky. Chýba mu opravený kábel.' },
        ],
        use: [
          {
            message:
              'Najprv vyber opravený kábel v inventári, potom klikni na router.',
          },
        ],
      },
      uses: {
        cable: [
          { message: 'Poškodený kábel nezapojím. Najprv ho opravím páskou.' },
        ],
        fixedCable: [
          {
            when: { not: { flag: 'powered' } },
            message: 'Zapojené! Router ožil a dvere do dvora cvakli.',
            effects: [
              { type: 'removeItem', id: 'fixedCable' },
              { type: 'flag', id: 'powered', value: true },
            ],
          },
        ],
      },
    },
    {
      id: 'mug',
      label: 'Hrnček',
      bounds: { x: 665, y: 415, width: 160, height: 135 },
      defaultVerb: 'look',
      actions: {
        look: [
          { message: 'Káva už vychladla. Technický problém ostáva horúci.' },
        ],
        take: [
          { message: 'Hrnček patrí správcovi. Ten má na kávu autorské práva.' },
        ],
      },
    },
    {
      id: 'socket',
      label: 'Zásuvka',
      bounds: { x: 1030, y: 300, width: 125, height: 160 },
      defaultVerb: 'look',
      actions: {
        look: [
          {
            message:
              'Zásuvka je len kulisa. Skúšobný router má vlastný bezpečný zdroj.',
          },
        ],
      },
    },
    {
      id: 'cable',
      label: 'Kábel pri stoličke',
      bounds: { x: 70, y: 580, width: 180, height: 95 },
      image: cable,
      visibleWhen: { not: { flag: 'cableTaken' } },
      defaultVerb: 'take',
      actions: {
        look: [
          {
            message:
              'Poškodený kábel. Páska by mu vrátila pracovné sebavedomie.',
          },
        ],
        take: [
          {
            message: 'Zdvihol si poškodený kábel.',
            effects: [
              { type: 'addItem', id: 'cable' },
              { type: 'flag', id: 'cableTaken', value: true },
            ],
          },
        ],
      },
    },
    {
      id: 'caretaker',
      label: 'Správca',
      bounds: { x: 830, y: 270, width: 180, height: 290 },
      image: caretaker,
      defaultVerb: 'talk',
      actions: {
        look: [
          {
            message: 'Skúšobný správca. Zatiaľ má viac odpovedí než animácií.',
          },
        ],
        talk: [
          {
            message: 'Začal si rozhovor so správcom.',
            effects: [{ type: 'dialogue', id: 'caretaker' }],
          },
        ],
      },
    },
    {
      id: 'exit',
      label: 'Dvere do dvora',
      bounds: { x: 1170, y: 340, width: 105, height: 210 },
      defaultVerb: 'use',
      actions: {
        look: [
          {
            message:
              'Elektrický zámok je prepojený s routerom. Architektúru radšej nesúď.',
          },
        ],
        use: [
          {
            when: { flag: 'powered' },
            message: 'Vyšiel si do skúšobného dvora.',
            effects: [
              { type: 'scene', id: 'courtyard' },
              { type: 'flag', id: 'completed', value: true },
            ],
          },
          { message: 'Zamknuté. Správca možno vie, ako oživiť router.' },
        ],
      },
    },
  ],
};

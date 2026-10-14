export type Verb = 'look' | 'take' | 'talk' | 'use';

export type Condition =
  | { flag: string; value?: boolean }
  | { item: string }
  | { all: readonly Condition[] }
  | { not: Condition };

export type Effect =
  | { type: 'flag'; id: string; value: boolean }
  | { type: 'addItem' | 'removeItem'; id: string }
  | { type: 'scene'; id: string }
  | { type: 'dialogue'; id: string };

export interface Rule {
  readonly when?: Condition;
  readonly message: string;
  readonly effects?: readonly Effect[];
}

export interface Hotspot {
  readonly id: string;
  readonly label: string;
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly visibleWhen?: Condition;
  readonly defaultVerb: Verb;
  // First matching rule wins; keep an unconditional fallback last.
  readonly actions: Partial<Record<Verb, readonly Rule[]>>;
  readonly uses?: Readonly<Record<string, readonly Rule[]>>;
  // Optional local sprite, hidden together with the hotspot (e.g. a pickup).
  readonly image?: string;
  readonly tintWhen?: Condition;
}

export interface SceneDefinition {
  readonly id: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly background: string;
  readonly hotspots: readonly Hotspot[];
}

export interface ItemDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
  readonly image?: string;
}

export interface DialogueNode {
  readonly id: string;
  readonly speaker: string;
  readonly text: string;
  readonly choices: readonly {
    id: string;
    text: string;
    when?: Condition;
    effects?: readonly Effect[];
    next?: string;
    message?: string;
  }[];
}

export interface DialogueDefinition {
  readonly id: string;
  readonly start: string;
  readonly nodes: readonly DialogueNode[];
}

export interface GameContent {
  readonly id: string;
  readonly startScene: string;
  readonly initialMessage: string;
  readonly flags: readonly string[];
  readonly scenes: readonly SceneDefinition[];
  readonly items: readonly ItemDefinition[];
  readonly dialogues: readonly DialogueDefinition[];
  readonly combinations: readonly {
    items: readonly [string, string];
    rules: readonly Rule[];
  }[];
}

// Only serializable player progress; definitions and UI selection stay outside.
export interface GameState {
  sceneId: string;
  inventory: string[];
  flags: Record<string, boolean>;
  dialogue: { id: string; nodeId: string } | null;
  message: string;
}

export type GameAction =
  | { type: 'interact'; hotspotId: string; verb?: Verb; itemId?: string }
  | { type: 'combine'; first: string; second: string }
  | { type: 'choose'; choiceId: string }
  | { type: 'closeDialogue' }
  | { type: 'inspectItem'; itemId: string };

export interface SceneCallbacks {
  onHover: (hotspot: Hotspot | null) => void;
  onInteract: (hotspot: Hotspot) => void;
}

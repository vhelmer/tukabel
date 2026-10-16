export type AnimationKind = 'blink' | 'talk' | 'expression' | 'idle';
export interface AnimationDefinition {
  readonly id: string;
  readonly label: string;
  readonly source: string;
  readonly kind: AnimationKind;
  readonly frames: readonly string[];
  readonly fps: number;
  readonly durationsMs?: readonly number[];
  readonly speed?: number;
  readonly loop?: boolean;
}
export interface CharacterAnimation {
  readonly idle?: string;
  readonly idleLoop?: boolean;
  readonly blink?: string;
  readonly blinkIntervalMs?: readonly [number, number];
  readonly talk?: string;
  readonly dialogueId?: string;
  readonly motion?: 'breath' | 'sway';
  readonly onClick?: string;
  readonly onUse?: string;
}

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
  readonly message?: string;
  readonly effects?: readonly Effect[];
}

export interface Hotspot {
  readonly id: string;
  readonly label: string;
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly visibleWhen?: Condition;
  // First matching click rule wins. Empty means an intentionally silent prop.
  readonly onClick: readonly Rule[];
  readonly cursor?: 'auto' | 'interact' | 'talk' | 'exit';
  readonly cursorImage?: string;
  readonly cursorAnimation?: string;
  readonly cursorSize?: number;
  readonly cursorOffset?: readonly [number, number];
  readonly uses?: Readonly<Record<string, readonly Rule[]>>;
  // Optional local sprite, hidden together with the hotspot (e.g. a pickup).
  readonly image?: string;
  // Degrees clockwise about the centre of bounds, including the clickable area.
  readonly rotation?: number;
  // Normal assets preserve their intrinsic aspect; stretching is opt-in.
  readonly imageFit?: 'contain' | 'stretch';
  readonly animation?: CharacterAnimation;
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
  readonly portrait?: string;
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
  readonly animations?: readonly AnimationDefinition[];
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
  | { type: 'interact'; hotspotId: string; itemId?: string }
  | { type: 'combine'; first: string; second: string }
  | { type: 'choose'; choiceId: string }
  | { type: 'closeDialogue' }
  | { type: 'inspectItem'; itemId: string };

export interface SceneCallbacks {
  onHover: (hotspot: Hotspot | null) => void;
  onInteract: (hotspot: Hotspot) => void;
}

// Ephemeral visual request; never included in a saved player position.
export interface AnimationTrigger {
  readonly sceneId: string;
  readonly hotspotId: string;
  readonly interaction: 'click' | 'use';
  readonly nonce: number;
}

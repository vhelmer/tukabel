export type AnimationKind = 'blink' | 'talk' | 'expression' | 'idle';
export interface AnimationRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
// Ephemeral playback input. A future audio adapter supplies currentTime/viseme;
// no audio clock or visual pose is serialized with player progress.
export interface SpeechPlayback {
  readonly active: boolean;
  readonly timeMs: number;
  readonly frameIndex?: number;
}
export interface SceneSpeechPlayback {
  readonly actor?: { readonly sceneId: string; readonly hotspotId: string };
  readonly read: () => SpeechPlayback;
}
export interface AnimationLayer {
  readonly clipId: string;
  readonly frame: string;
  readonly region: AnimationRegion;
}
export interface AnimationSample {
  readonly frame?: string;
  readonly layers?: readonly AnimationLayer[];
  readonly elapsedMs: number;
  readonly priority: 'base' | 'idle' | 'blink' | 'talk' | 'interaction';
}
export interface AnimationPreviewState {
  readonly speech?: boolean | SpeechPlayback;
  readonly sample?: AnimationSample;
  readonly blinkNonce?: number;
  readonly showRegions?: boolean;
}
export interface AnimationDefinition {
  readonly id: string;
  readonly label: string;
  readonly source: string;
  readonly kind: AnimationKind;
  readonly frames: readonly string[];
  readonly fps: number;
  readonly region?: AnimationRegion;
  readonly durationsMs?: readonly number[];
  readonly speed?: number;
  readonly loop?: boolean;
}
export interface CharacterAnimation {
  readonly voice?: VoiceSettings;
  readonly mouthShapes?: Partial<Readonly<Record<MouthShape, number>>>;
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

export type MouthShape = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'X';
export interface VoiceSettings {
  readonly voiceId: string;
  readonly modelId: string;
  readonly stability: number;
  readonly similarityBoost: number;
  readonly style: number;
  readonly speed: number;
  readonly useSpeakerBoost: boolean;
}
export interface LipSyncTrack {
  readonly metadata: {
    readonly duration: number;
    readonly audioSha256?: string;
  };
  readonly mouthCues: readonly {
    readonly start: number;
    readonly end: number;
    readonly value: MouthShape;
  }[];
}
export interface DialogueSpeech {
  readonly audio: string;
  readonly lipSync?: string;
  readonly alignment?: string;
  readonly subtitles?: SubtitleTrack;
  readonly text: string;
}
export interface SubtitleCue {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}
export interface SubtitleTrack {
  // Snapshot of the displayed text: edits invalidate old manual timing, not audio.
  readonly text: string;
  readonly timing: 'alignment' | 'estimated' | 'manual';
  readonly cues: readonly SubtitleCue[];
}
export interface SpeechAlignment {
  readonly metadata: {
    readonly duration: number;
    readonly audioSha256?: string;
  };
  readonly characters: readonly string[];
  readonly character_start_times_seconds: readonly number[];
  readonly character_end_times_seconds: readonly number[];
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
  | { type: 'dialogue'; id: string }
  | { type: 'startTask' | 'completeTask'; id: string };

export interface TaskDefinition {
  readonly id: string;
  readonly text: string;
  // Absent means event/dialogue effects only. { all: [] } starts immediately.
  readonly startWhen?: Condition;
  readonly completeWhen?: Condition;
}
export type TaskStatus = 'active' | 'completed';

export interface Rule {
  readonly when?: Condition;
  readonly message?: string;
  readonly effects?: readonly Effect[];
}

export interface Hotspot {
  // Array order is paint order. Decorative layers never capture game input.
  readonly decorative?: boolean;
  readonly hidden?: boolean;
  readonly locked?: boolean;
  readonly opacity?: number;
  readonly id: string;
  readonly label: string;
  readonly bounds: { x: number; y: number; width: number; height: number };
  // Original scene coordinates, before rotation about the bounds centre.
  readonly polygon?: readonly { readonly x: number; readonly y: number }[];
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
  readonly hitTest?: 'alpha' | 'bounds';
  readonly alphaThreshold?: number;
  readonly animation?: CharacterAnimation;
  readonly tintWhen?: Condition;
}

export interface SceneDefinition {
  readonly id: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly background: string;
  readonly backgroundHidden?: boolean;
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
  readonly actor?: { readonly sceneId: string; readonly hotspotId: string };
  readonly speech?: DialogueSpeech;
  readonly id: string;
  readonly portrait?: string;
  readonly speaker: string;
  readonly text: string;
  readonly subtitle?: string;
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
  readonly tasks?: readonly TaskDefinition[];
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
  tasks: Record<string, TaskStatus>;
  dialogue: { id: string; nodeId: string } | null;
  message: string;
}

export type GameAction =
  | { type: 'interact'; hotspotId: string; itemId?: string }
  | { type: 'combine'; first: string; second: string }
  | { type: 'choose'; choiceId: string; from?: { id: string; nodeId: string } }
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

export interface Hotspot {
  readonly id: string;
  readonly label: string;
  readonly response: string;
  readonly bounds: { x: number; y: number; width: number; height: number };
}

export interface SceneDefinition {
  readonly id: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly background: string;
  readonly hotspots: readonly Hotspot[];
}

export interface SceneCallbacks {
  onHover: (hotspot: Hotspot | null) => void;
  onInteract: (hotspot: Hotspot) => void;
}

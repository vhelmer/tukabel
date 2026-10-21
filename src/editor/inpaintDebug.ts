export interface InpaintDebug {
  files: {
    original: string;
    objectMask: string;
    expandedMask: string;
    blendMask: string;
    input: string;
    apiMask: string;
    roundTrip: string;
    returned?: string;
    restored?: string;
    final?: string;
    difference?: string;
  };
  geometry: {
    context: { x: number; y: number; width: number; height: number };
    canvas: { width: number; height: number };
    content: { left: number; top: number; width: number; height: number };
    returned?: { width: number; height: number };
  };
  metrics: {
    objectPixels: number;
    expandedPixels: number;
    featherPixels: number;
    feather: number;
    padding: number;
    lostObjectPixels: number;
    roundTripMae: number;
    contextMae?: number;
    seamMae?: number;
    outsideChanges?: number;
    boundaryMaxWeight: number;
  };
  warnings: string[];
}

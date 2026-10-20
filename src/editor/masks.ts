export interface ObjectMask {
  data: string; // Opaque black/white PNG, source-sized, base64 without data URL.
  width: number;
  height: number;
  sourceSha256: string;
  method: 'manual' | 'grabcut' | 'sam2';
  refineEdges?: boolean; // SAM followed by a source-resolution boundary fit.
  detailPass?: boolean; // Full scene + contextual crop at higher object resolution.
}
export interface MaskSource {
  data: string;
  width: number;
  height: number;
  sourceSha256: string;
}

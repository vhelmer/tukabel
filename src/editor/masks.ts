export interface ObjectMask {
  data: string; // Opaque black/white PNG, source-sized, base64 without data URL.
  width: number;
  height: number;
  sourceSha256: string;
  method: 'manual' | 'grabcut' | 'sam2';
}
export interface MaskSource {
  data: string;
  width: number;
  height: number;
  sourceSha256: string;
}

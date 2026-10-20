export interface ObjectMask {
  data: string; // Opaque grayscale PNG, full source size; fractional values need matting metadata.
  width: number;
  height: number;
  sourceSha256: string;
  method: 'manual' | 'grabcut' | 'sam2';
  refineEdges?: boolean; // SAM followed by a source-resolution boundary fit.
  detailPass?: boolean; // Full scene + contextual crop at higher object resolution.
  matting?: MattingSettings;
}
export interface MattingSettings {
  method: 'vitmatte' | 'closed-form' | 'import';
  radius: number;
  decontaminate: boolean;
}
export interface MattingResult extends ObjectMask {
  foreground?: string; // Preview only. Export recomputes colors from source + alpha.
}
export interface MaskSource {
  data: string;
  width: number;
  height: number;
  sourceSha256: string;
}

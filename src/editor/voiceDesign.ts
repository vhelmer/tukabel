export interface VoiceDesignResult {
  manifest: string;
  model: string;
  description: string;
  previews: { audio: string; generatedVoiceId: string; duration: number }[];
}
export interface SavedDesignVoice {
  voiceId: string;
  manifest: string;
  designManifest: string;
  name: string;
}

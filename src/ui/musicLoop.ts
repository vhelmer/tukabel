const MUSIC_GAIN = 0.2;
const DUCK_FACTOR = 0.25;
const CROSSFADE_SECONDS = 1;

type Track = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  retiring: boolean;
};

// Suspending the shared clock preserves the playhead and crossfade. Buffer loops
// have no media-element restart/decoder gap; authored WAVs supply a matching seam.
export class MusicLoop {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private tracks = new Set<Track>();
  private current: Track | undefined;
  private url: string | undefined;
  private request: AbortController | undefined;
  private revision = 0;
  private disposed = false;
  private playing = false;
  private ducked = false;
  private buffers = new Map<string, AudioBuffer>();

  unlock() {
    if (this.disposed) return;
    if (!this.context) {
      const Context =
        window.AudioContext ??
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Context) return;
      try {
        this.context = new Context();
        this.master = this.context.createGain();
        this.master.gain.setValueAtTime(0, this.context.currentTime);
        this.master.connect(this.context.destination);
        // Safari requires resume and a source start inside the trusted gesture.
        const silence = this.context.createBufferSource();
        silence.buffer = this.context.createBuffer(1, 1, 22050);
        silence.connect(this.master);
        silence.onended = () => silence.disconnect();
        silence.start();
      } catch {
        return;
      }
    }
    const context = this.context;
    if (context.state !== 'closed') {
      void context
        .resume()
        .then(() => {
          if (!this.disposed && !this.playing && context.state !== 'closed')
            void context.suspend().catch(() => {});
        })
        .catch(() => {});
    }
  }

  private get volume() {
    return MUSIC_GAIN * (this.ducked ? DUCK_FACTOR : 1);
  }

  setPlaying(playing: boolean) {
    this.playing = playing;
    const context = this.context;
    if (!context || !this.master || this.disposed || context.state === 'closed')
      return;
    this.master.gain.cancelScheduledValues(context.currentTime);
    this.master.gain.setValueAtTime(
      playing ? this.volume : 0,
      context.currentTime,
    );
    if (playing) void context.resume().catch(() => {});
    else void context.suspend().catch(() => {});
  }

  setDucked(ducked: boolean) {
    if (this.ducked === ducked) return;
    this.ducked = ducked;
    if (this.master && this.playing && !this.disposed)
      this.ramp(this.master, this.volume, 0.18);
  }

  private ramp(node: GainNode, volume: number, seconds: number) {
    const now = this.context!.currentTime;
    const gain = node.gain;
    if (typeof gain.cancelAndHoldAtTime === 'function')
      gain.cancelAndHoldAtTime(now);
    else {
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
    }
    gain.linearRampToValueAtTime(volume, now + seconds);
  }

  setTrack(url: string | undefined) {
    if (this.disposed || !this.context || this.url === url) return;
    this.url = url;
    const revision = ++this.revision;
    this.request?.abort();
    this.request = undefined;
    if (!url) {
      if (this.current) this.retire(this.current);
      this.current = undefined;
      return;
    }
    const context = this.context;
    const request = new AbortController();
    this.request = request;
    const load = async () => {
      let buffer = this.buffers.get(url);
      if (!buffer) {
        const response = await fetch(url, { signal: request.signal });
        if (!response.ok) throw new Error('Music unavailable');
        const bytes = await response.arrayBuffer();
        if (this.disposed || revision !== this.revision) return;
        buffer = await context.decodeAudioData(bytes);
        if (this.disposed || revision !== this.revision) return;
        this.buffers.set(url, buffer);
      }
      if (this.disposed || revision !== this.revision) return;
      // Keep only the outgoing current track and the incoming one, even when
      // locations are changed repeatedly before the prior fade has completed.
      for (const track of this.tracks) {
        if (track.retiring) {
          track.source.stop();
          this.release(track);
        }
      }
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.setValueAtTime(0, context.currentTime);
      source.connect(gain);
      gain.connect(this.master!);
      const track: Track = { source, gain, retiring: false };
      this.tracks.add(track);
      source.onended = () => this.release(track);
      source.start(context.currentTime);
      this.ramp(gain, 1, CROSSFADE_SECONDS);
      if (this.current) this.retire(this.current);
      this.current = track;
    };
    void load().catch(() => {});
  }

  private retire(track: Track) {
    if (track.retiring) return;
    track.retiring = true;
    this.ramp(track.gain, 0, CROSSFADE_SECONDS);
    track.source.stop(this.context!.currentTime + CROSSFADE_SECONDS);
  }

  private release(track: Track) {
    if (!this.tracks.delete(track)) return;
    track.source.onended = null;
    track.source.disconnect();
    track.gain.disconnect();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.revision++;
    this.request?.abort();
    this.buffers.clear();
    for (const track of this.tracks) {
      track.source.stop();
      this.release(track);
    }
    this.current = undefined;
    this.master?.disconnect();
    if (this.context && this.context.state !== 'closed')
      void this.context.close().catch(() => {});
  }
}

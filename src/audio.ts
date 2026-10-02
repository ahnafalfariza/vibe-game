// Every sound is synthesised with WebAudio: no audio files to load. Looping
// beds (ski hiss, wind, avalanche rumble) follow the game state; one-shots
// fire on events. Browsers only allow audio after a user gesture, so the
// context is created on the first tap / key press (the title screen's Play
// button is usually that gesture).

const MUTE_KEY = 'yeti-set-go.muted';
/** Major pentatonic, in semitones: any run of these notes sounds happy. */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];

export interface AmbienceState {
  /** px/s */
  speed: number;
  grounded: boolean;
  /** 0 = avalanche far away, 1 = about to catch you. */
  danger: number;
  /** False on the title screen: quieter, no rumble. */
  playing: boolean;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private hiss!: { gain: GainNode; filter: BiquadFilterNode };
  private wind!: { gain: GainNode; filter: BiquadFilterNode };
  private rumble!: GainNode;
  private paused = false;
  muted: boolean;

  constructor() {
    this.muted = readMuted();
    const unlock = () => this.unlock();
    for (const type of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(type, unlock, { capture: true });
    // Silence a backgrounded tab, even on the title screen (which doesn't pause).
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else if (!this.paused) void this.ctx.resume();
    });
  }

  private unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.paused) void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);

    // Two seconds of white noise feeds every noisy sound.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const bed = (type: BiquadFilterType, freq: number, q = 1) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.7 + Math.random() * 0.6; // decorrelate the beds
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      return { gain, filter };
    };
    this.hiss = bed('bandpass', 3000, 0.8);
    this.wind = bed('lowpass', 500, 0.7);
    // Rumble: very low noise, plus a second filter to take the hiss out.
    const rumble = bed('lowpass', 90, 1.5);
    const deep = ctx.createBiquadFilter();
    deep.type = 'lowpass';
    deep.frequency.value = 160;
    rumble.gain.disconnect();
    rumble.gain.connect(deep).connect(this.master);
    this.rumble = rumble.gain;
  }

  /** Freeze all sound (pause menu). */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!this.ctx) return;
    void (paused ? this.ctx.suspend() : this.ctx.resume());
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      // Storage unavailable: the setting just won't persist.
    }
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  /** Called every frame. */
  ambience(s: AmbienceState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const v = Math.min(1, s.speed / 2200);
    const vol = s.playing ? 1 : 0.4;
    this.hiss.gain.gain.setTargetAtTime(s.grounded ? (0.04 + 0.16 * v) * vol : 0, now, 0.05);
    this.hiss.filter.frequency.setTargetAtTime(1800 + 3500 * v, now, 0.1);
    this.wind.gain.gain.setTargetAtTime((0.02 + (s.grounded ? 0.1 : 0.22) * v) * vol, now, 0.2);
    this.wind.filter.frequency.setTargetAtTime(300 + 900 * v, now, 0.2);
    this.rumble.gain.setTargetAtTime(s.playing ? 1.4 * s.danger * s.danger : 0, now, 0.15);
  }

  jump(): void {
    this.noiseBurst(0.18, 'bandpass', 900, 2600, 0.25);
  }

  /** `impact` ~ 0..1 (from air time). */
  land(impact: number): void {
    if (impact < 0.1) return;
    this.tone('sine', 140, 45, 0.16, 0.5 * impact);
    this.noiseBurst(0.12, 'lowpass', 1400, 300, 0.3 * impact);
  }

  /** Rising arpeggio: more notes for more flips, higher for a bigger multiplier. */
  trick(flips: number, multiplier: number): void {
    const start = Math.min(multiplier - 1, SCALE.length - 5);
    const notes = Math.min(flips + 1, 4);
    for (let i = 0; i < notes; i++) {
      const f = 523.25 * 2 ** (SCALE[start + i] / 12);
      this.tone('triangle', f, f, 0.22, 0.22, i * 0.07);
      this.tone('sine', f * 2, f * 2, 0.15, 0.06, i * 0.07);
    }
  }

  sloppy(): void {
    this.tone('triangle', 330, 260, 0.18, 0.18);
  }

  crash(): void {
    this.noiseBurst(0.45, 'lowpass', 2200, 200, 0.6);
    this.tone('sine', 110, 40, 0.3, 0.6);
  }

  caught(): void {
    this.noiseBurst(1.4, 'lowpass', 900, 120, 0.9);
    this.tone('triangle', 392, 98, 0.9, 0.25, 0.15);
  }

  click(): void {
    this.tone('sine', 880, 1320, 0.06, 0.15);
  }

  private tone(type: OscillatorType, from: number, to: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    const gain = envelope(ctx, t, dur, vol);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noiseBurst(dur: number, type: BiquadFilterType, from: number, to: number, vol: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    src.connect(filter).connect(envelope(ctx, t, dur, vol)).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }
}

/** Quick attack, exponential decay. */
function envelope(ctx: AudioContext, t: number, dur: number, vol: number): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  return gain;
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

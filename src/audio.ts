// Every sound is synthesised with WebAudio: no audio files to load. Looping
// beds (ski hiss, wind, avalanche rumble) follow the game state; one-shots
// fire on events; the music loop (bottom of the file) follows the same state.
// Browsers only allow audio after a user gesture, so the
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
  /** The avalanche got you: the music fades out until the next run or title screen. */
  caught: boolean;
  /** Riding a snowmobile at this speed, px/s (0: no engine). */
  engine?: number;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private hiss!: { gain: GainNode; filter: BiquadFilterNode };
  private wind!: { gain: GainNode; filter: BiquadFilterNode };
  private rumble!: GainNode;
  private music!: Music;
  private paused = false;
  muted: boolean;
  musicOn = readMusicOn();

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
    this.music = new Music(ctx, this.master, this.noise, this.musicOn);
  }

  /** Freeze all sound (pause menu). */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!this.ctx) return;
    this.music.paused = paused;
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

  /** Music only; "Sound: off" silences it too. Returns the new state. */
  toggleMusic(): boolean {
    this.musicOn = !this.musicOn;
    try {
      localStorage.setItem(MUSIC_KEY, this.musicOn ? '1' : '0');
    } catch {
      // Storage unavailable: the setting just won't persist.
    }
    if (this.ctx) this.music.enabled = this.musicOn;
    return this.musicOn;
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
    this.engineBed(s.playing ? (s.engine ?? 0) : 0);
    this.music.state = s;
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

  /** Coin pickup: a bright blip that climbs the scale with each coin of a cluster. */
  coin(index: number): void {
    const f = 987.77 * 2 ** (SCALE[Math.min(index, SCALE.length - 1)] / 12);
    this.tone('square', f, f, 0.07, 0.05);
    this.tone('sine', f * 2, f * 2, 0.09, 0.08, 0.02);
  }

  /** Every coin of a cluster: a quick rising jingle. */
  coinCluster(): void {
    [0, 4, 7, 12, 16].forEach((semi, i) => {
      const f = 1046.5 * 2 ** (semi / 12);
      this.tone('triangle', f, f, 0.16, 0.16, i * 0.06);
      this.tone('sine', f * 2, f * 2, 0.12, 0.05, i * 0.06);
    });
  }

  /** Ran into a rock (stony knock) or a cabin (woody crunch). */
  thud(obstacle: 'rock' | 'cabin'): void {
    this.tone('sine', 120, 45, 0.25, 0.7);
    if (obstacle === 'rock') this.noiseBurst(0.12, 'bandpass', 1800, 600, 0.45);
    else this.noiseBurst(0.35, 'bandpass', 700, 250, 0.6);
  }

  // ---- Mounts ----

  /** Climbed aboard: a little fanfare, its own shape per mount. */
  mount(kind: 'penguin' | 'eagle' | 'snowmobile' | 'bear'): void {
    const tunes = { penguin: [0, 4, 7, 12], eagle: [7, 12, 16, 19], snowmobile: [0, 7, 12, 7, 12], bear: [-12, -5, 0, 7] };
    const wave: OscillatorType = kind === 'bear' ? 'sawtooth' : kind === 'snowmobile' ? 'square' : 'triangle';
    tunes[kind].forEach((semi, i) => {
      const f = 659.25 * 2 ** (semi / 12);
      this.tone(wave, f, f, 0.14, kind === 'bear' || kind === 'snowmobile' ? 0.07 : 0.17, i * 0.07);
      this.tone('sine', f * 2, f * 2, 0.1, 0.05, i * 0.07);
    });
  }

  /** A mount took the hit and is gone: a crack and a falling whistle. */
  shieldBreak(): void {
    this.noiseBurst(0.22, 'highpass', 5000, 1500, 0.35);
    this.tone('triangle', 880, 220, 0.35, 0.2);
    this.tone('sine', 140, 50, 0.2, 0.5);
  }

  /** One beat of an eagle's wings: a soft whoosh. */
  flap(): void {
    this.noiseBurst(0.16, 'bandpass', 500, 1400, 0.3);
  }

  /** A polar bear smashing through: a roar over a crunch. */
  roar(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.linearRampToValueAtTime(140, t + 0.15);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.7);
    // Growl: wobble the pitch fast.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 28;
    const depth = ctx.createGain();
    depth.gain.value = 18;
    lfo.connect(depth).connect(osc.frequency);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    osc.connect(filter).connect(envelope(ctx, t, 0.75, 0.45)).connect(this.master);
    for (const o of [osc, lfo]) {
      o.start(t);
      o.stop(t + 0.8);
    }
    this.noiseBurst(0.5, 'lowpass', 2500, 200, 0.5);
  }

  /** The snowmobile runs dry: a few coughs. */
  sputter(): void {
    for (let i = 0; i < 4; i++) this.tone('square', 90 - i * 12, 50, 0.08, 0.12, i * 0.13);
  }

  private engine?: { gain: GainNode; osc: OscillatorNode; filter: BiquadFilterNode };

  /** The snowmobile's engine: a buzzy drone whose pitch follows the speed (0: off). */
  private engineBed(speed: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.engine) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 4;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(this.master);
      osc.start();
      this.engine = { gain, osc, filter };
    }
    const now = ctx.currentTime;
    const v = Math.min(1, speed / 2600);
    this.engine.gain.gain.setTargetAtTime(speed > 0 ? 0.05 + 0.05 * v : 0, now, 0.1);
    this.engine.osc.frequency.setTargetAtTime(55 + 90 * v, now, 0.08);
    this.engine.filter.frequency.setTargetAtTime(400 + 1400 * v, now, 0.1);
  }

  // ---- Meta progression ----

  /** A goal completed mid-run: a bright two-note "ding-ding" with a sparkle. */
  goal(): void {
    [0, 7, 12].forEach((semi, i) => {
      const f = 783.99 * 2 ** (semi / 12);
      this.tone('triangle', f, f, 0.3, 0.2, i * 0.09);
      this.tone('sine', f * 2, f * 2, 0.22, 0.06, i * 0.09);
    });
  }

  /** Levelled up: a little fanfare climbing an octave and a half. */
  levelUp(): void {
    [0, 4, 7, 12, 16, 19, 24].forEach((semi, i) => {
      const f = 523.25 * 2 ** (semi / 12);
      const last = i === 6;
      this.tone('square', f, f, last ? 0.6 : 0.14, last ? 0.08 : 0.06, i * 0.09);
      this.tone('triangle', f, f, last ? 0.7 : 0.18, 0.2, i * 0.09);
    });
  }

  /** Second wind: a rising whoosh as the avalanche falls back. */
  secondWind(): void {
    this.noiseBurst(0.5, 'bandpass', 400, 2400, 0.35);
    this.tone('triangle', 330, 990, 0.5, 0.18);
    this.tone('sine', 660, 1320, 0.4, 0.08, 0.15);
  }

  /** Bought an upgrade: coins clinking into the till. */
  purchase(): void {
    [0, 5, 12].forEach((semi, i) => {
      const f = 1318.5 * 2 ** (semi / 12);
      this.tone('square', f, f, 0.06, 0.05, i * 0.05);
      this.tone('sine', f * 1.5, f * 1.5, 0.14, 0.08, i * 0.05 + 0.02);
    });
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

// ---- Music ------------------------------------------------------------------
// One synthesised loop in C: eight bars of chords played twice, the bell tune
// joining the second time round. A lookahead scheduler queues each 16th note
// a little ahead on the audio clock, so timing stays sample-accurate through
// frame hitches. The arrangement follows ambience() and changes on bar lines:
// sparse and soft on the title screen, the full band in play, driving bass and
// hats when the avalanche is close. It fades out when you're caught and starts
// again from the top on the next run or title screen.

const MUSIC_KEY = 'yeti-set-go.music';
const BPM = 128;
/** One 16th note, s. */
const STEP = 60 / BPM / 4;
/** Notes are queued this far ahead of the audio clock, s. */
const LOOKAHEAD = 0.12;
/** Overall music volume: keep it well under the effects, which carry gameplay information. */
const MUSIC_LEVEL = 0.5;

/** I–vi–ii–V, I–vi–IV–V. Pad voicing and bass root per bar, MIDI notes. */
const CHORDS = [
  { pad: [55, 60, 64], root: 48 }, // C
  { pad: [57, 60, 64], root: 45 }, // Am
  { pad: [57, 62, 65], root: 50 }, // Dm
  { pad: [55, 59, 62], root: 43 }, // G
  { pad: [55, 60, 64], root: 48 }, // C
  { pad: [57, 60, 64], root: 45 }, // Am
  { pad: [57, 60, 65], root: 41 }, // F
  { pad: [55, 59, 62], root: 43 }, // G
];
const LOOP_STEPS = CHORDS.length * 16 * 2;

// Patterns: one character per 16th note, '.' rests.
/** The bell tune, per bar: a digit is an index into SCALE above C5. */
const TUNE = [
  '2...3.4.3.......',
  '5...4...2.......',
  '1...2.1.4.......',
  '3.4.3...1.......',
  '2...3.4.5.......',
  '6.5.4...2.......',
  '4...5...4...3...',
  '1.....2.3.......',
];
/** bass: r root, f fifth, o octave · arp: index into the bar's chord, 3 = its root an octave up · hats: x soft, X accent. */
const ARRANGEMENTS = {
  title: { level: 0.6, bass: 'r.......f.......', arp: '0...2...1...2...', hats: '................' },
  play: { level: 1, bass: 'r.....r.f...r...', arp: '0.1.2.1.3.2.1.2.', hats: '..x...x...x...x.' },
  urgent: { level: 1, bass: 'r.o.r.o.r.o.r.o.', arp: '0.1.2.1.3.2.1.2.', hats: 'xxXxxxXxxxXxxxXx' },
};
const BASS_INTERVAL: Record<string, number> = { r: 0, f: 7, o: 12 };

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

class Music {
  /** Latest game state, from Sfx.ambience(). */
  state: AmbienceState = { speed: 0, grounded: true, danger: 0, playing: false, caught: false };
  paused = false;
  private readonly bus: GainNode;
  private readonly padFilter: BiquadFilterNode;
  private mode: keyof typeof ARRANGEMENTS = 'title';
  private running = false;
  /** Next 16th note to queue: position in the loop and its time on the audio clock. */
  private step = 0;
  private nextTime = 0;

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
    private readonly noise: AudioBuffer,
    public enabled: boolean,
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(out);
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 700;
    this.padFilter.connect(this.bus);
    setInterval(() => this.tick(), 25);
  }

  private tick(): void {
    const ctx = this.ctx;
    // The audio clock stands still while suspended (tab hidden, pause menu): nothing to queue.
    if (this.paused || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const on = this.enabled && !this.state.caught;
    if (on !== this.running) {
      this.running = on;
      if (on) {
        // From the top; the first bar line fades the level back in.
        this.step = 0;
        this.nextTime = now + 0.05;
      } else {
        this.bus.gain.cancelScheduledValues(now);
        this.bus.gain.setTargetAtTime(0, now, this.state.caught ? 0.5 : 0.05);
      }
    }
    if (!on) return;
    // After a stall (long frame, throttled timer), skip the missed notes rather than play them all at once.
    if (this.nextTime < now) {
      const missed = Math.ceil((now - this.nextTime) / STEP);
      this.step = (this.step + missed) % LOOP_STEPS;
      this.nextTime += missed * STEP;
    }
    while (this.nextTime < now + LOOKAHEAD) {
      this.schedule(this.step, this.nextTime);
      this.step = (this.step + 1) % LOOP_STEPS;
      this.nextTime += STEP;
    }
  }

  private schedule(step: number, t: number): void {
    const s = step % 16;
    const bar = (step >> 4) % CHORDS.length;
    const chord = CHORDS[bar];
    const { playing, danger } = this.state;
    if (s === 0) {
      // The arrangement only changes on the bar line.
      this.mode = !playing ? 'title' : danger > (this.mode === 'urgent' ? 0.3 : 0.5) ? 'urgent' : 'play';
      this.bus.gain.setTargetAtTime(ARRANGEMENTS[this.mode].level * MUSIC_LEVEL, t, 0.3);
      this.pad(chord.pad, t, 16 * STEP);
    }
    // The pad brightens beat by beat as the avalanche closes in.
    if (s % 4 === 0) this.padFilter.frequency.setTargetAtTime(700 + 2500 * danger, t, 0.2);

    const part = ARRANGEMENTS[this.mode];
    const b = part.bass[s];
    if (b !== '.') this.note('triangle', hz(chord.root + BASS_INTERVAL[b]), t, 0.35, 0.22, this.bus);
    const a = part.arp[s];
    if (a !== '.') this.pluck(hz(12 + (a === '3' ? chord.pad[0] + 12 : chord.pad[+a])), t);
    const h = part.hats[s];
    if (h !== '.') this.hat(t, h === 'X' ? 0.05 : 0.025);
    const m = step >= LOOP_STEPS / 2 ? TUNE[bar][s] : '.';
    if (m !== '.') this.bell(hz(72 + SCALE[+m]), t);
  }

  /** Two detuned saws per note through the shared low-pass: soft attack, held for the bar. */
  private pad(notes: number[], t: number, dur: number): void {
    const ctx = this.ctx;
    for (const n of notes) {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.025, t + 0.25);
      gain.gain.setTargetAtTime(0, t + dur - 0.1, 0.12);
      gain.connect(this.padFilter);
      for (const detune of [-8, 8]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = hz(n);
        osc.detune.value = detune;
        osc.connect(gain);
        osc.start(t);
        osc.stop(t + dur + 0.6);
      }
    }
  }

  /** Square wave behind a closing low-pass: a soft pluck. */
  private pluck(freq: number, t: number): void {
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2400, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + 0.2);
    filter.connect(this.bus);
    this.note('square', freq, t, 0.25, 0.035, filter);
  }

  /** Sine plus a quick high partial: a music-box bell. */
  private bell(freq: number, t: number): void {
    this.note('sine', freq, t, 1.2, 0.07, this.bus);
    this.note('sine', freq * 4, t, 0.12, 0.02, this.bus);
  }

  private hat(t: number, vol: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    src.connect(filter).connect(envelope(ctx, t, 0.05, vol)).connect(this.bus);
    src.start(t, Math.random() * 1.9);
    src.stop(t + 0.1);
  }

  private note(type: OscillatorType, freq: number, t: number, dur: number, vol: number, dest: AudioNode): void {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(envelope(this.ctx, t, dur, vol)).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}

function readMusicOn(): boolean {
  try {
    return localStorage.getItem(MUSIC_KEY) !== '0';
  } catch {
    return true;
  }
}

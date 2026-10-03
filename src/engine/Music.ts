/**
 * PHASE 4 E5 — adaptive procedural score for John Stick.
 *
 * Everything here is synthesised at runtime: oscillators, one shared white
 * noise buffer and biquad filters. There is not a single audio file, so the
 * score costs no bandwidth, never fails to load, and can be re-balanced in
 * code instead of re-cutting stems.
 *
 * Structure
 *   • five always-allocated layer buses (pad · pulse · perc · bass · lead)
 *     feeding one mix bus → duck bus → **music bus** → the patched master
 *     fader (settings.ts `installAudioBus`). The music bus has its own gain
 *     (settings.musicVolume) and the master fader still owns the final word,
 *     so the HUD mute silences the score too.
 *   • a 96 BPM 16th-note scheduler with a 120 ms lookahead driven by a
 *     40 ms interval. Layer *levels* crossfade with `setTargetAtTime`
 *     (never a hard cut); layer *patterns* only swap on bar lines, so a
 *     scene change reads as a musical transition rather than a skip.
 *   • scenes: menu (dark-minimal half-time theme in A minor) · run (four
 *     intensity tiers: explore pulse → tension → combat percussion+bass →
 *     boss full layers) · paused (fades to silence and halts the scheduler)
 *     · victory / death stings (one-shot fanfares over a silent bed).
 *
 * Autoplay policy: nothing is constructed until the first user gesture
 * (`init()` arms one-shot listeners, `unlock()` builds + resumes the context
 * and starts the scheduler). Before that, scene/volume calls just latch
 * state so the theme begins on the first tap instead of throwing.
 */

export type MusicScene = 'menu' | 'run' | 'paused' | 'victory' | 'gameover';

type LayerId = 'pad' | 'pulse' | 'perc' | 'bass' | 'lead';

const LAYER_IDS: LayerId[] = ['pad', 'pulse', 'perc', 'bass', 'lead'];

/* ------------------------------------------------------------ */
/* Tempo + scheduler                                             */
/* ------------------------------------------------------------ */

const BPM = 96;
const STEP_DUR = 60 / BPM / 4; // 16th note ≈ 0.156 s
const STEPS_PER_BAR = 16;
const LOOKAHEAD = 0.12; // seconds of score scheduled ahead of the playhead
const TICK_MS = 40; // scheduler wake-up

/** Time constant for a layer coming up (musical swell, never a cut). */
const XFADE_TAU = 0.55;
/** Time constant for a layer dropping out (pause / end screens). */
const SILENCE_TAU = 0.25;

/* ------------------------------------------------------------ */
/* Mix levels (0-1 per layer, indexed by scene / intensity)      */
/* ------------------------------------------------------------ */

/**
 * Run-score layer table: idle/explore → tension → combat → boss.
 * pad · pulse · perc · bass · lead
 */
const RUN_LEVELS: number[][] = [
  [0.85, 0.6, 0.0, 0.0, 0.0], // 0 explore: low pulse only
  [0.75, 0.5, 0.5, 0.35, 0.0], // 1 tension: hats + first bass
  [0.6, 0.35, 0.85, 0.8, 0.35], // 2 combat: driving percussion + bass
  [0.55, 0.3, 1.0, 1.0, 0.8], // 3 boss: full layers
];

/** Menu: the dark-minimal pulse sits well forward of everything else. */
const MENU_LEVELS = [0.9, 0.7, 0.0, 0.12, 0.18];
const SILENT_LEVELS = [0, 0, 0, 0, 0];

/* ------------------------------------------------------------ */
/* Harmony + patterns                                            */
/* ------------------------------------------------------------ */

/**
 * A natural minor. Four dark chords cycling every two bars each — the same
 * loop backs the menu theme and the combat bed, so crossfading between them
 * keeps the key and never jumps.
 */
const CHORDS: { root: number; tones: number[] }[] = [
  { root: 110.0, tones: [110.0, 130.81, 164.81] }, // Am
  { root: 87.31, tones: [87.31, 110.0, 130.81] }, // F
  { root: 73.42, tones: [73.42, 87.31, 110.0] }, // Dm
  { root: 82.41, tones: [82.41, 103.83, 123.47] }, // Em
];

/** Lead-voice note table — a pattern digit indexes straight into this. */
const LEAD_NOTES = [440.0, 523.25, 659.25, 587.33, 880.0]; // A4 C5 E5 D5 A5

interface VoicePatterns {
  kick: string;
  snare: string;
  hat: string;
  pulse: string;
  /** '.' rest · 'r' root · 'o' octave up · 'f' fifth */
  bass: string;
  /** '.' rest · digit → LEAD_NOTES index */
  lead: string;
}

/** Pads/truncates every row to exactly 16 steps — a typo can't desync a bar. */
function steps(row: string): string {
  return (row + '................').slice(0, STEPS_PER_BAR);
}

const PATTERNS: Record<'menu' | 'idle' | 'tense' | 'combat' | 'boss', VoicePatterns> = {
  // Half-time menu theme: kick on 1 and 3, a soft hat ghost, no bass drive.
  menu: {
    kick: steps('x.......x.......'),
    snare: steps('................'),
    hat: steps('....x.......x...'),
    pulse: steps('x.......x.......'),
    bass: steps('r.......r.......'),
    lead: steps('....3.......1...'),
  },
  // Explore / wave cleared: bare pulse, room to breathe.
  idle: {
    kick: steps('x.......x.......'),
    snare: steps('................'),
    hat: steps('................'),
    pulse: steps('x.......x.......'),
    bass: steps('r.......r.......'),
    lead: steps('................'),
  },
  // Enemies alive but not yet in your face.
  tense: {
    kick: steps('x.......x...x...'),
    snare: steps('....x.......x...'),
    hat: steps('..x...x...x...x.'),
    pulse: steps('x...x...x...x...'),
    bass: steps('r.......r...f...'),
    lead: steps('................'),
  },
  // Melee: driving percussion + eighth-note bass.
  combat: {
    kick: steps('x...x...x...x.x.'),
    snare: steps('....x.......x..x'),
    hat: steps('..x.x.x.x.x.x.xx'),
    pulse: steps('x.......x.......'),
    bass: steps('r.r.r.oo.r.r.f.r'),
    lead: steps('......4.....3...'),
  },
  // Boss: full layers, double-time hats, running minor motif.
  boss: {
    kick: steps('x..xx..x.x.x.x.x'),
    snare: steps('....x..x....x..x'),
    hat: steps('x.x.x.x.x.x.x.xxx'),
    pulse: steps('x.......x.......'),
    bass: steps('rrr.r.oor.rrf.r.'),
    lead: steps('0.2.4.3.2.0.1.2.'),
  },
};

/* ------------------------------------------------------------ */

class MusicEngine {
  private ctx: AudioContext | null = null;
  /** Own gain (settings.musicVolume) → patched master fader. */
  private musicBus: GainNode | null = null;
  /** SFX-peak ducking lives here so it never touches the volume setting. */
  private duckGain: GainNode | null = null;
  private mixBus: GainNode | null = null;
  private readonly layerGains = new Map<LayerId, GainNode>();
  private leadDelay: DelayNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private volume = 70; // 0-100, latched from settings before unlock
  private scene: MusicScene = 'menu';
  /** Pattern source — only ever advanced on a bar line. */
  private activeScene: MusicScene = 'menu';
  private intensity = 0; // 0-3, run score only
  private chord = 0;

  private inited = false;
  private unlocked = false;
  private timer: number | null = null;
  private step = 0;
  private bar = 0;
  private nextStepTime = 0;
  private duckUntil = 0;

  /**
   * Arms the one-shot gesture listeners that satisfy the autoplay policy.
   * Idempotent, so React StrictMode's double-mounted effect is harmless.
   */
  public init(): void {
    if (this.inited || typeof window === 'undefined') return;
    this.inited = true;
    const gesture = () => this.unlock();
    window.addEventListener('pointerdown', gesture, { once: true, passive: true });
    window.addEventListener('touchend', gesture, { once: true, passive: true });
    window.addEventListener('keydown', gesture, { once: true });
  }

  /**
   * Builds the audio graph and starts the score. Safe to call repeatedly;
   * before a user gesture the context stays suspended and the scheduler is
   * simply not started, so nothing is thrown and nothing piles up.
   */
  public unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        this.ctx = null;
        return;
      }
      this.buildGraph();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    this.unlocked = true;
    this.applyVolume();
    this.applyTargets();
  }

  /** musicBus ← musicVolume, plus scheduler gating when the score is off. */
  public setVolume(volume0100: number): void {
    this.volume = Math.min(100, Math.max(0, Math.round(volume0100)));
    this.applyVolume();
    this.applyTargets();
  }

  /** Scene change: layers crossfade, stings fire once per entry. */
  public setScene(scene: MusicScene): void {
    if (scene === this.scene) return;
    const previous = this.scene;
    this.scene = scene;
    if (scene === 'victory') this.playVictorySting();
    else if (scene === 'gameover') this.playDeathSting();
    else if (scene === 'menu' && previous === 'run') this.bar = 0;
    this.applyTargets();
  }

  /** 0 explore · 1 tension · 2 combat · 3 boss. Clamped, cheap to call at 4 Hz. */
  public setIntensity(intensity: number): void {
    const next = Math.min(3, Math.max(0, Math.round(intensity)));
    if (next === this.intensity) return;
    this.intensity = next;
    if (this.scene === 'run') this.applyTargets();
  }

  /**
   * Ducks the score under an SFX peak (big hit, gunshot, explosion) — dip in
   * ~15 ms, hold, then ride back up. Repeated peaks extend the hold instead
   * of restarting a ramp from silence, so a combo never pumps the music.
   */
  public duck(amount = 0.4, hold = 0.14): void {
    const ctx = this.ctx;
    if (!ctx || !this.unlocked || !this.duckGain || this.volume <= 0) return;
    const now = ctx.currentTime;
    const floor = Math.max(0.05, 1 - Math.min(0.9, amount));
    const end = now + hold;
    if (end < this.duckUntil) return; // a deeper/longer dip is already riding
    this.duckUntil = end;
    try {
      const g = this.duckGain.gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(floor, now, 0.012);
      g.setTargetAtTime(1, end, 0.4);
    } catch {
      // Audio safety — a dead node must never take the frame down.
    }
  }

  /* ---------------- graph ---------------- */

  private buildGraph(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0;
      // ctx.destination is the patched master fader (settings.ts) — that is
      // what makes the HUD mute take the score down with it.
      this.musicBus.connect(ctx.destination);

      this.duckGain = ctx.createGain();
      this.duckGain.gain.value = 1;
      this.duckGain.connect(this.musicBus);

      this.mixBus = ctx.createGain();
      this.mixBus.gain.value = 0.9;
      this.mixBus.connect(this.duckGain);

      for (const id of LAYER_IDS) {
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(this.mixBus);
        this.layerGains.set(id, gain);
      }

      // A short slap-back on the lead voice only — sells the "dark room".
      this.leadDelay = ctx.createDelay(1);
      this.leadDelay.delayTime.value = STEP_DUR * 3;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.3;
      const wet = ctx.createGain();
      wet.gain.value = 0.35;
      this.leadDelay.connect(feedback);
      feedback.connect(this.leadDelay);
      this.leadDelay.connect(wet);
      wet.connect(this.mixBus);
      const lead = this.layerGains.get('lead');
      // Dry + delayed: the motif stays on the grid, the dotted-eighth repeats
      // (3 × 16th @ 96 BPM) ride behind it instead of replacing it.
      if (lead) {
        lead.connect(this.mixBus);
        lead.connect(this.leadDelay);
      }

      this.noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      // Graph build failed: leave ctx without layers; every entry point
      // below bails on a null bus, so the game keeps running in silence.
    }
  }

  private applyVolume(): void {
    if (!this.ctx || !this.musicBus) return;
    try {
      this.musicBus.gain.setTargetAtTime(
        (this.volume / 100) * 0.9,
        this.ctx.currentTime,
        0.08
      );
    } catch {
      // ignore
    }
  }

  private levelsFor(scene: MusicScene): number[] {
    if (scene === 'menu') return MENU_LEVELS;
    if (scene === 'run') return RUN_LEVELS[Math.min(RUN_LEVELS.length - 1, this.intensity)];
    return SILENT_LEVELS;
  }

  /** Crossfades every layer toward its scene target and gates the scheduler. */
  private applyTargets(): void {
    const ctx = this.ctx;
    if (!ctx || this.layerGains.size === 0) return;
    const levels = this.levelsFor(this.scene);
    const muted = this.volume <= 0;
    const now = ctx.currentTime;
    for (let i = 0; i < LAYER_IDS.length; i++) {
      const gain = this.layerGains.get(LAYER_IDS[i]);
      if (!gain) continue;
      const target = muted ? 0 : levels[i];
      gain.gain.setTargetAtTime(target, now, target === 0 ? SILENCE_TAU : XFADE_TAU);
    }
    const audible = !muted && levels.some((level) => level > 0);
    if (audible) this.startScheduler();
    else this.stopScheduler();
  }

  /* ---------------- scheduler ---------------- */

  private startScheduler(): void {
    if (this.timer !== null || !this.unlocked || !this.ctx) return;
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    const now = this.ctx.currentTime;
    this.nextStepTime = this.nextStepTime > now ? this.nextStepTime : now + 0.06;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  private stopScheduler(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.step = 0;
    this.bar = 0;
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running') {
      void ctx.resume().catch(() => undefined);
      return;
    }
    // Recover from a long suspension instead of fast-forwarding the score.
    if (this.nextStepTime < ctx.currentTime) this.nextStepTime = ctx.currentTime + 0.05;
    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD) {
      this.scheduleStep(this.step, this.bar, this.nextStepTime);
      this.nextStepTime += STEP_DUR;
      this.step++;
      if (this.step >= STEPS_PER_BAR) {
        this.step = 0;
        this.bar++;
      }
    }
  }

  private scheduleStep(step: number, bar: number, time: number): void {
    if (step === 0) {
      // Scene/pattern swaps land on bar lines; level crossfades already ran.
      this.activeScene = this.scene;
      this.chord = Math.floor(bar / 2) % CHORDS.length;
      this.playPad(time);
    }

    const pattern = this.patternSet();
    this.hitPerc(pattern.kick[step], time, 'kick');
    this.hitPerc(pattern.snare[step], time, 'snare');
    this.hitPerc(pattern.hat[step], time, 'hat');
    this.hitBass(pattern.bass[step], time);
    this.hitPulse(pattern.pulse[step], time);
    this.hitLead(pattern.lead[step], time);
  }

  private patternSet(): VoicePatterns {
    if (this.activeScene === 'menu') return PATTERNS.menu;
    switch (this.intensity) {
      case 3:
        return PATTERNS.boss;
      case 2:
        return PATTERNS.combat;
      case 1:
        return PATTERNS.tense;
      default:
        return PATTERNS.idle;
    }
  }

  /* ---------------- voices ---------------- */

  /**
   * One oscillator with a percussive (or, with a long attack, swelling)
   * envelope into `dest`. Optionally swept and/or filtered.
   */
  private tone(
    time: number,
    freq: number,
    dur: number,
    gain: number,
    dest: AudioNode,
    type: OscillatorType,
    opts?: { attack?: number; sweepTo?: number; filterFreq?: number; detune?: number }
  ): void {
    const ctx = this.ctx;
    if (!ctx || gain <= 0) return;
    try {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, time);
      if (opts?.sweepTo) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.sweepTo), time + dur * 0.7);
      }
      if (opts?.detune) osc.detune.setValueAtTime(opts.detune, time);

      const env = ctx.createGain();
      const attack = Math.min(opts?.attack ?? 0.012, dur * 0.6);
      env.gain.setValueAtTime(0.0001, time);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), time + attack);
      env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

      let out: AudioNode = env;
      if (opts?.filterFreq) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = opts.filterFreq;
        env.connect(filter);
        out = filter;
      }

      osc.connect(env);
      out.connect(dest);
      osc.start(time);
      osc.stop(time + dur + 0.03);
    } catch {
      // Audio safety
    }
  }

  /** Filtered white-noise one-shot (hats, snares, swells). */
  private noiseHit(
    time: number,
    dur: number,
    gain: number,
    dest: AudioNode,
    type: BiquadFilterType,
    freq: number,
    q = 1,
    sweepTo?: number
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuffer || gain <= 0) return;
    try {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.setValueAtTime(freq, time);
      if (sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), time + dur);
      filter.Q.value = q;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, time);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), time + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, time + dur);

      src.connect(filter);
      filter.connect(env);
      env.connect(dest);
      src.start(time, Math.random() * 1.5);
      src.stop(time + dur + 0.02);
    } catch {
      // Audio safety
    }
  }

  private layer(id: LayerId): GainNode | null {
    return this.layerGains.get(id) ?? null;
  }

  /** Sustained minor chord bed — re-struck every two bars. */
  private playPad(time: number): void {
    const dest = this.layer('pad');
    if (!dest) return;
    const chord = CHORDS[this.chord];
    const dur = STEPS_PER_BAR * 2 * STEP_DUR;
    for (const freq of chord.tones) {
      this.tone(time, freq, dur, 0.16, dest, 'sawtooth', {
        attack: 0.9,
        filterFreq: 720,
        detune: -6,
      });
      this.tone(time, freq, dur, 0.16, dest, 'sawtooth', {
        attack: 1.1,
        filterFreq: 720,
        detune: 7,
      });
    }
  }

  private hitPerc(cell: string, time: number, voice: 'kick' | 'snare' | 'hat'): void {
    const dest = this.layer('perc');
    if (!dest || cell === '.') return;
    const accent = cell === 'o';
    switch (voice) {
      case 'kick':
        this.tone(time, accent ? 150 : 132, accent ? 0.34 : 0.28, 0.95, dest, 'sine', {
          attack: 0.004,
          sweepTo: 44,
        });
        break;
      case 'snare':
        this.noiseHit(time, accent ? 0.2 : 0.15, accent ? 0.5 : 0.38, dest, 'bandpass', 1750, 0.7);
        this.tone(time, 190, 0.1, 0.22, dest, 'triangle', { attack: 0.003, sweepTo: 120 });
        break;
      case 'hat':
        this.noiseHit(time, accent ? 0.09 : 0.045, accent ? 0.3 : 0.2, dest, 'highpass', 7600, 0.7);
        break;
    }
  }

  private hitBass(cell: string, time: number): void {
    const dest = this.layer('bass');
    if (!dest || cell === '.') return;
    const chord = CHORDS[this.chord];
    const freq =
      cell === 'o' ? chord.root * 2 : cell === 'f' ? chord.root * 1.4983 : chord.root; // fifth
    this.tone(time, freq, STEP_DUR * 1.7, 0.5, dest, 'sawtooth', {
      attack: 0.008,
      filterFreq: 420,
    });
    // Sub reinforcement keeps the drive felt on phone speakers.
    this.tone(time, freq * 0.5, STEP_DUR * 1.6, 0.5, dest, 'sine', { attack: 0.01 });
  }

  /** The signature slow pulse (menu + explore bed): sub thump + mid throb. */
  private hitPulse(cell: string, time: number): void {
    const dest = this.layer('pulse');
    if (!dest || cell === '.') return;
    const root = CHORDS[this.chord].root;
    this.tone(time, root * 0.5, 0.55, 0.5, dest, 'sine', { attack: 0.03 });
    this.tone(time, root, 0.4, 0.2, dest, 'triangle', {
      attack: 0.12,
      filterFreq: 520,
    });
  }

  private hitLead(cell: string, time: number): void {
    const dest = this.layer('lead');
    if (!dest || cell === '.' || cell === undefined) return;
    const index = cell.charCodeAt(0) - 48; // '0' → 0
    const freq = LEAD_NOTES[index];
    if (!freq) return;
    this.tone(time, freq, 0.34, 0.2, dest, 'triangle', { attack: 0.01, filterFreq: 2400 });
    this.tone(time, freq * 2, 0.2, 0.07, dest, 'sine', { attack: 0.008 });
  }

  /* ---------------- stings ---------------- */

  /** Victory fanfare — bright, ascending, rings out over the silent bed. */
  private playVictorySting(): void {
    const ctx = this.ctx;
    const dest = this.mixBus;
    if (!ctx || !dest) return;
    const t = ctx.currentTime + 0.04;
    try {
      this.noiseHit(t, 1.1, 0.22, dest, 'highpass', 4200, 0.6, 9000);
      this.tone(t, 110, 1.6, 0.3, dest, 'sawtooth', { attack: 0.05, filterFreq: 520 });
      const run = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
      run.forEach((freq, i) => {
        this.tone(t + 0.16 + i * 0.16, freq, 0.3, 0.24, dest, 'triangle', {
          attack: 0.01,
          filterFreq: 3200,
        });
      });
      const hit = t + 0.9;
      for (const freq of [523.25, 659.25, 783.99, 1046.5]) {
        this.tone(hit, freq, 1.7, 0.16, dest, 'triangle', { attack: 0.02, filterFreq: 3000 });
      }
      this.tone(hit, 65.41, 1.7, 0.4, dest, 'sine', { attack: 0.02, sweepTo: 55 });
      this.noiseHit(hit, 1.3, 0.14, dest, 'highpass', 5200, 0.5, 11000);
    } catch {
      // Audio safety
    }
  }

  /** Death sting — a low detuned fall that drains out of the mix. */
  private playDeathSting(): void {
    const ctx = this.ctx;
    const dest = this.mixBus;
    if (!ctx || !dest) return;
    const t = ctx.currentTime + 0.04;
    try {
      this.tone(t, 96, 1.4, 0.7, dest, 'sine', { attack: 0.01, sweepTo: 38 });
      this.noiseHit(t, 1.2, 0.3, dest, 'lowpass', 2400, 0.8, 260);
      const fall = [220, 196, 174.61, 164.81]; // A3 G3 F3 E3
      fall.forEach((freq, i) => {
        const at = t + 0.2 + i * 0.3;
        this.tone(at, freq, 0.9, 0.2, dest, 'sawtooth', {
          attack: 0.04,
          filterFreq: 640,
          detune: -8,
        });
        this.tone(at, freq, 0.9, 0.2, dest, 'sawtooth', {
          attack: 0.04,
          filterFreq: 640,
          detune: 9,
        });
      });
      this.tone(t + 1.4, 55, 2.4, 0.34, dest, 'sine', { attack: 0.25 });
    } catch {
      // Audio safety
    }
  }
}

export const Music = new MusicEngine();

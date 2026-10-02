/**
 * Sample-based Web Audio sound effects for John Stick.
 *
 * The 20 CC0 recordings in `public/assets/audio` (see SOURCES.md) are fetched
 * and decoded into AudioBuffers once at init, then triggered as one-shots.
 * Every public method keeps the exact signature of the old oscillator synth,
 * so no call site had to change. A sample that fails to fetch/decode is simply
 * never in the bank — playback then falls through as a silent no-op, so a dead
 * asset can never crash the fight.
 *
 * Per-hit `playbackRate` jitter keeps repeated triggers (a punch string, a
 * volley of shots) from sounding machine-gunned.
 */

const SAMPLE_FILES = {
  shot1: 'gun_pistol_shot1.ogg',
  shot2: 'gun_pistol_shot2.ogg',
  shot3: 'gun_pistol_shot3.ogg',
  shot4: 'gun_pistol_shot4.ogg',
  reload: 'sfx_reload.ogg',
  gunCock: 'sfx_gun_cock.ogg',
  punchLight: 'sfx_punch_light.ogg',
  punchHeavy: 'sfx_punch_heavy.ogg',
  kick: 'sfx_kick.ogg',
  slam: 'sfx_slam.ogg',
  whoosh: 'sfx_whoosh.ogg',
  whoosh2: 'sfx_whoosh2.ogg',
  block: 'sfx_block.ogg',
  katana: 'sfx_katana_slash.ogg',
  knifeThrow: 'sfx_knife_throw.ogg',
  knifeStab: 'sfx_knife_stab.ogg',
  glass: 'sfx_glass.ogg',
  coin: 'sfx_coin.ogg',
  door: 'sfx_door.ogg',
  slide: 'sfx_slide.ogg',
} as const;

type SampleId = keyof typeof SAMPLE_FILES;

/** Directory of the CC0 sample pack. */
const AUDIO_BASE = '/assets/audio/';

const SAMPLE_URLS: Record<SampleId, string> = (() => {
  const urls = {} as Record<SampleId, string>;
  for (const id of Object.keys(SAMPLE_FILES) as SampleId[]) {
    urls[id] = `${AUDIO_BASE}${SAMPLE_FILES[id]}`;
  }
  return urls;
})();

const GUNSHOT_SAMPLES: SampleId[] = ['shot1', 'shot2', 'shot3', 'shot4'];

class SoundEngine {
  public enabled: boolean = true;

  private ctx: AudioContext | null = null;
  private buffers = new Map<SampleId, AudioBuffer>();
  private loadStarted = false;

  /**
   * Builds the AudioContext and starts fetching + decoding every sample.
   * Safe to call repeatedly (from the engine constructor and from the first
   * effect) — the fetch pass runs exactly once.
   *
   * Deliberately *not* run at module import: main.tsx installs the master SFX
   * bus on AudioContext.prototype before the first context is constructed, and
   * the engine (GameLoop) or the first played effect triggers this after that.
   */
  public preload(): void {
    this.initCtx();
    this.loadSamples();
  }

  private initCtx() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        try {
          this.ctx = new AudioContextClass();
        } catch {
          this.ctx = null;
        }
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => undefined);
    }
  }

  /** Fetch + decode the whole sample bank. Failures are dropped silently. */
  private loadSamples(): void {
    if (this.loadStarted) return;
    this.initCtx();
    const ctx = this.ctx;
    // No context yet (blocked/unsupported): leave the latch open so the next
    // effect retries instead of silently playing nothing forever.
    if (!ctx || typeof fetch !== 'function') return;
    this.loadStarted = true;

    for (const id of Object.keys(SAMPLE_URLS) as SampleId[]) {
      fetch(SAMPLE_URLS[id])
        .then((res) => {
          if (!res.ok) throw new Error(`sample ${id} -> ${res.status}`);
          return res.arrayBuffer();
        })
        .then((raw) => ctx.decodeAudioData(raw))
        .then((audio) => {
          this.buffers.set(id, audio);
        })
        .catch(() => {
          // Missing/broken sample: stay out of the bank, play silently.
        });
    }
  }

  /**
   * One-shot sample trigger.
   *
   * @param volume  per-effect gain (files are peak-normalised to -1 dBFS)
   * @param rate    playbackRate centre
   * @param jitter  ± spread applied to playbackRate (0 disables)
   * @param delay   seconds to schedule the start in the future
   */
  private playSample(id: SampleId, volume: number, rate = 1, jitter = 0, delay = 0): void {
    if (!this.enabled) return;

    // First effect of the session kicks off the bank load too (guarded).
    if (!this.loadStarted) this.preload();

    this.initCtx();
    const ctx = this.ctx;
    if (!ctx) return;

    const buffer = this.buffers.get(id);
    if (!buffer) return; // Not loaded (or failed to load) — silent skip.

    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const jittered = jitter > 0 ? rate + (Math.random() * 2 - 1) * jitter : rate;
      source.playbackRate.value = Math.min(3, Math.max(0.25, jittered));

      const gain = ctx.createGain();
      gain.gain.value = volume;
      source.connect(gain);
      // ctx.destination is patched by the master SFX bus (settings.ts).
      gain.connect(ctx.destination);

      source.start(ctx.currentTime + Math.max(0, delay));
    } catch {
      // Audio safety — a dead node must never take the frame down.
    }
  }

  /** Swing / whiff air movement. Pitch parameter scales playbackRate. */
  public playWhoosh(pitchMultiplier = 1.0) {
    const id: SampleId = Math.random() < 0.5 ? 'whoosh' : 'whoosh2';
    this.playSample(id, 0.4, pitchMultiplier, 0.05);
  }

  /** Impacts: light jab / heavy punch / kick thud / body slam. */
  public playPunch(type: 'light' | 'heavy' | 'kick' | 'slam' = 'light') {
    switch (type) {
      case 'heavy':
        this.playSample('punchHeavy', 0.62, 1, 0.06);
        break;
      case 'kick':
        this.playSample('kick', 0.6, 1, 0.06);
        break;
      case 'slam':
        this.playSample('slam', 0.7, 1, 0.05);
        break;
      case 'light':
      default:
        this.playSample('punchLight', 0.55, 1, 0.06);
        break;
    }
  }

  /** Guard impact / perfect-parry deflection (same steel-block recording). */
  public playParry() {
    this.playSample('block', 0.6, 1, 0.05);
  }

  /** Ground slide friction. */
  public playSlide() {
    this.playSample('slide', 0.5, 1, 0.05);
  }

  /** Pistol report: random one of the four real recordings + rate jitter. */
  public playGunshot() {
    const pick = GUNSHOT_SAMPLES[(Math.random() * GUNSHOT_SAMPLES.length) | 0];
    this.playSample(pick, 0.5, 1, 0.06);
  }

  /** Full reload foley, accented by a slide-rack cock near the end. */
  public playReload() {
    this.playSample('reload', 0.5, 1, 0.03);
    this.playSample('gunCock', 0.45, 1, 0.04, 0.6);
  }

  /** Manual slide-rack click (empty chamber / gun-fu accents). */
  public playGunCock() {
    this.playSample('gunCock', 0.5, 1, 0.04);
  }

  /** Katana / blade arc. */
  public playBladeSlash() {
    this.playSample('katana', 0.5, 1, 0.05);
  }

  /** Thrown knife leaving the hand. */
  public playKnifeThrow() {
    this.playSample('knifeThrow', 0.5, 1, 0.06);
  }

  /** Knife burying itself in a target (impale). */
  public playKnifeStab() {
    this.playSample('knifeStab', 0.55, 1, 0.05);
  }

  /** Glass display / bottle shatter. */
  public playGlassShatter() {
    this.playSample('glass', 0.55, 1, 0.05);
  }

  /** Continental gold coin pickup. */
  public playCoinPickup() {
    this.playSample('coin', 0.45, 1, 0.05);
  }

  /** Chamber door opening. */
  public playDoorOpen() {
    this.playSample('door', 0.5, 1, 0.03);
  }

  /** Health pack — no recording ships with the pack, so keep a soft synth chime. */
  public playHeal() {
    if (!this.enabled) return;
    this.initCtx();
    const ctx = this.ctx;
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99]; // C5 -> E5 -> G5
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const t = now + i * 0.07;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.31);
      });
    } catch {
      // Audio safety
    }
  }
}

export const SoundFX = new SoundEngine();

/**
 * Sample-based Web Audio sound effects for John Stick.
 *
 * The 28 CC0 recordings in `public/assets/audio` (see SOURCES.md) are fetched
 * and decoded into AudioBuffers once at init, then triggered as one-shots.
 * Every public method keeps the exact signature of the old oscillator synth,
 * so no call site had to change. A sample that fails to fetch/decode is simply
 * never in the bank — playback then falls through as a silent no-op, so a dead
 * asset can never crash the fight.
 *
 * Per-hit `playbackRate` jitter keeps repeated triggers (a punch string, a
 * volley of shots) from sounding machine-gunned.
 *
 * REAL GUN REPORTS — each weapon class has its own bank of real firearm
 * recordings (Colt 1911 / Carl Gustav M45 / Mossberg + Winchester / AK-47,
 * see SOURCES.md), so the classes differ by what was recorded, not by pitch
 * shifting. Gun reports play at playbackRate 1.0 with only a ±0.03 detune.
 *
 * PHASE 4 E5/E2 — spatial voices + music ducking:
 *   • World sounds take an optional world-x. Distance from the listener
 *     (the player, pushed every frame by GameLoop) sets attenuation and a
 *     gentle low-pass, and the horizontal offset sets the stereo pan.
 *     Omitting x keeps the exact shipped centred/full-level path, which is
 *     what every player-owned sound uses.
 *   • The gain → filter → panner strip for a spatial voice comes from a
 *     fixed pool built once per context. Only the AudioBufferSourceNode
 *     (which WebAudio forces you to allocate per trigger) is transient, so
 *     a wall of hits never allocates a node graph.
 *   • Peaks also duck the score (Music.duck) so a fat combo sits on top of
 *     the mix instead of fighting it.
 */

import { Music } from './Music';

const SAMPLE_FILES = {
  pistolShot1: 'gun_pistol_shot1.ogg',
  pistolShot2: 'gun_pistol_shot2.ogg',
  pistolShot3: 'gun_pistol_shot3.ogg',
  smgShot1: 'gun_smg_shot1.ogg',
  smgShot2: 'gun_smg_shot2.ogg',
  smgShot3: 'gun_smg_shot3.ogg',
  shotgunShot1: 'gun_shotgun_shot1.ogg',
  shotgunShot2: 'gun_shotgun_shot2.ogg',
  shotgunShot3: 'gun_shotgun_shot3.ogg',
  rifleShot1: 'gun_rifle_shot1.ogg',
  rifleShot2: 'gun_rifle_shot2.ogg',
  rifleShot3: 'gun_rifle_shot3.ogg',
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

/** Weapon class reported by `playGunReport`. */
type GunKind = 'PISTOL' | 'SMG' | 'SHOTGUN' | 'RIFLE';

/**
 * Real per-class gun banks — every class plays only its own recordings, so a
 * pistol never sounds like a rifle and no fake pitch-shaping is involved.
 * Three single-shot slices per class (see SOURCES.md for the source takes).
 */
const GUN_BANKS: Record<GunKind, readonly SampleId[]> = {
  PISTOL: ['pistolShot1', 'pistolShot2', 'pistolShot3'], // Colt 1911 .45 ACP
  SMG: ['smgShot1', 'smgShot2', 'smgShot3'], // Carl Gustav M45 9 mm
  SHOTGUN: ['shotgunShot1', 'shotgunShot2', 'shotgunShot3'], // Mossberg / Win Model 12
  RIFLE: ['rifleShot1', 'rifleShot2', 'rifleShot3'], // AK-47 7.62x39
};

/** Per-class report level — the recordings are peak-normalised, so this only balances the mix. */
const GUN_GAINS: Record<GunKind, number> = {
  PISTOL: 0.5,
  SMG: 0.36,
  SHOTGUN: 0.7,
  RIFLE: 0.6,
};

/** Light random detune on every gun report (±), so repeats never sound cloned. */
const GUN_DETUNE = 0.03;

/** Random pick from a real gun bank. */
function pickGunSample(bank: readonly SampleId[]): SampleId {
  return bank[(Math.random() * bank.length) | 0];
}

/** Directory of the CC0 sample pack. */
const AUDIO_BASE = '/assets/audio/';

const SAMPLE_URLS: Record<SampleId, string> = (() => {
  const urls = {} as Record<SampleId, string>;
  for (const id of Object.keys(SAMPLE_FILES) as SampleId[]) {
    urls[id] = `${AUDIO_BASE}${SAMPLE_FILES[id]}`;
  }
  return urls;
})();

/* ---------------- PHASE 4 — spatial voice pool ---------------- */

/** Distance (px) at which a world sound has lost half its level. */
const SPATIAL_REF = 700;
/** Horizontal distance mapped to full stereo separation. */
const SPATIAL_PAN = 650;
/** Beyond this the low-pass has already eaten the top end. */
const SPATIAL_MAX_PAN = 0.85;
/** Fixed number of reusable gain → filter → panner strips. */
const SPATIAL_VOICES = 8;
/** SFX at or above this gain pull the score down while they ring out. */
const DUCK_THRESHOLD = 0.55;

interface SpatialVoice {
  input: GainNode;
  filter: BiquadFilterNode;
  panner: StereoPannerNode;
  /** ctx time when this strip frees up (sources are one-shot). */
  busyUntil: number;
}

class SoundEngine {
  public enabled: boolean = true;

  /**
   * Global playback-rate multiplier. The Death Cam's slow-motion ramp drives
   * this (spec §6 "audio slowed to match") — every voice is scaled by it at
   * start, so the whole mix follows the replay clock without per-cue calls.
   * Always reset to 1 when the replay ends.
   */
  public timeScale: number = 1;

  private ctx: AudioContext | null = null;
  private buffers = new Map<SampleId, AudioBuffer>();
  private loadStarted = false;

  /** PHASE 4: listener (player) world x — pushed once per frame. */
  private listenerX = 0;
  private readonly voices: SpatialVoice[] = [];

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

  /**
   * PHASE 4 — where the world is heard from. Called by GameLoop with the
   * player's x each frame; a plain field write, so it costs nothing.
   */
  public setListenerX(x: number): void {
    this.listenerX = x;
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
   * Builds the reusable spatial strips once per context. Each is
   * gain → low-pass → stereo pan → master fader (ctx.destination is patched
   * by settings.ts), so a world voice only ever varies two param values.
   */
  private buildVoices(ctx: AudioContext): void {
    while (this.voices.length < SPATIAL_VOICES) {
      try {
        const input = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 20000;
        const panner = ctx.createStereoPanner();
        input.connect(filter);
        filter.connect(panner);
        panner.connect(ctx.destination);
        this.voices.push({ input, filter, panner, busyUntil: 0 });
      } catch {
        break; // No spatial hardware → the centred path still plays.
      }
    }
  }

  /** First free strip, or null when the pool is saturated (caller falls back). */
  private acquireVoice(ctx: AudioContext): SpatialVoice | null {
    if (this.voices.length < SPATIAL_VOICES) this.buildVoices(ctx);
    const now = ctx.currentTime;
    for (const voice of this.voices) {
      if (voice.busyUntil <= now) return voice;
    }
    return null;
  }

  /**
   * Distance + pan model for a world source.
   * `att` is an inverse-distance curve (1 at the player, 0.5 at 700 px),
   * `pan` mirrors how far left/right the source sits, and the low-pass
   * closes down as the source gets further away (air absorption).
   */
  private spatialize(voice: SpatialVoice, sourceX: number, volume: number): number {
    const dx = sourceX - this.listenerX;
    const dist = Math.abs(dx);
    const att = SPATIAL_REF / (SPATIAL_REF + dist);
    const pan = Math.max(-1, Math.min(1, dx / SPATIAL_PAN)) * SPATIAL_MAX_PAN;
    voice.input.gain.value = volume * att;
    voice.panner.pan.value = pan;
    voice.filter.frequency.value = Math.max(900, Math.min(20000, 20000 - dist * 7));
    return att;
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

    // PHASE 4 E5: loud effects duck the score while they ring out.
    if (volume >= DUCK_THRESHOLD) {
      Music.duck(volume >= 0.75 ? 0.5 : 0.32, 0.12);
    }

    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const jittered = jitter > 0 ? rate + (Math.random() * 2 - 1) * jitter : rate;
      source.playbackRate.value = Math.min(3, Math.max(0.25, jittered * this.timeScale));

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

  /**
   * PHASE 4 — spatialised one-shot. Same rules as playSample, but the voice
   * routes through a pooled strip placed at `sourceX` in the world. Falls
   * back to the shipped centred path when the pool is saturated, so a hit
   * is never dropped or cut short.
   */
  private playWorld(
    id: SampleId,
    volume: number,
    sourceX: number,
    rate = 1,
    jitter = 0,
    delay = 0
  ): void {
    if (!this.enabled) return;
    if (!this.loadStarted) this.preload();
    this.initCtx();
    const ctx = this.ctx;
    if (!ctx) return;
    const buffer = this.buffers.get(id);
    if (!buffer) return;

    const voice = this.acquireVoice(ctx);
    if (!voice) {
      this.playSample(id, volume, rate, jitter, delay);
      return;
    }

    if (volume >= DUCK_THRESHOLD) {
      Music.duck(volume >= 0.75 ? 0.5 : 0.32, 0.12);
    }

    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const jittered = jitter > 0 ? rate + (Math.random() * 2 - 1) * jitter : rate;
      source.playbackRate.value = Math.min(3, Math.max(0.25, jittered * this.timeScale));

      this.spatialize(voice, sourceX, volume);
      source.connect(voice.input);

      const start = ctx.currentTime + Math.max(0, delay);
      voice.busyUntil = start + buffer.duration / source.playbackRate.value + 0.04;
      source.onended = () => {
        try {
          source.disconnect();
        } catch {
          // Already torn down — fine.
        }
      };
      source.start(start);
    } catch {
      // Audio safety — a dead node must never take the frame down.
    }
  }

  /**
   * Shared router for every effect that can be world-sourced: passing an `x`
   * spatialises it, omitting it keeps the shipped centred/full path.
   */
  private fire(
    id: SampleId,
    volume: number,
    x: number | undefined,
    rate = 1,
    jitter = 0,
    delay = 0
  ): void {
    if (x === undefined) this.playSample(id, volume, rate, jitter, delay);
    else this.playWorld(id, volume, x, rate, jitter, delay);
  }

  /**
   * One real gun report: a random slice from the class's bank at
   * playbackRate 1.0 with only the light ±GUN_DETUNE detune — the voicing
   * comes from the recording itself, never from pitch shaping.
   */
  private fireGun(kind: GunKind, x?: number): void {
    this.fire(pickGunSample(GUN_BANKS[kind]), GUN_GAINS[kind], x, 1, GUN_DETUNE);
  }

  /** Swing / whiff air movement. Pitch parameter scales playbackRate.
   *  `x` = swing origin (enemy swings pass theirs — player swings centre). */
  public playWhoosh(pitchMultiplier = 1.0, x?: number) {
    const id: SampleId = Math.random() < 0.5 ? 'whoosh' : 'whoosh2';
    this.fire(id, 0.4, x, pitchMultiplier, 0.05);
  }

  /** Impacts: light jab / heavy punch / kick thud / body slam.
   *  `x` = impact origin in world space (undefined = the player's own hit). */
  public playPunch(type: 'light' | 'heavy' | 'kick' | 'slam' = 'light', x?: number) {
    switch (type) {
      case 'heavy':
        this.fire('punchHeavy', 0.62, x, 1, 0.06);
        break;
      case 'kick':
        this.fire('kick', 0.6, x, 1, 0.06);
        break;
      case 'slam':
        this.fire('slam', 0.7, x, 1, 0.05);
        break;
      case 'light':
      default:
        this.fire('punchLight', 0.55, x, 1, 0.06);
        break;
    }
  }

  /** Guard impact / perfect-parry deflection (same steel-block recording). */
  public playParry(x?: number) {
    this.fire('block', 0.6, x, 1, 0.05);
  }

  /** Ground slide friction. */
  public playSlide() {
    this.playSample('slide', 0.5, 1, 0.05);
  }

  /** Pistol report: random one of the three real Colt 1911 slices + light detune.
   *  `x` = muzzle position (enemy gunfire passes theirs). */
  public playGunshot(x?: number) {
    this.fireGun('PISTOL', x);
  }

  /**
   * Per-weapon report (Phase 1 E4). `playGunshot()` keeps its exact shipped
   * signature, so every existing call site is untouched. Each class picks from
   * its OWN real recording bank at playbackRate 1.0 — no fake pitch-shaping and
   * no synthetic layer; the guns sound different because the recordings are.
   */
  public playGunReport(kind: GunKind, x?: number) {
    this.fireGun(kind in GUN_BANKS ? kind : 'PISTOL', x);
  }

  /** Explosive-barrel detonation (Phase 1 D3/E4): slammed low boom. */
  public playExplosion(x?: number) {
    this.fire('slam', 0.85, x, 0.5, 0.08);
    this.fire('glass', 0.3, x, 0.7, 0.1, 0.04);
  }

  /** Full reload foley, accented by a slide-rack cock near the end. */
  public playReload() {
    this.playSample('reload', 0.5, 1, 0.03);
    this.playSample('gunCock', 0.45, 1, 0.04, 0.6);
  }

  /** Manual slide-rack click (empty chamber / gun-fu accents). */
  public playGunCock(x?: number) {
    this.fire('gunCock', 0.5, x, 1, 0.04);
  }

  /** Katana / blade arc. */
  public playBladeSlash(x?: number) {
    this.fire('katana', 0.5, x, 1, 0.05);
  }

  /** Thrown knife leaving the hand. */
  public playKnifeThrow() {
    this.playSample('knifeThrow', 0.5, 1, 0.06);
  }

  /** Knife burying itself in a target (impale). */
  public playKnifeStab(x?: number) {
    this.fire('knifeStab', 0.55, x, 1, 0.05);
  }

  /** Glass display / bottle shatter — `x` = the prop's world position. */
  public playGlassShatter(x?: number) {
    this.fire('glass', 0.55, x, 1, 0.05);
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

  /**
   * PHASE 2: level-up fanfare — a quick ascending arpeggio (same lightweight
   * synth voice as playHeal, no sample needed).
   */
  public playLevelUp() {
    if (!this.enabled) return;
    this.initCtx();
    const ctx = this.ctx;
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        const t = now + i * 0.06;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.22, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.43);
      });
    } catch {
      // Audio safety
    }
  }

  /**
   * PHASE 2: achievement unlock chime — two bright bell tones (the coin
   * sample stacked twice reads cheap, so this stays on the synth voice).
   */
  public playAchievement() {
    if (!this.enabled) return;
    this.initCtx();
    const ctx = this.ctx;
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const notes = [659.25, 987.77]; // E5 -> B5
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const t = now + i * 0.09;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.56);
      });
    } catch {
      // Audio safety
    }
  }
}

export const SoundFX = new SoundEngine();

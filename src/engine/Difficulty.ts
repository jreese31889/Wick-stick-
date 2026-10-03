/**
 * G5 DIFFICULTY TIERS — ROOKIE / PRO / CONTINENTAL.
 *
 * The tier scales how the enemy *brain* behaves and never a single hit point:
 * reaction latency, aim error, decision pacing, defensive-read chances,
 * flank/rush timing and how long a poise-broken fighter keeps running.
 * HP, damage numbers, hit-stop, slow-mo and every authored combat value stay
 * byte-identical at every tier — a CONTINENTAL kill pays the same damage, it
 * just gets read faster and answered harder.
 *
 * PRO is the shipped baseline (every scale = 1.0), so a run with no stored
 * setting plays exactly like the build it came from.
 *
 * Per-tier values are documented in PRODUCTION_ROADMAP.md (G5 row).
 */

export type DifficultyTier = 'rookie' | 'pro' | 'continental';

/**
 * Hard floor under every tier-coded reaction. A human auditory startle plus a
 * visual confirm lands around 0.20 s — nothing in this file may ever schedule
 * a reaction faster than that, so no tier can produce a frame-perfect AI.
 * The smoke suite asserts every tier's floor sits at or above this number.
 */
export const MIN_HUMAN_REACTION = 0.2;

/** Authored vertical aim error on an enemy round, in px (1.0 = shipped band). */
export const BASE_AIM_SPREAD = 22;

export interface DifficultyProfile {
  id: DifficultyTier;
  label: string;
  blurb: string;
  /**
   * Seconds before ANY tier-coded reaction may start (the floor). At or above
   * MIN_HUMAN_REACTION on every tier — tiers differ, sub-human never happens.
   */
  reactionMin: number;
  /** Extra random seconds piled on top of the floor — human inconsistency. */
  reactionJitter: number;
  /** Multiplies the authored aim error (1 = shipped 22 px band). */
  aimSpreadScale: number;
  /**
   * Multiplies decision-cooldown DRAIN (EnemyController.update). > 1 drains
   * slower = lazier decisions; < 1 drains faster = quicker on the trigger.
   */
  decisionCooldownScale: number;
  /** Multiplies block / dodge / riposte rolls (clamped in place, never 1.0). */
  defenseChanceScale: number;
  /** Seconds the squad waits between committed attacks (flank/rush timing). */
  attackGap: number;
  /** Multiplies the authored flank ring depth (1 = shipped 70/125 px rings). */
  flankRingScale: number;
  /** Seconds a poise-broken fighter spends creating distance. */
  retreatDuration: number;
}

export const DIFFICULTY_TIERS: Record<DifficultyTier, DifficultyProfile> = {
  rookie: {
    id: 'rookie',
    label: 'ROOKIE',
    blurb:
      'Long reactions, wide aim, slow decisions and loose rush timing. The squad flinches, breaks for cover and gives you room.',
    reactionMin: 0.45,
    reactionJitter: 0.35,
    aimSpreadScale: 1.6,
    decisionCooldownScale: 1.45,
    defenseChanceScale: 0.7,
    attackGap: 0.4,
    flankRingScale: 1.3,
    retreatDuration: 1.1,
  },
  pro: {
    id: 'pro',
    label: 'PRO',
    blurb:
      'The shipped baseline: human reaction band, authored aim error and the authored rush rhythm. Everything here matches the build exactly.',
    reactionMin: 0.3,
    reactionJitter: 0.22,
    aimSpreadScale: 1,
    decisionCooldownScale: 1,
    defenseChanceScale: 1,
    attackGap: 0.22,
    flankRingScale: 1,
    retreatDuration: 0.9,
  },
  continental: {
    id: 'continental',
    label: 'CONTINENTAL',
    blurb:
      'Sharp reactions, tight aim, fast decisions and a coordinated rush. Same bodies, same HP — they simply read you sooner.',
    reactionMin: 0.22,
    reactionJitter: 0.14,
    aimSpreadScale: 0.55,
    decisionCooldownScale: 0.75,
    defenseChanceScale: 1.25,
    attackGap: 0.12,
    flankRingScale: 0.85,
    retreatDuration: 0.7,
  },
};

/** Ordered list for the Options picker / stage-select chip. */
export const DIFFICULTY_ORDER: DifficultyTier[] = ['rookie', 'pro', 'continental'];

let currentTier: DifficultyTier = 'pro';

/** Paints the run's tier (App mirrors settings.difficulty through GameLoop). */
export function setDifficulty(tier: DifficultyTier): void {
  currentTier = DIFFICULTY_TIERS[tier] ? tier : 'pro';
}

export function currentDifficulty(): DifficultyTier {
  return currentTier;
}

export function getDifficulty(): DifficultyProfile {
  return DIFFICULTY_TIERS[currentTier];
}

/**
 * One reaction latency draw: never shorter than the tier floor, never longer
 * than floor + jitter. Every G5 reaction (gunshot, shot-at cover, poise-break
 * retreat) schedules through here so the smoke suite can prove the floors.
 */
export function reactionDelay(profile: DifficultyProfile = getDifficulty()): number {
  const floor = Math.max(MIN_HUMAN_REACTION, profile.reactionMin);
  return floor + Math.random() * Math.max(0, profile.reactionJitter);
}

/** Enemy aim error in px for the current tier (never 0 — no lasers). */
export function aimSpreadPx(profile: DifficultyProfile = getDifficulty()): number {
  return Math.max(4, BASE_AIM_SPREAD * profile.aimSpreadScale);
}

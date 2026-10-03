/**
 * G7 TRAINING ARENA — the mechanic checklist.
 *
 * The room itself lives in GameLoop (spawned dummies, no player death,
 * instant reset); this module is only the tracker that says which of the
 * authored mechanics the fighter has actually performed this session.
 *
 * Every mark fires from CombatDirector, at the exact site the mechanic
 * resolves — so a checked box is proof the move ran through the real combat
 * path, not a UI shortcut. Marks are inert until `trainingSetActive(true)`,
 * so a live contract can never tick the board.
 */

export type TrainingCheckId =
  | 'JUMP_ATTACK'
  | 'CROUCH_ATTACK'
  | 'AIR_MOVE'
  | 'SLIDE_FIRE'
  | 'PISTOL_WHIP'
  | 'TAKEDOWN'
  | 'SPECIAL'
  | 'SUPER';

export interface TrainingCheckDef {
  id: TrainingCheckId;
  label: string;
  /** How to perform it — printed under the label in the panel. */
  hint: string;
}

export const TRAINING_CHECKS: TrainingCheckDef[] = [
  { id: 'JUMP_ATTACK', label: 'Jump attack', hint: 'FLYING KICK — run, then KICK' },
  { id: 'CROUCH_ATTACK', label: 'Crouch attack', hint: 'Hold stick DOWN + PUNCH / KICK' },
  { id: 'AIR_MOVE', label: 'Air move', hint: 'Jump, then PUNCH or KICK in the air' },
  { id: 'SLIDE_FIRE', label: 'Slide-fire', hint: 'Slide, then SHOOT mid-slide' },
  { id: 'PISTOL_WHIP', label: 'Pistol whip', hint: 'SHOOT at arm’s length' },
  { id: 'TAKEDOWN', label: 'Takedown', hint: 'GRAB beside a fighter' },
  { id: 'SPECIAL', label: 'Special', hint: '5+ combo, then SPECIAL (whirl)' },
  { id: 'SUPER', label: 'Super', hint: '15+ combo, then SPECIAL (slam)' },
];

let active = false;
const done = new Set<TrainingCheckId>();

/** True only while the Training Arena owns the run. */
export function trainingIsActive(): boolean {
  return active;
}

export function trainingSetActive(on: boolean): void {
  active = on;
}

/** Entering the room always starts the board clean. */
export function trainingResetChecks(): void {
  done.clear();
}

export function trainingClearChecks(): void {
  done.clear();
}

/** Marks a mechanic as performed. No-op outside the Training Arena. */
export function trainingMark(id: TrainingCheckId): void {
  if (!active) return;
  done.add(id);
}

export function trainingIsDone(id: TrainingCheckId): boolean {
  return done.has(id);
}

/** Live board for the panel — a plain array, re-read on every render. */
export function trainingDone(): TrainingCheckId[] {
  return TRAINING_CHECKS.map((c) => c.id).filter((id) => done.has(id));
}

export function trainingProgress(): { done: number; total: number } {
  return { done: done.size, total: TRAINING_CHECKS.length };
}

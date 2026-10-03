/**
 * DEATH CAM — kill attribution resolver (spec §2 "Kill Attribution").
 *
 * Every damage path in CombatDirector already knows, at the moment it lands,
 * who swung, with what and from where — but that knowledge is thrown away
 * because the engine only ever calls `takeDamage(...)` positionally. This
 * module captures it into a positional (allocation-free) attack context just
 * before each damage call, and converts it into a self-contained
 * `EliminationRecord` the instant a blow turns out to be lethal.
 *
 * The record copies everything it needs (names, weapon label, distance,
 * replay timestamp) so the overlay can render after the killer's body is gone
 * and the replay window has wrapped. No engine class is imported at runtime
 * (structural types only) — callers pass what they know, the ring keeps the
 * last handful for the kill feed / tests.
 */

import type { EnemyType, EliminationRecord, EliminationType, HitBodyPart } from '../types/game';
import { replayBuffer } from './ReplayBuffer';
import { GUNS, type GunId } from './Weapons';

/** ~1.8 m stick figure ≈ 100 px ⇒ 1 px ≈ 1.8 cm. */
export const PX_PER_METER = 55;

export const PLAYER_NAME = 'JOHN STICK';
export const ENVIRONMENT_NAME = 'THE ENVIRONMENT';
export const PLAYER_ID = 'player';

/** How many resolved records the ring keeps (kill feed + smoke assertions). */
const RECORD_RING = 8;

/**
 * Enemy HUD names, mirrored from EnemyRig's ARCHETYPE_TAGS. Duplicated on
 * purpose: importing the rig would drag the whole renderer graph into this
 * attribution module (and its future server-side use).
 */
const ENEMY_NAMES: Record<EnemyType, string> = {
  BASIC: 'ENFORCER',
  RUSHER: 'RUSHER',
  HEAVY: 'BRUTE',
  DEFENDER: 'DEFENDER',
  ELITE: 'ELITE',
  GUNNER: 'SHARPSHOOTER',
  BOSS: 'ZERO',
  MARQUIS: 'MARQUIS',
  BERSERKER: 'BERSERKER',
  ACROBAT: 'ACROBAT',
  SNIPER: 'SNIPER',
};

/** Non-gun weapon labels the overlay shows verbatim. */
const WEAPON_LABELS: Record<string, string> = {
  UNARMED: 'FISTS',
  KATANA: 'KATANA',
  KNIFE: 'KNIFE',
  SIDEARM: 'SIDEARM',
  EXPLOSIVE_BARREL: 'EXPLOSIVE BARREL',
  THROWN_BODY: 'THROWN BODY',
  FALL: 'FALL',
  ENVIRONMENT: 'ENVIRONMENT',
};

/** Human label for any weapon id the engine passes around. */
export function weaponLabel(weaponId: string): string {
  if (!weaponId) return 'UNARMED';
  const gun = GUNS[weaponId as GunId];
  if (gun) return gun.name;
  return WEAPON_LABELS[weaponId] ?? weaponId;
}

export function enemyDisplayName(type: EnemyType): string {
  return ENEMY_NAMES[type] ?? 'ENFORCER';
}

/**
 * Weapon an archetype is credited with: the two gunners fire real rounds,
 * everyone else lands bare-handed blows. One table, no per-site guessing.
 */
export function enemyWeaponId(type: EnemyType): string {
  if (type === 'SNIPER') return 'RIFLE';
  if (type === 'GUNNER') return 'SIDEARM';
  return 'UNARMED';
}

// ------------------------------------------------------- attack context

interface AttackContext {
  type: EliminationType;
  attackerId: string;
  attackerName: string;
  weaponId: string;
  /** World position of the attacker / muzzle this frame. */
  x: number;
  y: number;
  bodyPart: HitBodyPart;
}

/**
 * Positional record of the attack in flight. Defaults credit the player with
 * bare hands, so a missed `resetAttackContext()` still attributes sensibly
 * (worst case the label says FISTS instead of the right gun).
 */
const ctx: AttackContext = {
  type: 'MELEE',
  attackerId: PLAYER_ID,
  attackerName: PLAYER_NAME,
  weaponId: 'UNARMED',
  x: 0,
  y: 0,
  bodyPart: 'NONE',
};

/**
 * Call immediately BEFORE a damage call. All arguments are primitives — no
 * object is created on the hot path.
 *
 * @param x,y attacker/muzzle world position (used for distance + framing).
 */
export function setAttackContext(
  type: EliminationType,
  attackerId: string,
  attackerName: string,
  weaponId: string,
  x: number,
  y: number,
  bodyPart: HitBodyPart = 'NONE'
): void {
  ctx.type = type;
  ctx.attackerId = attackerId;
  ctx.attackerName = attackerName;
  ctx.weaponId = weaponId;
  ctx.x = x;
  ctx.y = y;
  ctx.bodyPart = bodyPart;
}

/** Shorthand for the overwhelmingly common "the player did it" case. */
export function setPlayerAttackContext(
  type: EliminationType,
  weaponId: string,
  x: number,
  y: number,
  bodyPart: HitBodyPart = 'NONE'
): void {
  setAttackContext(type, PLAYER_ID, PLAYER_NAME, weaponId, x, y, bodyPart);
}

/** Restores the neutral context. CombatDirector calls this once per update. */
export function resetAttackContext(): void {
  ctx.type = 'MELEE';
  ctx.attackerId = PLAYER_ID;
  ctx.attackerName = PLAYER_NAME;
  ctx.weaponId = 'UNARMED';
  ctx.x = 0;
  ctx.y = 0;
  ctx.bodyPart = 'NONE';
}

/** Read-only view for tests/diagnostics — do not mutate. */
export function getAttackContext(): Readonly<AttackContext> {
  return ctx;
}

/**
 * Timestamps a landed blow into the replay window using the live attack
 * context (attacker slot, weapon, body part) and the victim's identity.
 * Called from the two `takeDamage` funnels, so every damage path — melee,
 * rounds, chip — lands exactly one marker without touching each call site.
 */
export function recordDamageEvent(
  victimId: string,
  victimName: string,
  victimKind: 'player' | 'enemy',
  victimX: number,
  victimY: number,
  amount: number,
  victimType?: EnemyType
): void {
  if (amount <= 0) return;
  replayBuffer.recordDamage(
    replayBuffer.slotOf(ctx.attackerId),
    replayBuffer.slotFor(victimId, victimName, victimKind, victimType),
    ctx.weaponId,
    amount,
    ctx.bodyPart,
    victimX,
    victimY
  );
}

// --------------------------------------------------------- resolution

/** Structural shape — accepts EnemyController without importing it. */
export interface EnemyVictim {
  id: string;
  type: EnemyType;
  position: { x: number; y: number };
  health: number;
}

const ring: EliminationRecord[] = [];
let ringStart = 0;
let ringCount = 0;
let lastPlayerDeath: EliminationRecord | null = null;
let lastElimination: EliminationRecord | null = null;

/**
 * Builds + stores the record for a lethal blow against the player.
 * Call from `PlayerController.takeDamage` only when health reached 0.
 *
 * @param taken damage that actually landed after mitigation.
 * @returns the record (for tests) or null when nothing lethal happened.
 */
export function resolvePlayerElimination(
  victimName: string,
  victimX: number,
  victimY: number,
  taken: number
): EliminationRecord | null {
  return finish('player', victimName, 'player', victimX, victimY, taken, true, 'BASIC');
}

/**
 * Builds + stores the record for a lethal blow against an enemy.
 * Call from `EnemyController.takeDamage` when `applied > 0 && health <= 0`.
 */
export function resolveEnemyElimination(enemy: EnemyVictim, applied: number): EliminationRecord | null {
  if (applied <= 0 || enemy.health > 0) return null;
  return finish(
    enemy.id,
    enemyDisplayName(enemy.type),
    'enemy',
    enemy.position.x,
    enemy.position.y,
    applied,
    false,
    enemy.type
  );
}

function finish(
  victimId: string,
  victimName: string,
  victimKind: 'player' | 'enemy',
  victimX: number,
  victimY: number,
  amount: number,
  onPlayer: boolean,
  victimType?: EnemyType
): EliminationRecord | null {
  const byPlayer = ctx.attackerId === PLAYER_ID;
  const dx = ctx.x - victimX;
  const dy = ctx.y - victimY;
  // Straight-line range between the recorded strike origin and the victim.
  // An environment kill has no attacker, but its blast origin is stamped too,
  // so the number still reads honestly instead of collapsing to zero.
  const distancePx = Math.sqrt(dx * dx + dy * dy);
  const victimSlot = replayBuffer.slotFor(victimId, victimName, victimKind, victimType);
  const record: EliminationRecord = {
    victimId,
    victimName,
    killerId: ctx.attackerId,
    killerName: ctx.attackerName,
    killerSlot: replayBuffer.slotOf(ctx.attackerId),
    weaponId: ctx.weaponId,
    weaponName: weaponLabel(ctx.weaponId),
    distancePx,
    distanceM: distancePx / PX_PER_METER,
    type: ctx.type,
    bodyPart: ctx.bodyPart,
    amount,
    timestamp: replayBuffer.now(),
    killerX: ctx.x,
    killerY: ctx.y,
    lethalX: victimX,
    lethalY: victimY,
    byPlayer,
    onPlayer,
  };
  // A spread can land a second lethal-looking blow on the same corpse within
  // one frame — one victim yields exactly one record and one replay marker.
  if (
    lastElimination &&
    lastElimination.victimId === victimId &&
    record.timestamp - lastElimination.timestamp < 0.25
  ) {
    return lastElimination;
  }
  pushRecord(record);
  // The replay window carries the marker too, so playback can time flashes /
  // SFX and the overlay can pull identity from the same stream.
  replayBuffer.recordElimination(
    record.killerSlot,
    victimSlot,
    record.type,
    record.amount,
    record.weaponId,
    record.lethalX,
    record.lethalY
  );
  lastElimination = record;
  if (onPlayer) lastPlayerDeath = record;
  return record;
}

function pushRecord(record: EliminationRecord): void {
  if (ring.length < RECORD_RING) {
    ring.push(record);
    ringStart = 0;
    ringCount = ring.length;
    return;
  }
  ring[ringStart] = record;
  ringStart = (ringStart + 1) % RECORD_RING;
  ringCount = RECORD_RING;
}

/** Most recent record in the ring (newest first), else null. */
export function latestElimination(): EliminationRecord | null {
  if (ringCount === 0) return null;
  const idx = (ringStart + RECORD_RING - 1) % RECORD_RING;
  return ring[idx] ?? null;
}

/** Most recent death OF THE PLAYER — the record the Death Cam plays back. */
export function latestPlayerDeath(): EliminationRecord | null {
  return lastPlayerDeath;
}

/** Ring records, newest first, up to `max`. */
export function recentEliminations(max: number = RECORD_RING): EliminationRecord[] {
  const out: EliminationRecord[] = [];
  for (let i = 0; i < Math.min(max, ringCount); i++) {
    const idx = (ringStart + RECORD_RING - 1 - i) % RECORD_RING;
    const rec = ring[idx];
    if (rec) out.push(rec);
  }
  return out;
}

export function eliminationCount(): number {
  return ringCount;
}

/** Fresh run: drops history (GameLoop.fullReset calls this). */
export function clearEliminations(): void {
  ring.length = 0;
  ringStart = 0;
  ringCount = 0;
  lastPlayerDeath = null;
  lastElimination = null;
  resetAttackContext();
}

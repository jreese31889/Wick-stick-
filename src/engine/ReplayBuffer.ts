/**
 * DEATH CAM — rolling replay buffer (the recorder half).
 *
 * Owner spec §1: a fixed-size circular buffer holding the final ~8 seconds of
 * a run at ~15 Hz, plus timestamped event markers. Everything needed to
 * re-render the moments before a death — actor transforms/facing, animation
 * state ids + phase, weapon state, in-flight projectiles, camera pose and the
 * damage/shot/elimination trail — is written into ONE preallocated
 * ArrayBuffer at record time, so the hot loop never allocates and the whole
 * feature has a hard, documented byte ceiling (see REPLAY_BYTE_BUDGET).
 *
 * This module is deliberately engine-agnostic: it imports no game classes at
 * runtime (only `import type`), so both the local recorder and a future
 * authoritative server stream can satisfy the same `ReplaySource` contract
 * that the Death Cam player consumes. No networking code lives here.
 *
 * Byte budget (documented, asserted by the smoke suite):
 *   snapshot ring : 122 slots x 1170 B = 142 740 B
 *   event ring    :  96 events x 20 B  =   1 920 B
 *   actor identity + state/weapon string tables (references, ≤ ~4 KiB)
 *   ---------------------------------------------------------------
 *   hard cap      : REPLAY_BYTE_BUDGET = 160 KiB (well under Android budget)
 */

import type { EnemyType, EliminationType, HitBodyPart } from '../types/game';

// ---------------------------------------------------------------- constants

/** Snapshot cadence. 15 Hz keeps 8 s of history inside a ~140 KB ring. */
export const REPLAY_HZ = 15;
/** Length of the rolling window, seconds. */
export const REPLAY_SECONDS = 8;
/** Ring slots = window + 2 so wraparound never eats the newest frame. */
export const REPLAY_SNAPSHOT_SLOTS = Math.ceil(REPLAY_HZ * REPLAY_SECONDS) + 2;
/** Player + up to 15 concurrent hostiles (spawn squads peak well below). */
export const REPLAY_MAX_ACTORS = 16;
/** Enemy rounds + thrown blades in flight at once (pools cap at 64 + 32). */
export const REPLAY_MAX_PROJECTILES = 40;
/** Damage / shot / elimination markers kept in the window. */
export const REPLAY_MAX_EVENTS = 96;
/** Documented hard ceiling for the whole recorder (ring + events + tables). */
export const REPLAY_BYTE_BUDGET = 160 * 1024;
/** String interning tables (animation states, weapon ids). */
const STATE_TABLE_SIZE = 128;
const WEAPON_TABLE_SIZE = 64;

/** Snapshot record layout (DataView, no alignment requirements). */
const SNAPSHOT_HEADER = 18; // time, camX, camY, camZoom, counts
const ACTOR_STRIDE = 28; // x,y,vx,vy,stateTimer + stateId + weaponId + hp + flags + idSlot
const PROJECTILE_STRIDE = 18; // x,y,vx,vy + type + ownerSlot
const ACTORS_OFFSET = SNAPSHOT_HEADER;
const PROJECTILES_OFFSET = SNAPSHOT_HEADER + REPLAY_MAX_ACTORS * ACTOR_STRIDE;
const SNAPSHOT_STRIDE = PROJECTILES_OFFSET + REPLAY_MAX_PROJECTILES * PROJECTILE_STRIDE;

/** Event record layout: time, kind, slots, aux, amount, weaponId, x, y. */
const EVENT_STRIDE = 20;

/** Snapshot event kinds (stored in the event ring). */
export const REPLAY_EVENT_DAMAGE = 1;
export const REPLAY_EVENT_SHOT = 2;
export const REPLAY_EVENT_ELIMINATION = 3;

/** Projectile kinds recorded per snapshot. */
export const REPLAY_PROJ_BULLET = 0;
export const REPLAY_PROJ_KNIFE = 1;
export const REPLAY_PROJ_BLADE = 2;

/** Actor flag bits inside the snapshot record. */
const FLAG_FACING = 1;
const FLAG_ALIVE = 2;
const FLAG_AIMING = 4;
const FLAG_RECOIL = 8;
/** Feet on the floor — the replay's pose driver needs it to plant the gait. */
const FLAG_GROUNDED = 16;

/** Slot sentinel used when an actor id is not in the window. */
export const REPLAY_NO_SLOT = 255;

// ------------------------------------------------------------------- views

export interface ReplayActorState {
  slot: number;
  id: string;
  name: string;
  kind: 'player' | 'enemy';
  x: number;
  y: number;
  vx: number;
  vy: number;
  facingRight: boolean;
  /** Resolved animation/action state string (interned id at record time). */
  state: string;
  /** Phase within the state (seconds), recorded verbatim. */
  stateTimer: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  aiming: boolean;
  recoil: boolean;
  grounded: boolean;
  weapon: string;
}

export interface ReplayProjectileState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: number;
  ownerSlot: number;
}

/**
 * One interpolated frame of history. Reused (never reallocated) so the
 * consumer can hold it across frames without touching the heap.
 */
export interface ReplaySample {
  time: number;
  camX: number;
  camY: number;
  camZoom: number;
  actors: ReplayActorState[];
  actorCount: number;
  projectiles: ReplayProjectileState[];
  projectileCount: number;
}

export interface ReplayEvent {
  time: number;
  kind: number;
  actorSlot: number;
  targetSlot: number;
  /** bodyPart index for DAMAGE, EliminationType index for ELIMINATION. */
  aux: number;
  amount: number;
  weaponId: number;
  x: number;
  y: number;
}

export interface ReplayActorInfo {
  id: string;
  name: string;
  kind: 'player' | 'enemy';
  /**
   * Archetype the actor was recorded as ('BASIC' for the player). Recorded
   * once when the slot is claimed so the playback side can pick a silhouette
   * even after the live body is gone — cosmetic only, never simulation truth.
   */
  type: EnemyType;
}

/** EliminationType → small integer for the event ring (index into this list). */
export const ELIMINATION_TYPE_ORDER: EliminationType[] = [
  'SHOT',
  'MELEE',
  'TAKEDOWN',
  'EXECUTION',
  'ENVIRONMENT',
  'EXPLOSION',
  'FALL',
];
export const HIT_BODY_PART_ORDER: HitBodyPart[] = ['NONE', 'HEAD', 'TORSO', 'LIMB'];

/**
 * THE clean seam between "where history comes from" and "who plays it back"
 * (spec §8). Today the local ReplayBuffer implements it; an authoritative
 * server would push the same snapshot/event shape over the wire into another
 * implementation, and the Death Cam player would consume it unchanged.
 */
export interface ReplaySource {
  /** Snapshot slots available (≤ capacity). */
  readonly count: number;
  readonly capacity: number;
  /** Clock of the oldest / newest snapshot in the window (seconds). */
  readonly startTime: number;
  readonly endTime: number;
  /** True when the window covers at least `seconds` of history. */
  covers(seconds: number): boolean;
  /** Interpolated read of the window at time `t` (clamped to the window). */
  sampleAt(t: number, out: ReplaySample): boolean;
  /** Rewind the event cursor to the first event at/after `t`. */
  seekEvents(t: number): void;
  /** Next event with time ≤ `t` (in time order), else false. */
  nextEvent(t: number, out: ReplayEvent): boolean;
  /** Identity table entry for an actor slot (stable across the window). */
  actorInfo(slot: number): ReplayActorInfo;
  /** Slot an id currently occupies, or REPLAY_NO_SLOT. */
  slotOf(id: string): number;
  /** Weapon string for an interned id ('' when unknown) — replay SFX mapping. */
  weaponAt(id: number): string;
}

/** Allocates the reusable sample view a consumer passes into `sampleAt`. */
export function makeReplaySample(): ReplaySample {
  const actors: ReplayActorState[] = [];
  for (let i = 0; i < REPLAY_MAX_ACTORS; i++) {
    actors.push({
      slot: i,
      id: '',
      name: '',
      kind: 'enemy',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      facingRight: true,
      state: 'IDLE',
      stateTimer: 0,
      health: 0,
      maxHealth: 0,
      alive: false,
      aiming: false,
      recoil: false,
      grounded: true,
      weapon: 'UNARMED',
    });
  }
  const projectiles: ReplayProjectileState[] = [];
  for (let i = 0; i < REPLAY_MAX_PROJECTILES; i++) {
    projectiles.push({ x: 0, y: 0, vx: 0, vy: 0, kind: 0, ownerSlot: REPLAY_NO_SLOT });
  }
  return { time: 0, camX: 0, camY: 0, camZoom: 1, actors, actorCount: 0, projectiles, projectileCount: 0 };
}

/** Allocates the reusable event view (a fixed pool of `size` entries). */
export function makeReplayEvents(size: number): ReplayEvent[] {
  const out: ReplayEvent[] = [];
  for (let i = 0; i < size; i++) {
    out.push({ time: 0, kind: 0, actorSlot: 0, targetSlot: 0, aux: 0, amount: 0, weaponId: 0, x: 0, y: 0 });
  }
  return out;
}

export interface ReplayBufferOptions {
  /** Snapshot slots (default REPLAY_SNAPSHOT_SLOTS). */
  slots?: number;
  /** Capture rate in Hz (default REPLAY_HZ). */
  hz?: number;
  /** Window length in seconds (default REPLAY_SECONDS). */
  seconds?: number;
  maxActors?: number;
  maxProjectiles?: number;
  maxEvents?: number;
}

// ------------------------------------------------------------------ buffer

export class ReplayBuffer implements ReplaySource {
  public readonly slots: number;
  public readonly hz: number;
  public readonly seconds: number;
  public readonly maxActors: number;
  public readonly maxProjectiles: number;
  public readonly maxEvents: number;

  /** One contiguous allocation for every snapshot in the ring. */
  private readonly ring: ArrayBuffer;
  private readonly view: DataView;
  /** One contiguous allocation for the event ring. */
  private readonly eventBuf: ArrayBuffer;
  private readonly eventView: DataView;

  /** Monotonic snapshot sequence (slot = seq % slots). */
  private snapshotSeq = 0;
  private snapshotsWritten = 0;
  /** Monotonic event sequence (slot = seq % maxEvents). */
  private eventSeq = 0;
  private eventsWritten = 0;
  /** Event cursor in sequence space (for ReplaySource.nextEvent). */
  private eventCursor = 0;

  /** Stream clock, seconds. Advanced once per frame by GameLoop. */
  private clock = 0;

  /** Actor identity table (strings referenced, never copied per capture). */
  private readonly infos: ReplayActorInfo[] = [];
  /** Interning tables: id → index. */
  private readonly states: string[] = [];
  private readonly weapons: string[] = [];
  private stateCount = 0;
  private weaponCount = 0;
  /** Per-slot last interned ids so the common path is an O(1) reference check. */
  private readonly lastStateId: number[] = [];
  private readonly lastWeaponId: number[] = [];
  /** Marks which slots were written by the current snapshot (prune support). */
  private readonly seen: boolean[] = [];
  private readonly misses: number[] = [];

  /** Payload written by the current snapshot (flat, reused). */
  private curTime = 0;
  private curCamX = 0;
  private curCamY = 0;
  private curCamZoom = 1;
  private curActorCount = 0;
  private curProjectileCount = 0;
  private curSlot = 0; // cursor into the actor region
  private curProjSlot = 0;
  private capturing = false;

  constructor(options: ReplayBufferOptions = {}) {
    this.hz = options.hz ?? REPLAY_HZ;
    this.seconds = options.seconds ?? REPLAY_SECONDS;
    this.slots = options.slots ?? Math.ceil(this.hz * this.seconds) + 2;
    this.maxActors = options.maxActors ?? REPLAY_MAX_ACTORS;
    this.maxProjectiles = options.maxProjectiles ?? REPLAY_MAX_PROJECTILES;
    this.maxEvents = options.maxEvents ?? REPLAY_MAX_EVENTS;

    this.ring = new ArrayBuffer(this.slots * SNAPSHOT_STRIDE);
    this.view = new DataView(this.ring);
    this.eventBuf = new ArrayBuffer(this.maxEvents * EVENT_STRIDE);
    this.eventView = new DataView(this.eventBuf);

    for (let i = 0; i < this.maxActors; i++) {
      this.infos.push({ id: '', name: '', kind: 'enemy', type: 'BASIC' });
      this.lastStateId.push(-1);
      this.lastWeaponId.push(-1);
      this.seen.push(false);
      this.misses.push(0);
    }
    // Slot 0 is always the player (spec: fixed identity across the window).
    this.infos[0] = { id: 'player', name: 'JOHN STICK', kind: 'player', type: 'BASIC' };
    this.seen[0] = true;
  }

  /** Bytes held by the two rings — the test asserts this stays under budget. */
  public get byteLength(): number {
    return this.ring.byteLength + this.eventBuf.byteLength;
  }

  public get count(): number {
    return this.snapshotsWritten;
  }

  public get capacity(): number {
    return this.slots;
  }

  public get startTime(): number {
    if (this.snapshotsWritten === 0) return 0;
    const first = Math.max(0, this.snapshotSeq - this.snapshotsWritten);
    return this.readTime(first);
  }

  public get endTime(): number {
    if (this.snapshotsWritten === 0) return 0;
    return this.readTime(this.snapshotSeq - 1);
  }

  /** Stream clock (seconds) — the timestamp every record uses. */
  public now(): number {
    return this.clock;
  }

  /** Advance the stream clock. Call once per frame, before combat resolves. */
  public advance(dt: number): void {
    this.clock += dt;
  }

  /** Drops all history and rewinds the clock (fresh run). */
  public clear(): void {
    this.snapshotSeq = 0;
    this.snapshotsWritten = 0;
    this.eventSeq = 0;
    this.eventsWritten = 0;
    this.eventCursor = 0;
    this.clock = 0;
    for (let i = 0; i < this.maxActors; i++) {
      this.seen[i] = i === 0;
      this.misses[i] = 0;
      this.lastStateId[i] = -1;
      this.lastWeaponId[i] = -1;
      if (i > 0) {
        this.infos[i].id = '';
        this.infos[i].name = '';
        this.infos[i].kind = 'enemy';
        this.infos[i].type = 'BASIC';
      }
    }
  }

  // ------------------------------------------------------------ slot mapping

  /**
   * Resolves (claiming on first sight) the actor slot for an id. Linear scan
   * over ≤16 entries, no allocation; unknown ids beyond the cap return -1 and
   * the actor is simply not recorded (documented cap, squads never hit it).
   *
   * `type` is recorded the first time a slot is claimed (archetype silhouette
   * for playback) and is never rewritten while the slot is held.
   */
  public slotFor(id: string, name: string, kind: 'player' | 'enemy', type?: EnemyType): number {
    // An empty id is "unattributed" (a barrel blast, the environment): it
    // must never match a free identity slot, or a random body would inherit it.
    if (!id) return -1;
    for (let i = 0; i < this.maxActors; i++) {
      if (this.infos[i].id === id) return i;
    }
    for (let i = 1; i < this.maxActors; i++) {
      if (this.infos[i].id === '') {
        this.infos[i].id = id;
        this.infos[i].name = name;
        this.infos[i].kind = kind;
        this.infos[i].type = type ?? 'BASIC';
        return i;
      }
    }
    return -1;
  }

  /** Look-up only (never claims): slot currently held by `id`. */
  public slotOf(id: string): number {
    if (!id) return REPLAY_NO_SLOT;
    for (let i = 0; i < this.maxActors; i++) {
      if (this.infos[i].id === id) return i;
    }
    return REPLAY_NO_SLOT;
  }

  public actorInfo(slot: number): ReplayActorInfo {
    return this.infos[slot] ?? this.infos[0];
  }

  // -------------------------------------------------------------- recording

  /** Opens a snapshot at the current clock. */
  public beginSnapshot(camX: number, camY: number, camZoom: number): void {
    this.capturing = true;
    this.curTime = this.clock;
    this.curCamX = camX;
    this.curCamY = camY;
    this.curCamZoom = camZoom;
    this.curActorCount = 0;
    this.curProjectileCount = 0;
    this.curSlot = 0;
    this.curProjSlot = 0;
    for (let i = 0; i < this.maxActors; i++) this.seen[i] = false;
  }

  /**
   * Writes one actor record. All values are primitives — no object is built,
   * so a capture costs zero allocations regardless of squad size.
   */
  public writeActor(
    slot: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    facingRight: boolean,
    state: string,
    stateTimer: number,
    health: number,
    maxHealth: number,
    alive: boolean,
    aiming: boolean,
    recoil: boolean,
    grounded: boolean,
    weapon: string
  ): void {
    if (!this.capturing || slot < 0 || slot >= this.maxActors || this.curSlot >= this.maxActors) return;
    const base = (this.snapshotSeq % this.slots) * SNAPSHOT_STRIDE + ACTORS_OFFSET + this.curSlot * ACTOR_STRIDE;
    const stateId = this.internState(slot, state);
    const weaponId = this.internWeapon(slot, weapon);
    let flags = 0;
    if (facingRight) flags |= FLAG_FACING;
    if (alive) flags |= FLAG_ALIVE;
    if (aiming) flags |= FLAG_AIMING;
    if (recoil) flags |= FLAG_RECOIL;
    if (grounded) flags |= FLAG_GROUNDED;
    this.view.setFloat32(base + 0, x, true);
    this.view.setFloat32(base + 4, y, true);
    this.view.setFloat32(base + 8, vx, true);
    this.view.setFloat32(base + 12, vy, true);
    this.view.setFloat32(base + 16, stateTimer, true);
    this.view.setUint16(base + 20, stateId, true);
    this.view.setUint16(base + 22, weaponId, true);
    this.view.setUint8(base + 24, Math.max(0, Math.min(255, Math.round(health))));
    this.view.setUint8(base + 25, Math.max(0, Math.min(255, Math.round(maxHealth))));
    this.view.setUint8(base + 26, flags);
    // Identity back-reference: a snapshot slot is written in *encounter* order,
    // so playback needs the identity slot to read names/kinds back correctly
    // (and to tell a pruned hole from a live actor).
    this.view.setUint8(base + 27, slot);
    // Identity read-back path: the writer records which slots this frame owns.
    this.seen[slot] = true;
    this.curSlot++;
    this.curActorCount = Math.max(this.curActorCount, this.curSlot);
  }

  public writeProjectile(x: number, y: number, vx: number, vy: number, kind: number, ownerSlot: number): void {
    if (!this.capturing || this.curProjSlot >= this.maxProjectiles) return;
    const base =
      (this.snapshotSeq % this.slots) * SNAPSHOT_STRIDE + PROJECTILES_OFFSET + this.curProjSlot * PROJECTILE_STRIDE;
    this.view.setFloat32(base + 0, x, true);
    this.view.setFloat32(base + 4, y, true);
    this.view.setFloat32(base + 8, vx, true);
    this.view.setFloat32(base + 12, vy, true);
    this.view.setUint8(base + 16, kind);
    this.view.setUint8(base + 17, ownerSlot < 0 || ownerSlot >= this.maxActors ? REPLAY_NO_SLOT : ownerSlot);
    this.curProjSlot++;
    this.curProjectileCount = this.curProjSlot;
  }

  /** Commits the snapshot and prunes actor slots nobody wrote this frame. */
  public endSnapshot(): void {
    if (!this.capturing) return;
    this.capturing = false;
    const base = (this.snapshotSeq % this.slots) * SNAPSHOT_STRIDE;
    this.view.setFloat32(base + 0, this.curTime, true);
    this.view.setFloat32(base + 4, this.curCamX, true);
    this.view.setFloat32(base + 8, this.curCamY, true);
    this.view.setFloat32(base + 12, this.curCamZoom, true);
    this.view.setUint8(base + 16, this.curActorCount);
    this.view.setUint8(base + 17, this.curProjectileCount);
    this.snapshotSeq++;
    if (this.snapshotsWritten < this.slots) this.snapshotsWritten++;

    // Slots nobody wrote this frame are gone from the world; two consecutive
    // misses (≈130 ms at 15 Hz) releases the slot for reuse — allocation-free.
    for (let i = 1; i < this.maxActors; i++) {
      if (this.seen[i]) {
        this.misses[i] = 0;
      } else if (this.infos[i].id !== '') {
        this.misses[i]++;
        if (this.misses[i] >= 2) {
          this.infos[i].id = '';
          this.infos[i].name = '';
          this.infos[i].kind = 'enemy';
          this.infos[i].type = 'BASIC';
          this.lastStateId[i] = -1;
          this.lastWeaponId[i] = -1;
          this.misses[i] = 0;
        }
      }
    }
    this.seen[0] = true;
  }

  // --------------------------------------------------------------- events

  /** Damage marker (attacker, weapon, amount, body part, time, position). */
  public recordDamage(
    attackerSlot: number,
    targetSlot: number,
    weapon: string,
    amount: number,
    bodyPart: HitBodyPart,
    x: number,
    y: number
  ): void {
    const aux = HIT_BODY_PART_ORDER.indexOf(bodyPart);
    this.pushEvent(REPLAY_EVENT_DAMAGE, attackerSlot, targetSlot, aux < 0 ? 0 : aux, amount, weapon, x, y);
  }

  /** Muzzle marker: drives replay flashes, tracers and shot SFX sync. */
  public recordShot(attackerSlot: number, weapon: string, x: number, y: number): void {
    this.pushEvent(REPLAY_EVENT_SHOT, attackerSlot, REPLAY_NO_SLOT, 0, 0, weapon, x, y);
  }

  /** Takedown / elimination marker (type rides in `aux`). */
  public recordElimination(
    attackerSlot: number,
    targetSlot: number,
    type: EliminationType,
    amount: number,
    weapon: string,
    x: number,
    y: number
  ): void {
    const aux = ELIMINATION_TYPE_ORDER.indexOf(type);
    this.pushEvent(REPLAY_EVENT_ELIMINATION, attackerSlot, targetSlot, aux < 0 ? 0 : aux, amount, weapon, x, y);
  }

  private pushEvent(
    kind: number,
    actorSlot: number,
    targetSlot: number,
    aux: number,
    amount: number,
    weapon: string,
    x: number,
    y: number
  ): void {
    const slot = this.eventSeq % this.maxEvents;
    const base = slot * EVENT_STRIDE;
    this.eventView.setFloat32(base + 0, this.clock, true);
    this.eventView.setUint8(base + 4, kind);
    this.eventView.setUint8(base + 5, actorSlot < 0 ? REPLAY_NO_SLOT : actorSlot);
    this.eventView.setUint8(base + 6, targetSlot < 0 ? REPLAY_NO_SLOT : targetSlot);
    this.eventView.setUint8(base + 7, aux & 0xff);
    this.eventView.setUint16(base + 8, Math.max(0, Math.min(65535, Math.round(amount))), true);
    this.eventView.setUint16(base + 10, this.internWeapon(-1, weapon), true);
    this.eventView.setFloat32(base + 12, x, true);
    this.eventView.setFloat32(base + 16, y, true);
    this.eventSeq++;
    if (this.eventsWritten < this.maxEvents) this.eventsWritten++;
    // A fresh event invalidates any in-flight cursor that already passed it.
    if (this.eventCursor > this.eventSeq - this.eventsWritten) {
      this.eventCursor = Math.max(0, this.eventSeq - this.eventsWritten);
    }
  }

  /** Earliest event still in the ring (sequence space). */
  private get firstEventSeq(): number {
    return this.eventSeq - this.eventsWritten;
  }

  public seekEvents(t: number): void {
    // First event at/after t, scanned from the oldest surviving entry.
    let seq = this.firstEventSeq;
    const end = this.eventSeq;
    while (seq < end) {
      if (this.readEventTime(seq) >= t) break;
      seq++;
    }
    this.eventCursor = seq;
  }

  public nextEvent(t: number, out: ReplayEvent): boolean {
    if (this.eventCursor >= this.eventSeq) return false;
    const time = this.readEventTime(this.eventCursor);
    if (time > t) return false;
    const base = (this.eventCursor % this.maxEvents) * EVENT_STRIDE;
    out.time = time;
    out.kind = this.eventView.getUint8(base + 4);
    out.actorSlot = this.eventView.getUint8(base + 5);
    out.targetSlot = this.eventView.getUint8(base + 6);
    out.aux = this.eventView.getUint8(base + 7);
    out.amount = this.eventView.getUint16(base + 8, true);
    out.weaponId = this.eventView.getUint16(base + 10, true);
    out.x = this.eventView.getFloat32(base + 12, true);
    out.y = this.eventView.getFloat32(base + 16, true);
    this.eventCursor++;
    return true;
  }

  private readEventTime(seq: number): number {
    return this.eventView.getFloat32((seq % this.maxEvents) * EVENT_STRIDE, true);
  }

  /** Weapon string for an interned id ('' when unknown). */
  public weaponAt(id: number): string {
    return this.weapons[id] ?? '';
  }

  public get eventCount(): number {
    return this.eventsWritten;
  }

  // ------------------------------------------------------------- sampling

  public covers(seconds: number): boolean {
    if (this.snapshotsWritten < 2) return false;
    return this.endTime - this.startTime >= seconds;
  }

  private readTime(seq: number): number {
    return this.view.getFloat32((seq % this.slots) * SNAPSHOT_STRIDE, true);
  }

  /**
   * Interpolated read at `t`. Positions/velocity lerp between the two
   * bracketing snapshots; state + phase come from the later one (a state
   * change is discrete — lerping across it would ghost two poses together).
   */
  public sampleAt(t: number, out: ReplaySample): boolean {
    if (this.snapshotsWritten === 0) return false;
    const oldest = Math.max(0, this.snapshotSeq - this.snapshotsWritten);
    const newest = this.snapshotSeq - 1;
    let a = oldest;
    let b = newest;
    // Walk the (≤ slots) window to find the bracketing pair — 122 max, cheap.
    for (let seq = oldest; seq < newest; seq++) {
      if (this.readTime(seq) <= t) {
        a = seq;
        b = seq + 1;
      } else {
        break;
      }
    }
    const ta = this.readTime(a);
    const tb = this.readTime(b);
    const span = tb - ta;
    const alpha = span > 1e-6 ? Math.max(0, Math.min(1, (t - ta) / span)) : 0;
    this.fillSample(a, b, alpha, out);
    return true;
  }

  private fillSample(aSeq: number, bSeq: number, alpha: number, out: ReplaySample): void {
    const aBase = (aSeq % this.slots) * SNAPSHOT_STRIDE;
    const bBase = (bSeq % this.slots) * SNAPSHOT_STRIDE;
    out.time = this.view.getFloat32(aBase, true) + alpha * (this.view.getFloat32(bBase, true) - this.view.getFloat32(aBase, true));
    out.camX = this.view.getFloat32(aBase + 4, true) + alpha * (this.view.getFloat32(bBase + 4, true) - this.view.getFloat32(aBase + 4, true));
    out.camY = this.view.getFloat32(aBase + 8, true) + alpha * (this.view.getFloat32(bBase + 8, true) - this.view.getFloat32(aBase + 8, true));
    out.camZoom = this.view.getFloat32(aBase + 12, true) + alpha * (this.view.getFloat32(bBase + 12, true) - this.view.getFloat32(aBase + 12, true));

    const count = this.view.getUint8(aBase + 16);
    out.actorCount = count;
    for (let i = 0; i < count; i++) {
      const ao = aBase + ACTORS_OFFSET + i * ACTOR_STRIDE;
      const bo = bBase + ACTORS_OFFSET + i * ACTOR_STRIDE;
      const actor = out.actors[i];
      // Identity slot recorded at write time — never the loop index, because a
      // snapshot is written in encounter order and holes may be pruned.
      const idSlot = this.view.getUint8(ao + 27);
      const info = this.infos[idSlot] ?? this.infos[0];
      actor.slot = idSlot;
      actor.x = this.lerpF(ao, bo, 0, alpha);
      actor.y = this.lerpF(ao, bo, 4, alpha);
      actor.vx = this.lerpF(ao, bo, 8, alpha);
      actor.vy = this.lerpF(ao, bo, 12, alpha);
      actor.stateTimer = this.lerpF(ao, bo, 16, alpha);
      const stateId = this.view.getUint16(ao + 20, true);
      const bStateId = this.view.getUint16(bo + 20, true);
      const pickState = alpha > 0.5 ? bStateId : stateId;
      const weaponId = this.view.getUint16(ao + 22, true);
      const flags = this.view.getUint8(ao + 26);
      actor.state = this.states[pickState] ?? 'IDLE';
      actor.weapon = this.weapons[weaponId] ?? 'UNARMED';
      actor.health = this.view.getUint8(ao + 24);
      actor.maxHealth = this.view.getUint8(ao + 25);
      actor.facingRight = (flags & FLAG_FACING) !== 0;
      actor.alive = (flags & FLAG_ALIVE) !== 0;
      actor.aiming = (flags & FLAG_AIMING) !== 0;
      actor.recoil = (flags & FLAG_RECOIL) !== 0;
      actor.grounded = (flags & FLAG_GROUNDED) !== 0;
      actor.id = info.id;
      actor.name = info.name;
      actor.kind = info.kind;
    }

    const projCount = this.view.getUint8(bBase + 17);
    out.projectileCount = projCount;
    for (let i = 0; i < projCount; i++) {
      const bo = bBase + PROJECTILES_OFFSET + i * PROJECTILE_STRIDE;
      const proj = out.projectiles[i];
      proj.x = this.view.getFloat32(bo + 0, true);
      proj.y = this.view.getFloat32(bo + 4, true);
      proj.vx = this.view.getFloat32(bo + 8, true);
      proj.vy = this.view.getFloat32(bo + 12, true);
      proj.kind = this.view.getUint8(bo + 16);
      proj.ownerSlot = this.view.getUint8(bo + 17);
    }
  }

  private lerpF(ao: number, bo: number, off: number, alpha: number): number {
    const a = this.view.getFloat32(ao + off, true);
    return a + alpha * (this.view.getFloat32(bo + off, true) - a);
  }

  // ------------------------------------------------------------ interning

  private internState(slot: number, state: string): number {
    if (slot >= 0 && this.lastStateId[slot] >= 0 && this.states[this.lastStateId[slot]] === state) {
      return this.lastStateId[slot];
    }
    let id = -1;
    for (let i = 0; i < this.stateCount; i++) {
      if (this.states[i] === state) {
        id = i;
        break;
      }
    }
    if (id < 0) {
      if (this.stateCount >= STATE_TABLE_SIZE) return 0; // table full → 'IDLE' slot
      id = this.stateCount++;
      this.states[id] = state;
    }
    if (slot >= 0) this.lastStateId[slot] = id;
    return id;
  }

  private internWeapon(slot: number, weapon: string): number {
    if (slot >= 0 && this.lastWeaponId[slot] >= 0 && this.weapons[this.lastWeaponId[slot]] === weapon) {
      return this.lastWeaponId[slot];
    }
    let id = -1;
    for (let i = 0; i < this.weaponCount; i++) {
      if (this.weapons[i] === weapon) {
        id = i;
        break;
      }
    }
    if (id < 0) {
      if (this.weaponCount >= WEAPON_TABLE_SIZE) return 0;
      id = this.weaponCount++;
      this.weapons[id] = weapon;
    }
    if (slot >= 0) this.lastWeaponId[slot] = id;
    return id;
  }
}

/**
 * The local recorder instance. It is the ReplaySource the Death Cam consumes
 * today; a server-fed implementation would be swapped in behind the same
 * interface without touching the player, the overlay or the camera modes.
 */
export const replayBuffer = new ReplayBuffer();

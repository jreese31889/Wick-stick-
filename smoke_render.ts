/**
 * Headless render smoke test — no DOM, no GPU, no audio.
 *
 *   npx tsx smoke_render.ts     (exit code 0 = all green)
 *
 * Guards the character-design contract (OWNER 2026-10-03) and the rig render
 * path that no combat test exercises:
 *   R1  StickRig draws every animation state / facing / weapon with only
 *       finite geometry, and always applies the FIGURE_SCALE silhouette
 *       transform (bigger readable silhouette, feet stay planted).
 *   R2  The necktie cloth sim stays finite under aggressive movement and is
 *       still rendered (the player's ONE garment).
 *   R3  EnemyRig still draws its suited silhouette + status overhead without
 *       throwing (enemies stay visually distinct from the plain player).
 *   R4  Ragdoll render accepts the player silhouette scale (kill-cam matches
 *       the live rig) and the plain figure never asks for suit-era palette
 *       fields it no longer draws.
 */
import { AnimationController, POSE_JOINTS } from './src/engine/AnimationController';
import { EnemyRig } from './src/engine/EnemyRig';
import { FIGURE_SCALE, StickRig } from './src/engine/StickRig';
import { PLAYER_STYLE } from './src/engine/Palettes';
import { Ragdoll } from './src/engine/Ragdoll';
import type { AnimationState, StickFigurePose } from './src/types/game';
import type { EnemyController } from './src/engine/EnemyController';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

/** Ops issued by a render + any non-finite number seen along the way. */
interface OpLog {
  ops: number;
  scaled: number;
  scaleFactors: number[];
  bad: string[];
}

function isFiniteDeep(args: unknown[]): boolean {
  return args.every((a) => {
    if (typeof a === 'number') return Number.isFinite(a);
    if (typeof a === 'string') return true;
    if (Array.isArray(a)) return isFiniteDeep(a);
    return a === null || a === undefined || typeof a === 'object';
  });
}

/**
 * Minimal CanvasRenderingContext2D stand-in: records every call, flags
 * NaN/Infinity coordinates (the classic pose-poisoning bug) and returns a
 * usable gradient object from the create*Gradient factories.
 */
function makeCtx(log: OpLog): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined };
  const state: Record<string | symbol, unknown> = {};
  return new Proxy(state, {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        log.ops++;
        if (!isFiniteDeep(args)) {
          log.bad.push(`${String(prop)}(${args.map(String).join(', ')})`);
        }
        if (prop === 'scale') {
          log.scaled++;
          log.scaleFactors.push(args[0] as number);
        }
        if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
          return gradient;
        }
        return undefined;
      };
    },
    set(target, prop, value) {
      if (
        typeof prop === 'string' &&
        (prop === 'fillStyle' || prop === 'strokeStyle' || prop === 'lineWidth' ||
          prop === 'globalAlpha' || prop === 'font') &&
        typeof value === 'number' &&
        !Number.isFinite(value)
      ) {
        log.bad.push(`${prop}=${value}`);
      }
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function freshLog(): OpLog {
  return { ops: 0, scaled: 0, scaleFactors: [], bad: [] };
}

const STATES: AnimationState[] = [
  'IDLE', 'WALK', 'RUN', 'JUMP_ASCENT', 'FALL', 'LAND', 'SLIDE', 'DODGE_ROLL',
  'BLOCK', 'ATTACK_LIGHT_1', 'ATTACK_LIGHT_2', 'ATTACK_LIGHT_3', 'ATTACK_HEAVY',
  'ATTACK_KICK', 'ATTACK_SWEEP', 'ATTACK_FLYING_KICK', 'ATTACK_GUN_SHOT',
  'ATTACK_SPECIAL', 'ATTACK_SUPER', 'HURT', 'KNOCKBACK',
];

function allFinite(pose: StickFigurePose): boolean {
  for (const key of POSE_JOINTS) {
    const j = pose[key];
    if (!j || !Number.isFinite(j.x) || !Number.isFinite(j.y)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ R1/R2 */
function testStickRig(): void {
  const rig = new StickRig();
  const anim = new AnimationController();
  const timers = [0, 0.18, 0.42, 0.75];
  let statesDrawn = 0;
  let poseOk = true;
  let tieMoved = false;

  for (const state of STATES) {
    for (const facing of [true, false]) {
      for (const t of timers) {
        const pose = anim.generatePose(state, t, 320, -180, facing, 1 / 60, 0, 0, state !== 'FALL');
        if (!allFinite(pose)) poseOk = false;
        const log = freshLog();
        const ctx = makeCtx(log);
        rig.render(ctx, pose, facing, false, 'KATANA');
        statesDrawn++;
        if (log.bad.length > 0) {
          check(`StickRig ${state} f=${facing} t=${t} finite`, false, log.bad.slice(0, 2).join('; '));
        }
        if (log.scaled === 0 || !log.scaleFactors.includes(FIGURE_SCALE)) {
          check(`StickRig ${state} applies FIGURE_SCALE`, false);
        }
      }
    }
  }
  check('poses stay finite across every animation state', poseOk);
  check(`StickRig drew ${statesDrawn} state/facing/timer combos`, statesDrawn === STATES.length * 2 * timers.length);

  // Ghost + debug paths (afterimage trail, rig overlay)
  const idle = anim.generatePose('IDLE', 0.1, 0, 0, true, 1 / 60, 0, 0);
  for (const [label, ghost, debug, weapon] of [
    ['ghost trail', true, false, 'UNARMED'],
    ['debug overlay', false, true, 'KNIFE'],
    ['unarmed', false, false, 'UNARMED'],
  ] as const) {
    const log = freshLog();
    rig.render(makeCtx(log), idle, true, debug, weapon, ghost);
    check(`StickRig ${label} path renders`, log.ops > 0 && log.bad.length === 0, log.bad[0] ?? '');
  }

  // R2: the tie is the only cloth left — drive the sim hard and keep drawing
  const before = freshLog();
  rig.render(makeCtx(before), idle, true, false, 'UNARMED');
  for (let i = 0; i < 240; i++) {
    rig.updatePhysics(i % 2 ? 900 : -900, i % 3 ? -600 : 400, i % 2 === 0, 1 / 60, 40 + i * 0.5, -120, i % 7 === 0 ? 1 : 0);
    const log = freshLog();
    rig.render(makeCtx(log), idle, i % 2 === 0, false, 'UNARMED');
    if (log.bad.length > 0) {
      check('necktie cloth stays finite under attack flutter', false, log.bad[0]);
      return;
    }
  }
  const after = freshLog();
  rig.render(makeCtx(after), idle, true, false, 'UNARMED');
  check('necktie cloth stays finite under attack flutter', true);
  check('necktie still renders after 240 sim steps', after.ops >= before.ops, `${before.ops} → ${after.ops}`);

  // Character design: the tie colour is the signature red (not skin-swapped)
  check('default tie is the signature red', PLAYER_STYLE.tie.toLowerCase() === '#d92626', PLAYER_STYLE.tie);
}

/* --------------------------------------------------------------------- R3 */
function testEnemyRig(): void {
  const rig = new EnemyRig();
  const anim = new AnimationController();
  const pose = anim.generatePose('ATTACK_HEAVY', 0.2, 120, 0, false, 1 / 60, 120, 0);
  const enemy = {
    pose,
    facingRight: false,
    isStaggered: false,
    ragdoll: undefined,
    health: 42,
    maxHealth: 60,
    ghostHealth: 50,
    lastHitTime: Date.now() - 40,
    hpVisibleTimer: 1.2,
    disarmTimer: 0,
    staggerMeter: 12,
    maxStagger: 100,
    state: 'WINDUP',
    type: 'BASIC',
    eliteVariant: false,
    position: { x: 120, y: 0 },
    suitColor: '#9b3033',
    shirtColor: '#f0d7d7',
    tieColor: '#311013',
    skinColor: '#d8b4a0',
  } as unknown as EnemyController;

  const log = freshLog();
  rig.render(makeCtx(log), enemy, false);
  check('EnemyRig suited silhouette + status overhead renders', log.ops > 0 && log.bad.length === 0, log.bad[0] ?? '');
  // Enemies keep their own footprint — the player-only figure scale never
  // leaks into the enemy draw path.
  check('enemy draw path is not player-scaled', !log.scaleFactors.includes(FIGURE_SCALE));
}

/* --------------------------------------------------------------------- R4 */
function testRagdollScale(): void {
  const anim = new AnimationController();
  const pose = anim.generatePose('KNOCKBACK', 0.1, 0, 0, true, 1 / 60, 0, 0);
  for (const scale of [1, FIGURE_SCALE]) {
    const doll = new Ragdoll(pose, 200, -300);
    for (let i = 0; i < 30; i++) doll.update(1 / 60);
    const log = freshLog();
    doll.render(makeCtx(log), '#f6efdf', '#f6efdf', 'rgba(255, 240, 206, 0.8)', scale);
    check(`ragdoll renders at scale ${scale}`, log.ops > 0 && log.bad.length === 0, log.bad[0] ?? '');
    if (scale !== 1) {
      check('player ragdoll applies the silhouette scale', log.scaleFactors.includes(scale));
    }
  }
}

testStickRig();
testEnemyRig();
testRagdollScale();

if (failures > 0) {
  console.log(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\nALL GREEN');

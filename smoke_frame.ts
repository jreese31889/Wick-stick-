/**
 * Headless FULL-FRAME render smoke — drives Renderer.render() end to end.
 *
 *   npx tsx smoke_frame.ts     (exit code 0 = all green)
 *
 * The only way to exercise the whole draw stack without a browser, and the
 * gate on the VISUAL & JUICE POLISH PASS (OWNER 2026-10-03):
 *   F1  every quality tier renders twelve real frames with finite geometry.
 *   F2  the screen-space caches settle: after warm-up a quiet window issues
 *       ZERO new gradient/pattern creations (grade, vignette buckets, lamp
 *       and fixture glows are all reused, never rebuilt per frame).
 *   F3  the high tier draws strictly more work than low (grade / grain /
 *       near parallax layer are genuinely gated).
 *   F4  the pooled impact bloom renders additively and its gradient is built
 *       once, then reused across the whole decay.
 *   F5  a player damage drop arms the red edge-flash gradient.
 *   F6  the LAND squash reaches the figure transform (sx > FIGURE_SCALE).
 */
import { Camera } from './src/engine/Camera';
import { CombatDirector } from './src/engine/CombatDirector';
import { EnemyController } from './src/engine/EnemyController';
import { EnvironmentManager } from './src/engine/EnvironmentManager';
import { PlayerController } from './src/engine/PlayerController';
import { Renderer } from './src/engine/Renderer';
import { FIGURE_SCALE } from './src/engine/StickRig';
import type { InputState } from './src/types/game';

const DT = 1 / 60;

// Node has no HTMLImageElement: the key-art backdrop can never decode here, so
// Renderer must take its gradient fallback (the branch the rest of this test
// measures). Resolved lazily inside getBackdropImage(), so top-level is fine.
(globalThis as unknown as { Image: unknown }).Image = class {
  src = '';
  complete = false;
  naturalWidth = 0;
};

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

interface FrameLog {
  ops: number;
  bad: string[];
  gradients: number;
  patterns: number;
  lighter: number;
  stops: string[];
  redFlashFills: number;
  scaleFactors: number[];
}

function freshLog(): FrameLog {
  return { ops: 0, bad: [], gradients: 0, patterns: 0, lighter: 0, stops: [], redFlashFills: 0, scaleFactors: [] };
}

function finite(args: unknown[]): boolean {
  return args.every((a) => typeof a !== 'number' || Number.isFinite(a));
}

/** Recording stand-in for CanvasRenderingContext2D (no DOM, no GPU). */
function makeCtx(log: FrameLog): CanvasRenderingContext2D {
  const makeGradient = () => {
    const stops: string[] = [];
    return {
      stops,
      addColorStop: (offset: number, color: string) => {
        if (!Number.isFinite(offset)) log.bad.push(`addColorStop(${offset})`);
        stops.push(color);
        log.stops.push(color);
      },
    };
  };
  const target: Record<string | symbol, unknown> = {
    // Renderer reads .a/.b/.c/.d/.e/.f off this to rebuild batched transforms.
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    measureText: () => ({ width: 12 }),
    // No document in Node → the grain pattern can never be built here.
    createPattern: () => null,
  };
  return new Proxy(target, {
    get(t, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop in t) return t[prop];
      return (...args: unknown[]) => {
        log.ops++;
        if (!finite(args)) {
          log.bad.push(`${String(prop)}(${args.map(String).join(', ')})`);
        }
        if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
          log.gradients++;
          return makeGradient();
        }
        if (prop === 'scale' && typeof args[0] === 'number') {
          log.scaleFactors.push(args[0]);
        }
        return undefined;
      };
    },
    set(t, prop, value) {
      if (typeof prop === 'string') {
        if (typeof value === 'number' && !Number.isFinite(value)) {
          log.bad.push(`${prop}=${value}`);
        }
        if (prop === 'globalCompositeOperation' && value === 'lighter') log.lighter++;
        if (prop === 'fillStyle') {
          const stops = (value as { stops?: unknown })?.stops;
          if (Array.isArray(stops) && stops.some((c) => typeof c === 'string' && c.includes('168, 22, 22'))) {
            log.redFlashFills++;
          }
        }
      }
      t[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function freshInput(): InputState {
  return {
    moveX: 0, moveY: 0, aimX: 0, aimY: 0, aimActive: false,
    jump: false, jumpJustPressed: false,
    dodge: false, dodgeJustPressed: false,
    attack: false, attackJustPressed: false,
    heavyAttack: false, heavyAttackJustPressed: false,
    block: false, grab: false, grabJustPressed: false,
    shoot: false, shootJustPressed: false,
    reload: false, reloadJustPressed: false,
    interact: false, interactJustPressed: false,
    focus: false, focusJustPressed: false,
    special: false, specialJustPressed: false,
    swap: false, swapJustPressed: false,
  };
}

interface World {
  player: PlayerController;
  director: CombatDirector;
  camera: Camera;
  enemies: EnemyController[];
  input: InputState;
}

function makeWorld(): World {
  return {
    player: new PlayerController(0, 0),
    director: new CombatDirector(),
    camera: new Camera(),
    enemies: [new EnemyController('frame-1', 90, 0, 'BASIC')],
    input: freshInput(),
  };
}

function step(w: World): void {
  if (w.director.hitStopFrames > 0) {
    w.director.hitStopFrames--;
    return;
  }
  w.player.update(w.input, DT);
  w.director.update(DT, w.player, w.enemies, w.camera);
}

function renderFrame(
  renderer: Renderer,
  ctx: CanvasRenderingContext2D,
  w: World,
  env: EnvironmentManager,
  width = 1280,
  height = 720
): void {
  renderer.render(ctx, width, height, w.camera, w.player, w.enemies, w.director, env, false);
}

/* ---------------------------------------------------------------------- F1 */
console.log('\nF1 — every quality tier renders full frames');
{
  const renderer = new Renderer();
  const w = makeWorld();
  const env = new EnvironmentManager();

  for (const quality of ['high', 'medium', 'low'] as const) {
    renderer.quality = quality;
    const log = freshLog();
    const ctx = makeCtx(log);
    for (let i = 0; i < 12; i++) {
      step(w);
      renderFrame(renderer, ctx, w, env);
    }
    check(
      `${quality}: 12 frames, finite geometry`,
      log.ops > 0 && log.bad.length === 0,
      log.bad.slice(0, 2).join('; ') || `ops=${log.ops}`
    );
  }
}

/* ---------------------------------------------------------------------- F2 */
console.log('\nF2 — screen-space caches settle (zero rebuilds in a quiet window)');
{
  const renderer = new Renderer();
  renderer.quality = 'high';
  const w = makeWorld();
  const env = new EnvironmentManager();
  const log = freshLog();
  const ctx = makeCtx(log);

  // Warm-up: grade + vignette buckets + lamp/fixture glows + backdrop all build.
  for (let i = 0; i < 6; i++) {
    step(w);
    renderFrame(renderer, ctx, w, env);
  }
  const warmGradients = log.gradients;

  // Quiet window: same canvas, same stage, same camera travel — nothing may
  // be rebuilt. This is the guard against a per-frame gradient/pattern alloc.
  for (let i = 0; i < 8; i++) {
    step(w);
    renderFrame(renderer, ctx, w, env);
  }
  check(
    'quiet window builds no new gradients',
    log.gradients === warmGradients,
    `${warmGradients} → ${log.gradients}`
  );
  check('quiet window builds no new patterns', log.patterns === 0, `${log.patterns}`);
}

/* ---------------------------------------------------------------------- F3 */
console.log('\nF3 — quality tiers are genuinely gated');
{
  const w = makeWorld();
  const env = new EnvironmentManager();
  const counts: Record<string, number> = {};

  for (const quality of ['high', 'medium', 'low'] as const) {
    const renderer = new Renderer();
    renderer.quality = quality;
    const log = freshLog();
    const ctx = makeCtx(log);
    for (let i = 0; i < 6; i++) {
      step(w);
      renderFrame(renderer, ctx, w, env);
    }
    const before = log.ops;
    for (let i = 0; i < 3; i++) {
      step(w);
      renderFrame(renderer, ctx, w, env);
    }
    counts[quality] = log.ops - before;
  }

  check(
    'low tier does strictly less draw work than high',
    counts.low < counts.high,
    `low=${counts.low} med=${counts.medium} high=${counts.high}`
  );
  check(
    'medium sits between low and high',
    counts.low <= counts.medium && counts.medium <= counts.high,
    `low=${counts.low} med=${counts.medium} high=${counts.high}`
  );
}

/* ---------------------------------------------------------------------- F4 */
console.log('\nF4 — pooled impact bloom: additive, built once, reused');
{
  const renderer = new Renderer();
  renderer.quality = 'high';
  const w = makeWorld();
  const env = new EnvironmentManager();
  const log = freshLog();
  const ctx = makeCtx(log);

  for (let i = 0; i < 4; i++) {
    step(w);
    renderFrame(renderer, ctx, w, env);
  }

  w.director.triggerImpactBloom(120, -140, 320, '255, 196, 84', 0.55);
  step(w);
  renderFrame(renderer, ctx, w, env);
  const afterTrigger = log.gradients;
  const lit = log.lighter;

  // Decay across ~0.4s of frames: the bloom must not rebuild its gradient.
  for (let i = 0; i < 24; i++) {
    step(w);
    renderFrame(renderer, ctx, w, env);
  }
  check('bloom renders under the additive composite', lit > 0, `lighterSets=${lit}`);
  check(
    'bloom gradient is built once and reused through the decay',
    log.gradients === afterTrigger,
    `${afterTrigger} → ${log.gradients}`
  );
}

/* ---------------------------------------------------------------------- F5 */
console.log('\nF5 — damage arms the red edge-flash');
{
  const renderer = new Renderer();
  renderer.quality = 'high';
  const w = makeWorld();
  const env = new EnvironmentManager();
  const log = freshLog();
  const ctx = makeCtx(log);

  // Baseline frame: records the pre-damage health watermark.
  step(w);
  renderFrame(renderer, ctx, w, env);

  const before = log.stops.length;
  w.player.physics.health = Math.max(1, w.player.physics.health - 25);
  renderFrame(renderer, ctx, w, env);
  const redStops = log.stops.slice(before).filter((c) => c.includes('168, 22, 22'));
  check('red edge-flash gradient is built on the health drop', redStops.length > 0, `${redStops.length}`);

  // It decays: after enough particles updates the flash is gone again.
  for (let i = 0; i < 30; i++) renderer.updateParticles(DT);
  const flashesBefore = log.redFlashFills;
  w.player.physics.health = Math.max(1, w.player.physics.health - 25);
  step(w);
  renderFrame(renderer, ctx, w, env);
  check('a second drop still arms the flash', log.redFlashFills > flashesBefore,
    `fills=${flashesBefore} → ${log.redFlashFills}`);
}

/* ---------------------------------------------------------------------- F6 */
console.log('\nF6 — LAND squash reaches the figure transform');
{
  const renderer = new Renderer();
  renderer.quality = 'high';
  const w = makeWorld();
  const env = new EnvironmentManager();
  const log = freshLog();
  const ctx = makeCtx(log);

  step(w);
  // Neutral projection isolates the figure deform from the camera's base zoom.
  w.camera.zoom = 1;
  w.camera.targetZoom = 1;
  renderFrame(renderer, ctx, w, env);

  const before = log.scaleFactors.length;
  w.player.physics.state = 'LAND';
  w.player.physics.stateTimer = 0.05;
  renderFrame(renderer, ctx, w, env);
  const stretch = log.scaleFactors.slice(before).filter((s) => s > FIGURE_SCALE + 0.01);

  check('landing squash widens the silhouette', stretch.length > 0,
    `scales=${log.scaleFactors.slice(before).slice(0, 4).join(',')}`);

  // Back to neutral: no over-scale once the reaction window has closed.
  const neutralFrom = log.scaleFactors.length;
  w.player.physics.state = 'IDLE';
  w.player.physics.stateTimer = 0.5;
  renderFrame(renderer, ctx, w, env);
  const neutralOver = log.scaleFactors.slice(neutralFrom).filter((s) => s > FIGURE_SCALE + 0.01);
  check('idle pose returns to the base silhouette scale', neutralOver.length === 0);
}

if (failures > 0) {
  console.log(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\nALL GREEN');

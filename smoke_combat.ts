/**
 * Headless combat smoke test — no DOM, no audio, no renderer.
 *
 *   npx tsx smoke_combat.ts     (exit code 0 = all green)
 *
 * Covers the Phase 5 fighting-debug fixes:
 *   A1  combo meter mirror (player.comboMeter ⇄ director.stats.comboCount),
 *       SPIN_SLASH / EXECUTIONER strike windows, meter spend on contact,
 *       meter-preserving whiff.
 *   A2  staggerTakenScale actually multiplies the stagger gain.
 *   A3  the guard never travels with a dodge/slide (and every slide/dodge
 *       lock still has a guaranteed exit).
 */
import { Camera } from './src/engine/Camera';
import { CombatDirector } from './src/engine/CombatDirector';
import { EnemyController } from './src/engine/EnemyController';
import { PlayerController } from './src/engine/PlayerController';
import type { InputState } from './src/types/game';

const DT = 1 / 60;
const NEARBY_X = 60; // inside every strike window the tests use
const FAR_X = 400; // outside a 95 px spin, inside punch range only if moved back

let failures = 0;
let mirrorDrift = 0;

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
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
  const world: World = {
    player: new PlayerController(0, 0),
    director: new CombatDirector(),
    camera: new Camera(),
    enemies: [new EnemyController('smoke-1', NEARBY_X, 0, 'BASIC')],
    input: freshInput(),
  };
  return world;
}

/** One simulated frame, exactly as GameLoop schedules it (hit-stop holds the sim). */
function step(w: World): void {
  if (w.director.hitStopFrames > 0) {
    w.director.hitStopFrames--;
    return;
  }
  w.player.update(w.input, DT);
  w.director.update(DT, w.player, w.enemies, w.camera);
  // A1 invariant: what the player reads next frame is already current.
  if (w.player.comboMeter !== w.director.stats.comboCount) mirrorDrift++;
}

function tap(w: World, key: 'attack' | 'heavyAttack' | 'special' | 'dodge'): void {
  w.input[key] = true;
  w.input[`${key}JustPressed` as 'attackJustPressed' | 'heavyAttackJustPressed' | 'specialJustPressed' | 'dodgeJustPressed'] = true;
  step(w);
  w.input[key] = false;
  w.input[`${key}JustPressed` as 'attackJustPressed' | 'heavyAttackJustPressed' | 'specialJustPressed' | 'dodgeJustPressed'] = false;
}

function until(w: World, done: () => boolean, limit = 180): number {
  let frames = 0;
  while (!done() && frames++ < limit) step(w);
  return frames;
}

function settle(w: World): void {
  until(w, () => !w.player.physics.state.startsWith('ATTACK_'));
}

/** Resets the stage: the fighter back on his mark, the partner alive and in place. */
function resetTarget(w: World, x: number = NEARBY_X): void {
  w.player.physics.position.x = 0;
  w.player.physics.velocity.x = 0;
  w.player.physics.facingRight = true;
  for (const e of w.enemies) {
    e.health = e.maxHealth;
    e.state = 'IDLE';
    e.isStaggered = false;
    e.staggerMeter = 0;
    e.hasDroppedLoot = false;
    e.position.x = x;
    e.position.y = 0;
    e.velocity.x = 0;
    e.velocity.y = 0;
  }
}

/** Throws straight punches until the chain has grown by `count` landed hits. */
function buildCombo(w: World, count: number): void {
  const target = w.director.stats.comboCount + count;
  for (let i = 0; i < count + 4; i++) {
    if (w.director.stats.comboCount >= target) break;
    resetTarget(w);
    tap(w, 'attack');
    until(w, () => w.director.stats.comboCount >= target || !w.player.physics.state.startsWith('ATTACK_'));
    settle(w);
  }
}

// ---------------------------------------------------------------- A1
console.log('\nA1 — combo mirror + specials');
{
  const w = makeWorld();
  // Second body on the player's other shoulder — inside the whirl, outside the punch.
  w.enemies.push(new EnemyController('smoke-2', -40, 0, 'BASIC'));
  mirrorDrift = 0;

  buildCombo(w, 5);
  check('chain built to 5', w.director.stats.comboCount === 5, `comboCount=${w.director.stats.comboCount}`);
  check('player.comboMeter mirrors the chain', w.player.comboMeter === w.director.stats.comboCount,
    `meter=${w.player.comboMeter} chain=${w.director.stats.comboCount}`);

  // Whiff: no target inside the whirl, the trigger must drop with nothing spent.
  resetTarget(w, FAR_X);
  const whiffCombo = w.director.stats.comboCount;
  tap(w, 'special');
  check('SPIN_SLASH triggered at 5 points', w.player.physics.state === 'ATTACK_SPECIAL', w.player.physics.state);
  check('pendingSpecial armed', w.player.pendingSpecial === 'SPIN_SLASH');
  until(w, () => w.player.pendingSpecial === null);
  check('whiff drops pendingSpecial', w.player.pendingSpecial === null);
  check('whiff spends nothing', w.director.stats.comboCount === whiffCombo,
    `chain=${w.director.stats.comboCount} (was ${whiffCombo})`);
  settle(w);

  // Contact: the whirl hits every body inside ~95 px and burns 5.
  buildCombo(w, 5);
  resetTarget(w); // player on his mark, both partners reset
  w.enemies[1].position.x = -40; // ... and one of them behind his shoulder
  const before = w.director.stats.comboCount;
  const hp = w.enemies[0].health;
  const hpOther = w.enemies[1].health;
  tap(w, 'special');
  check('special re-armed', w.player.pendingSpecial === 'SPIN_SLASH');
  until(w, () => w.player.pendingSpecial === null);
  check('spin connected', w.enemies[0].health < hp, `hp ${hp} -> ${w.enemies[0].health}`);
  check('whirl hits EVERY body in range', hpOther - w.enemies[1].health === 30,
    `rear hp ${hpOther} -> ${w.enemies[1].health}`);
  check('special spent 5 (landed hit credits 1 first)',
    w.director.stats.comboCount === Math.max(0, before + 1 - PlayerController.SPECIAL_COST),
    `chain=${w.director.stats.comboCount} (was ${before})`);
  check('one registration — exactly one 30-damage whirl',
    hp - w.enemies[0].health === 30, `hp ${hp} -> ${w.enemies[0].health}`);
  settle(w);

  // EXECUTIONER: forward slam, 15 points.
  buildCombo(w, 15);
  resetTarget(w, 120);
  const superBefore = w.director.stats.comboCount;
  const superHp = w.enemies[0].health;
  tap(w, 'special');
  check('EXECUTIONER wins the gate at 15', w.player.physics.state === 'ATTACK_SUPER', w.player.physics.state);
  check('pendingSpecial = EXECUTIONER', w.player.pendingSpecial === 'EXECUTIONER');
  until(w, () => w.player.pendingSpecial === null);
  check('super connected', w.enemies[0].health < superHp, `hp ${superHp} -> ${w.enemies[0].health}`);
  check('one registration — exactly one 55-damage slam',
    superHp - w.enemies[0].health === 55, `hp ${superHp} -> ${w.enemies[0].health}`);
  check('super spent 15',
    w.director.stats.comboCount === Math.max(0, superBefore + 1 - PlayerController.SUPER_COST),
    `chain=${w.director.stats.comboCount} (was ${superBefore})`);
  settle(w);

  // Chain expiry zeroes both sides of the mirror on the same frame.
  until(w, () => w.director.stats.comboCount === 0, 240);
  check('broken chain mirrors as 0', w.director.stats.comboCount === 0 && w.player.comboMeter === 0,
    `chain=${w.director.stats.comboCount} meter=${w.player.comboMeter}`);
  check('comboMeter tracked the director every frame', mirrorDrift === 0, `drift=${mirrorDrift} frames`);
}

// ---------------------------------------------------------------- A2
console.log('\nA2 — staggerTakenScale');
{
  const berserker = new EnemyController('s1', 0, 0, 'BERSERKER');
  berserker.takeDamage(10, 100, -50, false);
  check('BERSERKER light hit builds 30 (15 x 2)', berserker.staggerMeter === 30,
    `stagger=${berserker.staggerMeter}`);
  berserker.takeDamage(10, 100, -50, false);
  check('BERSERKER staggers on the second light hit', berserker.isStaggered,
    `stagger=${berserker.staggerMeter}/${berserker.maxStagger}`);

  const heavy = new EnemyController('s2', 0, 0, 'BERSERKER');
  heavy.takeDamage(10, 300, -150, true);
  check('BERSERKER heavy hit builds 60 (30 x 2)', heavy.staggerMeter === 60, `stagger=${heavy.staggerMeter}`);
  check('BERSERKER cracks on one power hit', heavy.isStaggered);

  const acrobat = new EnemyController('s3', 0, 0, 'ACROBAT');
  acrobat.takeDamage(10, 100, -50, false);
  check('ACROBAT light hit builds 18 (15 x 1.2)', Math.abs(acrobat.staggerMeter - 18) < 1e-9,
    `stagger=${acrobat.staggerMeter}`);

  const basic = new EnemyController('s4', 0, 0, 'BASIC');
  basic.takeDamage(10, 100, -50, false);
  check('everyone else still builds 15 (x1)', basic.staggerMeter === 15, `stagger=${basic.staggerMeter}`);
}

// ---------------------------------------------------------------- A3
console.log('\nA3 — movement locks');
{
  const w = makeWorld();

  w.input.block = true;
  step(w);
  check('block engages', w.player.physics.isBlocking && w.player.physics.state === 'BLOCK',
    w.player.physics.state);

  // Launched while still holding guard — the classic way into a guarded roll.
  w.player.takeDamage(5, 300, -200);
  check('guard survives the launch', w.player.physics.isBlocking);

  tap(w, 'dodge');
  check('dodge roll starts', w.player.physics.isDodging && w.player.physics.state === 'DODGE_ROLL',
    w.player.physics.state);
  check('guard cleared on roll start', !w.player.physics.isBlocking);

  w.input.block = false;
  step(w);
  check('releasing block mid-roll keeps the roll state',
    w.player.physics.state === 'DODGE_ROLL' && w.player.physics.isDodging, w.player.physics.state);

  until(w, () => !w.player.physics.isDodging, 120);
  check('roll always exits', !w.player.physics.isDodging, `state=${w.player.physics.state}`);

  // Air slide: flag the move, guaranteed exit, no stuck state.
  w.player.takeDamage(5, -200, -300);
  w.input.moveY = 0.6;
  tap(w, 'dodge');
  const airSliding = w.player.physics.isSliding;
  w.input.moveY = 0;
  until(w, () => !w.player.physics.isSliding, 120);
  check('air slide starts', airSliding);
  check('air slide always exits', !w.player.physics.isSliding, `state=${w.player.physics.state}`);

  // Ground slide exit.
  until(w, () => w.player.physics.grounded, 180);
  w.input.moveY = 0.6;
  tap(w, 'dodge');
  w.input.moveY = 0;
  const sliding = w.player.physics.isSliding;
  until(w, () => !w.player.physics.isSliding, 120);
  check('ground slide starts', sliding);
  check('ground slide always exits', !w.player.physics.isSliding, `state=${w.player.physics.state}`);

  // Buffered press at the boundary: a punch held through a roll lands after it.
  const w2 = makeWorld();
  tap(w2, 'dodge');
  w2.input.attackJustPressed = true;
  w2.input.attack = true;
  step(w2);
  w2.input.attackJustPressed = false;
  w2.input.attack = false;
  const bufferedState = w2.player.physics.state;
  until(w2, () => !w2.player.physics.isDodging, 120);
  until(w2, () => w2.player.physics.state.startsWith('ATTACK_'), 30);
  check('punch buffered through the roll is spent at the boundary',
    bufferedState === 'DODGE_ROLL' && w2.player.physics.state.startsWith('ATTACK_'),
    `during=${bufferedState} after=${w2.player.physics.state}`);
}

console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

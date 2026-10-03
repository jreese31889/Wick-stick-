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
 *   A4  the joystick jump / crouch kit: stick-UP jump + jump cut, stick-DOWN
 *       crouch stance, the crouch string (poke → launcher / sweep), the air
 *       string (light / slam / flying kick), the air-slam landing commitment,
 *       the shrunken crouch hurtbox, and the enemy DIVE jump-in that the
 *       whole high/low triangle hangs off.
 *   A5  G5 difficulty tiers: floors above the human startle baseline, PRO is
 *       the shipped baseline, aim/decision pacing separates the tiers, HP and
 *       damage never move with a tier, and the live reactions (gunshot ALERT,
 *       shot-at COVER, poise-break RETREAT) land only after the tier latency.
 *   A6  G7 Training Arena: the checklist is inert outside the drill, every one
 *       of the eight marks fires from the real combat path, the drill writes
 *       no progression, and the three dummy roles behave as shipped.
 */
import { Camera } from './src/engine/Camera';
import { CombatDirector } from './src/engine/CombatDirector';
import { EnemyController } from './src/engine/EnemyController';
import { PlayerController } from './src/engine/PlayerController';
import {
  BASE_AIM_SPREAD,
  DIFFICULTY_TIERS,
  MIN_HUMAN_REACTION,
  aimSpreadPx,
  currentDifficulty,
  getDifficulty,
  reactionDelay,
  setDifficulty,
} from './src/engine/Difficulty';
import type { DifficultyProfile, DifficultyTier } from './src/engine/Difficulty';
import {
  TRAINING_CHECKS,
  trainingIsActive,
  trainingIsDone,
  trainingMark,
  trainingProgress,
  trainingResetChecks,
  trainingSetActive,
} from './src/engine/TrainingRoom';
import { PROGRESS_EVENTS, onProgress } from './src/profile/ProgressEvents';
import {
  REPLAY_BYTE_BUDGET,
  REPLAY_HZ,
  REPLAY_NO_SLOT,
  REPLAY_SNAPSHOT_SLOTS,
  ReplayBuffer,
  makeReplaySample,
  replayBuffer,
} from './src/engine/ReplayBuffer';
import {
  DEATH_CAM_DURATIONS,
  DeathCam,
  sanitizeDeathCamDuration,
} from './src/engine/DeathCam';
import {
  clearEliminations,
  latestPlayerDeath,
  resolveEnemyElimination,
  resolvePlayerElimination,
  setAttackContext,
} from './src/engine/Elimination';
import { SoundFX } from './src/engine/SoundFX';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
} from './src/components/settings';
import type { GameSettings } from './src/components/settings';
import type { EliminationType, InputState } from './src/types/game';

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

// ---------------------------------------------------------------- A4
console.log('\nA4 — joystick jump / crouch kit');

/** A world with the squad cleared: pure input kit, no contact, no hit-stop. */
function soloWorld(): World {
  const w = makeWorld();
  w.enemies = [];
  return w;
}

/** Runs one strike box against the player and reports whether it connected. */
function strikeConnects(crouch: boolean, box: { y: number; radius: number }): boolean {
  const w = makeWorld();
  w.enemies[0].position.x = 0;
  w.enemies[0].activeHitbox = {
    x: 0, y: box.y, radius: box.radius,
    damage: 10, knockbackX: 200, knockbackY: -200, hitStopFrames: 4,
  };
  w.enemies[0].hasHitPlayerThisAttack = false;
  if (crouch) {
    w.player.physics.isCrouching = true;
    w.player.physics.state = 'CROUCH';
  }
  const hp = w.player.physics.health;
  w.director.update(DT, w.player, w.enemies, w.camera);
  return w.player.physics.health < hp;
}

{
  // ---- stick UP is a jump, releasing it cuts the arc (variable jump height)
  const held = soloWorld();
  held.input.moveY = -1;
  for (let i = 0; i < 5; i++) step(held);
  check('stick UP launches the jump',
    held.player.physics.state === 'JUMP_ASCENT' && !held.player.physics.grounded,
    held.player.physics.state);
  check('the held jump gains real height', held.player.physics.position.y < -20,
    `y=${held.player.physics.position.y.toFixed(1)}`);
  const fullRiseVy = held.player.physics.velocity.y;
  check('the held jump is still rising at frame 5', fullRiseVy < -120, `vy=${fullRiseVy.toFixed(0)}`);

  const cut = soloWorld();
  cut.input.moveY = -1;
  for (let i = 0; i < 4; i++) step(cut);
  cut.input.moveY = 0;
  step(cut);
  check('releasing stick UP cuts the jump short',
    cut.player.physics.velocity.y > fullRiseVy + 60,
    `vy ${fullRiseVy.toFixed(0)} held -> ${cut.player.physics.velocity.y.toFixed(0)} released`);

  until(held, () => held.player.physics.grounded, 240);
  check('the jump always lands', held.player.physics.grounded, `state=${held.player.physics.state}`);

  // ---- stick DOWN holds the crouch, releasing it stands back up
  const c = soloWorld();
  c.input.moveY = 1;
  step(c);
  check('stick DOWN holds the crouch',
    c.player.physics.isCrouching && c.player.physics.state === 'CROUCH',
    `flag=${c.player.physics.isCrouching} state=${c.player.physics.state}`);
  c.input.moveY = 0;
  step(c);
  check('releasing stick DOWN stands up',
    !c.player.physics.isCrouching && c.player.physics.state === 'IDLE',
    `flag=${c.player.physics.isCrouching} state=${c.player.physics.state}`);

  // The stance still owns the pose after an attack finishes with the stick down.
  c.input.moveY = 1;
  step(c);
  tap(c, 'attack');
  const pokeState = c.player.physics.state;
  check('crouch + PUNCH = low poke', pokeState === 'ATTACK_CROUCH_POKE', pokeState);
  until(c, () => !c.player.physics.state.startsWith('ATTACK_'), 60);
  check('the crouch stance survives the attack with the stick held',
    c.player.physics.isCrouching && c.player.physics.state === 'CROUCH',
    `flag=${c.player.physics.isCrouching} state=${c.player.physics.state}`);

  // ---- crouch string: poke, then a second PUNCH inside the chain = launcher
  tap(c, 'attack');
  const launcherState = c.player.physics.state;
  check('second crouch PUNCH inside the window = rising launcher',
    launcherState === 'ATTACK_LAUNCHER', launcherState);
  until(c, () => !c.player.physics.state.startsWith('ATTACK_'), 60);
  tap(c, 'attack');
  const afterLauncher = c.player.physics.state;
  check('the launcher spends the step — the next crouch PUNCH is a poke again',
    afterLauncher === 'ATTACK_CROUCH_POKE', afterLauncher);
  until(c, () => !c.player.physics.state.startsWith('ATTACK_'), 60);

  // ---- crouch + KICK = the low sweep (the trip, on demand from the crouch)
  tap(c, 'heavyAttack');
  check('crouch + KICK = leg sweep', c.player.physics.state === 'ATTACK_SWEEP',
    c.player.physics.state);
  until(c, () => !c.player.physics.state.startsWith('ATTACK_'), 60);

  // ---- M15 L-02: the launcher starts a juggle but can never extend one
  const j = makeWorld();
  const body = j.enemies[0];
  resetTarget(j, 400); // the setup poke whiffs — the body is positioned by hand
  j.input.moveY = 1;
  step(j);
  tap(j, 'attack');
  until(j, () => !j.player.physics.state.startsWith('ATTACK_'), 60);

  resetTarget(j, 60);
  const groundHp = body.health;
  tap(j, 'attack');
  until(j, () => !j.player.physics.state.startsWith('ATTACK_'), 60);
  check('the launcher pops a grounded body',
    body.health < groundHp && !body.grounded,
    `hp ${groundHp} -> ${body.health} grounded=${body.grounded}`);

  const lift = (y: number): void => {
    body.position.y = y;
    body.velocity.y = -200;
    body.velocity.x = 0;
    body.grounded = false;
    body.state = 'KNOCKBACK';
    body.stateTimer = 0;
    body.hasHitPlayerThisAttack = false;
  };

  // Every OTHER strike still juggles a body that is off the floor.
  j.input.moveY = 0; // stand up — a crouch poke is a floor-line strike and
  step(j);           // physically cannot reach a body at torso height
  lift(-20);
  const juggleHp = body.health;
  tap(j, 'attack');
  until(j, () => !j.player.physics.state.startsWith('ATTACK_'), 60);
  check('other strikes still juggle an airborne body', body.health < juggleHp,
    `hp ${juggleHp} -> ${body.health}`);

  // ... but the launcher itself is refused, so the pop cannot be re-fired.
  // y=0 keeps the geometry byte-identical to the grounded control above, so
  // `grounded` is the ONLY difference between "pops" and "refused".
  j.input.moveY = 1;
  step(j);
  tap(j, 'attack'); // crouch poke — sets the chain step for the launcher
  until(j, () => !j.player.physics.state.startsWith('ATTACK_'), 60);
  lift(0);
  const refuseHp = body.health;
  tap(j, 'attack'); // the launcher, aimed at a body already off the floor
  until(j, () => !j.player.physics.state.startsWith('ATTACK_'), 60);
  check('the launcher refuses an airborne body — no infinite juggle (L-02)',
    body.health === refuseHp && !body.grounded,
    `hp ${refuseHp} -> ${body.health} grounded=${body.grounded}`);

  // ---- air string
  const air = soloWorld();
  air.input.moveY = -1;
  step(air);
  air.input.moveY = 0;
  tap(air, 'attack');
  check('air + PUNCH = air light', air.player.physics.state === 'ATTACK_AIR_LIGHT',
    air.player.physics.state);

  const slam = soloWorld();
  slam.input.moveY = -1;
  step(slam);
  slam.input.moveY = 0;
  tap(slam, 'heavyAttack');
  check('air + KICK off a standing jump = overhead slam',
    slam.player.physics.state === 'ATTACK_AIR_HEAVY', slam.player.physics.state);

  const fly = soloWorld();
  fly.input.moveX = 1;
  for (let i = 0; i < 30; i++) step(fly);
  fly.input.moveY = -1;
  step(fly);
  fly.input.moveY = 0;
  const carriedVx = fly.player.physics.velocity.x;
  tap(fly, 'heavyAttack');
  check('air + KICK with real forward speed = flying kick',
    fly.player.physics.state === 'ATTACK_FLYING_KICK',
    `${fly.player.physics.state} vx=${carriedVx.toFixed(0)}`);

  // ---- air slam touchdown: one-frame contact, shockwave, then the commit
  let landFrames = 0;
  while (landFrames++ < 240 && !slam.player.pendingLandingShockwave) {
    slam.player.update(slam.input, DT);
  }
  check('touchdown queues the landing shockwave on the contact frame',
    slam.player.pendingLandingShockwave && slam.player.physics.state === 'ATTACK_AIR_HEAVY',
    `frame=${landFrames} state=${slam.player.physics.state}`);
  slam.director.update(DT, slam.player, slam.enemies, slam.camera);
  check('the shockwave lands as hit-stop',
    slam.director.hitStopFrames >= 6, `hitStop=${slam.director.hitStopFrames}`);
  slam.director.hitStopFrames = 0;
  slam.player.update(slam.input, DT);
  check('the slam recovers into LAND', slam.player.physics.state === 'LAND',
    slam.player.physics.state);

  tap(slam, 'attack');
  check('landing recovery blocks starting a NEW attack',
    !slam.player.physics.state.startsWith('ATTACK_'), slam.player.physics.state);
  tap(slam, 'dodge');
  check('landing recovery never blocks the dodge (responsiveness)',
    slam.player.physics.isDodging, slam.player.physics.state);

  // ---- the crouch hurtbox: high strikes whiff, floor strikes still land
  check('standing eats a high jab (y-70, r26)', strikeConnects(false, { y: -70, radius: 26 }));
  check('crouching ducks under that same high jab',
    !strikeConnects(true, { y: -70, radius: 26 }));
  check('standing eats the dive overhead (y-74, r32)', strikeConnects(false, { y: -74, radius: 32 }));
  check('crouching ducks under the dive overhead',
    !strikeConnects(true, { y: -74, radius: 32 }));
  check('standing still eats the sweep (y-20, r28)', strikeConnects(false, { y: -20, radius: 28 }));
  check('crouching does NOT dodge the sweep — the low is the answer',
    strikeConnects(true, { y: -20, radius: 28 }));

  // ---- the enemy jump-in: both sides of the high/low triangle
  const diver = new EnemyController('dive-1', 90, 0, 'RUSHER');
  diver.state = 'WINDUP';
  diver.attackPattern = 'DIVE';
  diver.stateTimer = 0;
  const diveTarget = { x: 0, y: 0 };
  let leftFloor = false;
  let airborneY = 0;
  let armedAt: number | null = null;
  let landed = false;
  for (let i = 0; i < 200; i++) {
    diver.update(DT, diveTarget, 'IDLE', true, true);
    const st: string = diver.state;
    if (!diver.grounded) {
      leftFloor = true;
      airborneY = Math.min(airborneY, diver.position.y);
    }
    if (diver.activeHitbox && armedAt === null) armedAt = diver.activeHitbox.y - diver.position.y;
    if (leftFloor && diver.grounded && st === 'RECOVERY') {
      landed = true;
      break;
    }
  }
  check('the dive telegraphs, then leaves the floor', leftFloor, `apexY=${airborneY.toFixed(1)}`);
  check('the dive arms its box at HEAD height (position.y - 74)',
    armedAt !== null && armedAt < -68 && armedAt > -80, `dy=${armedAt}`);
  check('the dive lands into recovery — a real punish window',
    landed && (diver.state as string) === 'RECOVERY', `state=${diver.state}`);

  // Both jump-in archetypes must actually ROLL a dive and a low.
  function samplePatterns(type: 'RUSHER' | 'ACROBAT', n: number): Record<string, number> {
    const counts: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const e = new EnemyController(`sample-${i}`, 0, 0, type);
      e.state = 'IDLE';
      e.attackCooldown = 0;
      e.stateTimer = 0;
      for (let f = 0; f < 40; f++) {
        e.update(DT, { x: 85, y: 0 }, 'IDLE', true, true);
        if ((e.state as string) !== 'IDLE') break;
      }
      if ((e.state as string) === 'WINDUP') counts[e.attackPattern] = (counts[e.attackPattern] || 0) + 1;
    }
    return counts;
  }

  const rusher = samplePatterns('RUSHER', 140);
  const acrobat = samplePatterns('ACROBAT', 140);
  console.log(`      RUSHER rolls ${JSON.stringify(rusher)}`);
  console.log(`      ACROBAT rolls ${JSON.stringify(acrobat)}`);
  check('RUSHER rolls a jump-in (DIVE)', (rusher['DIVE'] || 0) > 0, `n=${rusher['DIVE'] || 0}`);
  check('RUSHER rolls a low (SWEEP)', (rusher['SWEEP'] || 0) > 0, `n=${rusher['SWEEP'] || 0}`);
  check('ACROBAT rolls a jump-in (DIVE)', (acrobat['DIVE'] || 0) > 0, `n=${acrobat['DIVE'] || 0}`);
  check('ACROBAT rolls a low (SWEEP)', (acrobat['SWEEP'] || 0) > 0, `n=${acrobat['SWEEP'] || 0}`);
}

// ---------------------------------------------------------------- A5
console.log('\nA5 — G5 difficulty tiers (behaviour only)');
{
  const TIERS: DifficultyTier[] = ['rookie', 'pro', 'continental'];

  // 1 — every floor sits at or above the human startle baseline, and the
  //     tiers are strictly ordered (ROOKIE flinches slowest).
  const floors = TIERS.map(t => DIFFICULTY_TIERS[t].reactionMin);
  check('every tier floor is at or above the human reaction baseline',
    floors.every(f => f >= MIN_HUMAN_REACTION), `floors=${floors.join('/')}`);
  check('the reaction floors are strictly ordered (rookie > pro > continental)',
    floors[0] > floors[1] && floors[1] > floors[2], `${floors[0]} > ${floors[1]} > ${floors[2]}`);

  // 2 — PRO is the shipped baseline: every scale 1.0, authored numbers intact.
  const pro = DIFFICULTY_TIERS.pro;
  check('PRO reproduces the shipped baseline (all scales = 1)',
    pro.aimSpreadScale === 1 && pro.decisionCooldownScale === 1 &&
    pro.defenseChanceScale === 1 && pro.flankRingScale === 1);
  check('PRO keeps the authored squad gap (0.22 s)', pro.attackGap === 0.22, `gap=${pro.attackGap}`);
  check('PRO keeps the authored aim error band (22 px)',
    aimSpreadPx(pro) === BASE_AIM_SPREAD, `px=${aimSpreadPx(pro)}`);

  // 3 — aim error tightens by tier and never collapses to a laser.
  const spread = TIERS.map(t => aimSpreadPx(DIFFICULTY_TIERS[t]));
  check('aim error tightens by tier and never collapses to a laser',
    spread[0] > spread[1] && spread[1] > spread[2] && spread[2] > 4,
    spread.map(s => s.toFixed(1)).join('/'));

  // 4 — no profile can schedule a sub-human reaction, however it is authored.
  const cheated: DifficultyProfile = { ...pro, reactionMin: 0, reactionJitter: 0 };
  const draws = Array.from({ length: 64 }, () => reactionDelay(cheated));
  check('reaction latency is clamped to the human floor',
    draws.every(d => d >= MIN_HUMAN_REACTION), `min=${Math.min(...draws).toFixed(3)}`);

  // 5 — every draw lands inside [floor, floor + jitter].
  let bandOk = true;
  for (const t of TIERS) {
    const p = DIFFICULTY_TIERS[t];
    for (let i = 0; i < 250; i++) {
      const d = reactionDelay(p);
      if (d < p.reactionMin - 1e-9 || d > p.reactionMin + p.reactionJitter + 1e-9) {
        bandOk = false;
      }
    }
  }
  check('every latency draw stays inside the tier band', bandOk);

  // 6 — a tier never moves a hit point or a damage number.
  const vitals = TIERS.map(t => {
    setDifficulty(t);
    const e = new EnemyController(`vit-${t}`, 0, 0, 'BASIC');
    const hp = e.maxHealth;
    const applied = e.takeDamage(30, 100, -50, false);
    return `${hp}/${e.maxHealth}/${applied}`;
  });
  check('a tier never touches HP or damage',
    new Set(vitals).size === 1, vitals.join('  '));

  // 7 — the decision pace separates the tiers (PRO = the shipped 1 s drain).
  function framesToCooldownZero(tier: DifficultyTier): number {
    setDifficulty(tier);
    const e = new EnemyController(`drain-${tier}`, 0, 0, 'BASIC');
    e.attackCooldown = 1.0;
    e.state = 'IDLE';
    let f = 0;
    while (e.attackCooldown > 0 && f < 400) {
      e.update(DT, { x: 5000, y: 0 }, 'IDLE', true, false);
      f++;
    }
    return f;
  }
  const rookF = framesToCooldownZero('rookie');
  const proF = framesToCooldownZero('pro');
  const contF = framesToCooldownZero('continental');
  check('the decision pace separates the tiers',
    rookF < proF && proF < contF, `rookie=${rookF} pro=${proF} continental=${contF}`);
  check('PRO drains a decision cooldown exactly as shipped',
    Math.abs(proF - 60) <= 2, `pro=${proF} frames (shipped = 60)`);

  // 8 — a live armed reaction waits out the tier latency before it lands.
  setDifficulty('pro');
  const react = new EnemyController('react', 0, 0, 'BASIC');
  react.state = 'IDLE';
  react.armReaction('ALERT');
  const armedAt = react.pendingReaction;
  let frames = 0;
  while (react.pendingReaction >= 0 && frames < 120) {
    react.update(DT, { x: 200, y: 0 }, 'IDLE', true, false);
    frames++;
  }
  check('arming a reaction schedules it, it does not fire now',
    armedAt >= 0.3 - 1e-9 && armedAt <= 0.52 + 1e-9, `armed=${armedAt.toFixed(3)}`);
  check('the reaction lands only after the tier latency',
    react.pendingReaction === -1 && frames >= 18, `frames=${frames} (floor = 18)`);
  check('the fighter actually reacts — the guard comes up',
    (react.state as string) === 'BLOCK', `state=${react.state}`);

  // 9 — one committed round tells the room (GUNSHOT → ALERT).
  const w = makeWorld();
  setDifficulty('pro');
  resetTarget(w, -300); // behind the muzzle: heard, never hit
  step(w);
  w.input.shoot = true;
  w.input.shootJustPressed = true;
  step(w);
  w.input.shoot = false;
  w.input.shootJustPressed = false;
  const heard = w.enemies[0];
  check('the round leaves the chamber',
    w.player.physics.ammo === w.player.gunState.PISTOL.magSize - 1,
    `ammo=${w.player.physics.ammo}`);
  check('the room hears the shot (ALERT armed at range)',
    heard.pendingReaction >= 0.3 - 1e-9, `pending=${heard.pendingReaction.toFixed(3)}`);
  let heardFrames = 0;
  while (heard.pendingReaction >= 0 && heardFrames < 120) {
    heard.update(DT, { x: 0, y: 0 }, 'IDLE', true, false);
    heardFrames++;
  }
  check('the guard comes up only after the latency, not on the frame',
    heardFrames >= 18 && heard.state === 'BLOCK',
    `frames=${heardFrames} state=${heard.state}`);

  // 10 — shot at: break for the prop, hold the seat, drop it on the clock.
  setDifficulty('pro');
  const cover = new EnemyController('cover', 0, 0, 'BASIC');
  cover.state = 'IDLE';
  cover.armReaction('COVER', 300, 1);
  let land = 0;
  while (cover.pendingReaction >= 0 && land < 120) {
    cover.update(DT, { x: 0, y: 0 }, 'IDLE', true, false);
    land++;
  }
  check('the cover reaction arms a seat, not a panic',
    cover.pendingReaction === -1 && cover.coverTargetX === 300,
    `seat=${cover.coverTargetX} frames=${land}`);
  let walk = 0;
  while (walk < 400 && cover.coverTargetX !== null &&
         Math.abs(cover.coverTargetX - cover.position.x) > 10) {
    cover.update(DT, { x: 0, y: 0 }, 'IDLE', true, false);
    walk++;
  }
  check('the fighter closes on the seat',
    cover.coverTargetX !== null && Math.abs(cover.coverTargetX - cover.position.x) <= 10,
    `x=${cover.position.x.toFixed(0)} seat=${cover.coverTargetX} frames=${walk}`);
  cover.update(DT, { x: 0, y: 0 }, 'IDLE', true, false); // the seat latches
  check('and digs in behind it', (cover.state as string) === 'BLOCK', `state=${cover.state}`);
  let seatFrames = 0;
  while (cover.coverTargetX !== null && seatFrames < 400) {
    cover.update(DT, { x: 0, y: 0 }, 'IDLE', true, false);
    seatFrames++;
  }
  check('the seat is held for the whole clock, then given up',
    cover.coverTargetX === null && seatFrames > 0 && seatFrames <= 180,
    `held=${seatFrames} frames`);
  // A seat already held / a cooldown in flight downgrades the request to a
  // plain ALERT, so the seat never re-arms the same prop on the same clock.
  cover.armReaction('COVER', 300, 1);
  let reland = 0;
  while (cover.pendingReaction >= 0 && reland < 120) {
    cover.update(DT, { x: 0, y: 0 }, 'IDLE', true, false);
    reland++;
  }
  check('the cover cooldown downgrades a second request instead of spamming it',
    cover.pendingReaction === -1 && cover.coverTargetX === null,
    `seat=${cover.coverTargetX} frames=${reland}`);

  // 11 — poise broken: back out, then re-engage.
  setDifficulty('pro');
  const retreat = new EnemyController('retreat', 100, 0, 'BASIC');
  retreat.state = 'IDLE';
  retreat.guardBreak();
  check('a poise break arms the retreat reaction',
    retreat.pendingReaction >= 0.22 - 1e-9 && (retreat.state as string) === 'STAGGER',
    `pending=${retreat.pendingReaction.toFixed(3)} state=${retreat.state}`);
  let free = 0;
  while (
    free < 400 &&
    !(retreat.retreatTimer > 0 && (retreat.state === 'IDLE' || retreat.state === 'APPROACH'))
  ) {
    retreat.update(DT, { x: 0, y: 0 }, 'IDLE', true, false);
    free++;
  }
  check('the retreat clock survives the stagger and reaches the fighter',
    retreat.retreatTimer > 0, `timer=${retreat.retreatTimer.toFixed(2)} frames=${free}`);
  retreat.update(DT, { x: 0, y: 0 }, 'IDLE', true, false);
  check('the fighter backs away from the one who broke the guard',
    (retreat.state as string) === 'APPROACH' && retreat.velocity.x > 0,
    `state=${retreat.state} vx=${retreat.velocity.x.toFixed(0)}`);

  // 12 — the tier is a stored setting that round-trips and cannot be faked.
  setDifficulty('rookie');
  const back = currentDifficulty();
  const backId = getDifficulty().id;
  setDifficulty('nope' as DifficultyTier);
  const fallback = currentDifficulty();
  check('the tier round-trips through the setter',
    back === 'rookie' && backId === 'rookie', `id=${back}/${backId}`);
  check('an unknown tier falls back to PRO', fallback === 'pro', `id=${fallback}`);

  setDifficulty('pro');
}

// ---------------------------------------------------------------- A6
console.log('\nA6 — G7 Training Arena (checklist + dummy roles)');
{
  // 1 — the board is inert until the drill owns the run.
  trainingSetActive(false);
  trainingResetChecks();
  trainingMark('JUMP_ATTACK');
  check('the checklist ignores marks outside the drill',
    !trainingIsDone('JUMP_ATTACK') && trainingProgress().done === 0,
    `done=${trainingProgress().done}`);

  // 2 — the board itself: eight authored mechanics, no duplicates.
  check('the board ships exactly the eight promised mechanics',
    TRAINING_CHECKS.length === 8, `n=${TRAINING_CHECKS.length}`);
  check('checklist ids are unique',
    new Set(TRAINING_CHECKS.map(c => c.id)).size === TRAINING_CHECKS.length);
  check('every mechanic is written down with a hint',
    TRAINING_CHECKS.every(c => c.label.length > 0 && c.hint.length > 0));

  trainingSetActive(true);
  trainingResetChecks();
  check('entering the drill arms a clean board',
    trainingIsActive() && trainingProgress().done === 0 && trainingProgress().total === 8,
    `p=${trainingProgress().done}/${trainingProgress().total}`);

  // 3 — every mark is fired by the real state machine, one tick at a time.
  const w = makeWorld();
  step(w); // sync the director onto IDLE

  w.player.physics.grounded = false;
  w.player.physics.position.y = -140;
  w.player.forceState('ATTACK_FLYING_KICK');
  step(w);
  check('JUMP_ATTACK fires from the real state machine',
    trainingIsDone('JUMP_ATTACK'), `state=${w.player.physics.state}`);

  w.player.forceState('ATTACK_AIR_LIGHT');
  step(w);
  check('AIR_MOVE fires from the real state machine',
    trainingIsDone('AIR_MOVE'), `state=${w.player.physics.state}`);

  w.player.physics.grounded = true;
  w.player.physics.position.y = 0;
  w.player.forceState('ATTACK_CROUCH_POKE');
  step(w);
  check('CROUCH_ATTACK fires from the real state machine',
    trainingIsDone('CROUCH_ATTACK'), `state=${w.player.physics.state}`);

  w.player.forceState('ATTACK_SPECIAL');
  step(w);
  check('SPECIAL fires from the real state machine',
    trainingIsDone('SPECIAL'), `state=${w.player.physics.state}`);

  w.player.forceState('ATTACK_SUPER');
  step(w);
  check('SUPER fires from the real state machine',
    trainingIsDone('SUPER'), `state=${w.player.physics.state}`);

  // PISTOL WHIP — a body at arm's length, no round burned.
  w.player.forceState('IDLE');
  step(w);
  resetTarget(w, 40);
  w.player.physics.position.x = 0;
  w.player.physics.facingRight = true;
  const whipAmmo = w.player.physics.ammo;
  w.input.shoot = true;
  w.input.shootJustPressed = true;
  step(w);
  w.input.shoot = false;
  w.input.shootJustPressed = false;
  check('PISTOL_WHIP fires from the real shoot path',
    trainingIsDone('PISTOL_WHIP'), `state=${w.player.physics.state}`);
  check('the whip burns no round',
    w.player.physics.ammo === whipAmmo, `${whipAmmo}->${whipAmmo === w.player.physics.ammo ? 'held' : w.player.physics.ammo}`);
  // The whip banks hit-stop frames; the sim would skip the next frames whole.
  w.director.hitStopFrames = 0;

  // SLIDE FIRE — the round commits, the SLIDE pose is never stolen.
  w.enemies[0].position.x = 400;
  w.player.physics.isSliding = true;
  w.player.physics.velocity.x = 320;
  w.player.forceState('SLIDE');
  const slideAmmo = w.player.physics.ammo;
  w.input.shoot = true;
  w.input.shootJustPressed = true;
  step(w);
  w.input.shoot = false;
  w.input.shootJustPressed = false;
  check('SLIDE_FIRE commits a round mid-slide',
    trainingIsDone('SLIDE_FIRE'), `ammo=${w.player.physics.ammo}`);
  check('the round really left',
    w.player.physics.ammo === slideAmmo - 1, `${slideAmmo}->${w.player.physics.ammo}`);
  check('the slide keeps the pose — no gun-shoot state, no cancel',
    w.player.physics.state === 'SLIDE' && w.player.physics.isSliding,
    `state=${w.player.physics.state} sliding=${w.player.physics.isSliding}`);

  // TAKEDOWN — the checklist ticks, the drill writes nothing.
  const events: string[] = [];
  const offEvents = onProgress(e => events.push(e.type));
  w.director.hitStopFrames = 0;
  w.player.forceState('IDLE');
  step(w);
  resetTarget(w, 44);
  w.input.grabJustPressed = true;
  step(w);
  w.input.grabJustPressed = false;
  check('the grab locks on', w.enemies[0].state === 'GRAPPLED',
    `state=${w.enemies[0].state}`);
  const slamFrames = until(w, () => trainingIsDone('TAKEDOWN'), 90);
  check('TAKEDOWN fires from the real grapple',
    trainingIsDone('TAKEDOWN'), `frames=${slamFrames}`);
  check('the same takedown writes no progression while the drill runs',
    !events.includes(PROGRESS_EVENTS.EXECUTION), events.join(',') || '(silent)');
  offEvents();

  // 4 — a drill never writes progression, not even the damage tally.
  const hits: string[] = [];
  const offHits = onProgress(e => hits.push(e.type));
  trainingSetActive(false);
  w.player.takeDamage(5, 0, 0);
  check('outside the drill the damage tally reports',
    hits.includes(PROGRESS_EVENTS.PLAYER_DAMAGED), hits.join(',') || '(none)');
  hits.length = 0;
  trainingSetActive(true);
  w.player.takeDamage(5, 0, 0);
  check('inside the drill the damage tally is silent',
    !hits.includes(PROGRESS_EVENTS.PLAYER_DAMAGED), hits.join(',') || '(none)');
  offHits();

  // 5 — the drill keeps the guns fed, but never papers over a reload.
  w.player.physics.isReloading = false;
  w.player.physics.ammo = 1;
  w.player.trainingTopUp();
  check('the drill tops the gun straight back up',
    w.player.physics.ammo === w.player.gunState.PISTOL.magSize,
    `ammo=${w.player.physics.ammo}`);
  w.player.physics.isReloading = true;
  w.player.physics.ammo = 1;
  w.player.trainingTopUp();
  check('a reload in flight is never papered over',
    w.player.physics.ammo === 1, `ammo=${w.player.physics.ammo}`);
  w.player.physics.isReloading = false;

  // 6 — the three spawnable dummy roles.
  const bag = new EnemyController('bag', 60, 0, 'BASIC');
  bag.dummyMode = 'IDLE';
  bag.state = 'IDLE';
  for (let i = 0; i < 240; i++) bag.update(DT, { x: 0, y: 0 }, 'IDLE', true, false);
  check('the sandbag never decides to act',
    bag.state === 'IDLE' && bag.activeHitbox === null, `state=${bag.state}`);
  bag.armReaction('ALERT');
  check('the sandbag processes no reactions', bag.pendingReaction === -1);
  const bagHp = bag.health;
  bag.takeDamage(30, 100, -50, false);
  check('the sandbag still reads as a real hit',
    bag.health === bagHp - 30 && (bag.state as string) === 'HURT',
    `state=${bag.state} hp=${bag.health}`);

  const shooter = new EnemyController('shooter', 0, 0, 'BASIC');
  shooter.dummyMode = 'SHOOTER';
  shooter.dodgeChance = 0;
  shooter.attackCooldown = 0;
  shooter.state = 'IDLE';
  let fired = false;
  for (let i = 0; i < 180 && !fired; i++) {
    shooter.update(DT, { x: 310, y: 0 }, 'IDLE', true, true);
    if (shooter.pendingShots.length > 0) fired = true;
  }
  check('the SHOOTER dummy runs the shipped gunner lane and fires',
    fired, `state=${shooter.state} shots=${shooter.pendingShots.length}`);

  const attacker = new EnemyController('attacker', 60, 0, 'BASIC');
  attacker.dummyMode = 'ATTACKER';
  attacker.dodgeChance = 0;
  attacker.attackCooldown = 0;
  attacker.state = 'IDLE';
  let woundUp = false;
  for (let i = 0; i < 180 && !woundUp; i++) {
    attacker.update(DT, { x: 0, y: 0 }, 'IDLE', true, true);
    if ((attacker.state as string) === 'WINDUP') woundUp = true;
  }
  check('the ATTACKER dummy still swings (melee, no round)',
    woundUp && attacker.pendingShots.length === 0,
    `state=${attacker.state} shots=${attacker.pendingShots.length}`);

  // 7 — leave the room the way the UI does.
  trainingSetActive(false);
  trainingResetChecks();
  setDifficulty('pro');
  check('leaving the drill disarms the board',
    !trainingIsActive() && trainingProgress().done === 0);
  check('the tier is back on the shipped baseline',
    currentDifficulty() === 'pro' && getDifficulty().id === 'pro');
}

// ---------------------------------------------------------------- B
console.log('\nB — DEATH CAM & KILL REPLAY (owner spec 2026-10-03)');

// B1 — the recorder ring: it wraps, it keeps the newest frames, and it never
// blows the documented ceiling (spec §2). Pushing 3× capacity through a fresh
// ring is what a long run costs, so the window must be a window, not a log.
{
  const rb = new ReplayBuffer();
  const killerSlot = rb.slotFor('ring-killer', 'THE HANDSHAKER', 'enemy', 'BOSS');
  const frames = REPLAY_SNAPSHOT_SLOTS * 3 + 10;
  for (let i = 0; i < frames; i++) {
    rb.advance(1 / REPLAY_HZ);
    rb.beginSnapshot(i, -60, 1.3);
    rb.writeActor(killerSlot, 200 + i * 0.1, 0, 60, 0, false, 'WINDUP', 0.02, 80, 100, true, false, false, true, 'KATANA');
    rb.writeActor(0, 0, 0, 0, 0, true, 'IDLE', 0, 100, 100, true, false, false, true, 'UNARMED');
    rb.endSnapshot();
  }
  check('the ring wraps instead of growing', rb.count === rb.capacity, `${rb.count}/${rb.capacity} slots after ${frames} frames`);
  check('the window keeps the newest frames after wraparound',
    rb.startTime > 1 && Math.abs(rb.endTime - rb.now()) < 1e-6,
    `window ${rb.startTime.toFixed(2)}s → ${rb.endTime.toFixed(2)}s`);
  check('the recorder stays inside the documented byte budget',
    rb.byteLength <= REPLAY_BYTE_BUDGET,
    `${rb.byteLength} B ≤ ${REPLAY_BYTE_BUDGET} B`);
}

// B2 — kill attribution: every authored EliminationType reaches the record
// with its weapon, its distance and the right kill-feed direction (spec §1).
{
  const victim = new EnemyController('attribution-victim', 60, 0, 'BASIC');
  const cases: { type: EliminationType; weapon: string; id: string; name: string; player: boolean }[] = [
    { type: 'SHOT', weapon: 'PISTOL', id: 'player', name: 'JOHN', player: true },
    { type: 'MELEE', weapon: 'KATANA', id: 'player', name: 'JOHN', player: true },
    { type: 'TAKEDOWN', weapon: 'UNARMED', id: 'player', name: 'JOHN', player: true },
    { type: 'EXECUTION', weapon: 'KNIFE', id: 'player', name: 'JOHN', player: true },
    { type: 'ENVIRONMENT', weapon: 'EXPLOSIVE_BARREL', id: '', name: 'THE BARREL', player: false },
  ];
  for (const c of cases) {
    clearEliminations();
    victim.health = 0;
    setAttackContext(c.type, c.id, c.name, c.weapon, 40, -60, 'TORSO');
    const rec = resolveEnemyElimination(victim, 12);
    check(`attribution resolves ${c.type} with a range`,
      !!rec && rec.type === c.type && rec.byPlayer === c.player && rec.weaponName.length > 0 && rec.distanceM > 0,
      rec ? `${rec.type}/${rec.weaponName} ${rec.distanceM.toFixed(2)}m by=${rec.byPlayer}` : 'no record');
  }
  clearEliminations();
  victim.health = 0;
  setAttackContext('ENVIRONMENT', '', 'THE BARREL', 'EXPLOSIVE_BARREL', 40, -60, 'TORSO');
  const envRec = resolveEnemyElimination(victim, 12);
  check('an environment kill claims no killer slot',
    !!envRec && envRec.killerSlot === REPLAY_NO_SLOT && !envRec.byPlayer,
    envRec ? `slot=${envRec.killerSlot}` : 'no record');
}

// B3 — reconstruction: the killer's recorded position at the lethal timestamp
// must be the position the replay will show (spec §4/§9).
const history = (() => {
  replayBuffer.clear();
  clearEliminations();
  const killerId = 'replay-killer';
  const killerSlot = replayBuffer.slotFor(killerId, 'THE HANDSHAKER', 'enemy', 'BOSS');
  const playerSlot = replayBuffer.slotFor('player', 'JOHN', 'player', 'BASIC');
  const frames = 30; // 2 s at 15 Hz
  let lastKillerX = 0;
  for (let i = 0; i < frames; i++) {
    replayBuffer.advance(1 / REPLAY_HZ);
    lastKillerX = 200 + i * 2;
    replayBuffer.beginSnapshot(0, -60, 1.3);
    replayBuffer.writeActor(killerSlot, lastKillerX, 0, 120, 0, false, 'WINDUP', 0.05, 80, 100, true, false, false, true, 'KATANA');
    replayBuffer.writeActor(playerSlot, 0, 0, 0, 0, true, 'HURT', 0.1, 100, 100, true, false, false, true, 'UNARMED');
    // One recorded muzzle event, right in the middle of the run-up — the
    // replay's flash/SFX sync is driven purely off these markers.
    if (i === 15) replayBuffer.recordShot(killerSlot, 'PISTOL', lastKillerX, -60);
    replayBuffer.endSnapshot();
  }
  setAttackContext('SHOT', killerId, 'THE HANDSHAKER', 'PISTOL', 240, -60, 'HEAD');
  const record = resolvePlayerElimination('JOHN', 0, 0, 100);
  return { record, lastKillerX, frames };
})();

{
  const { record, lastKillerX } = history;
  check('a player death resolves into a replay record',
    !!record && !!latestPlayerDeath() && record.onPlayer && record.killerName === 'THE HANDSHAKER',
    record ? `${record.type} by ${record.killerName}` : 'no record');
  check('the lethal timestamp sits on the recorded clock',
    !!record && Math.abs(record.timestamp - replayBuffer.endTime) < 1e-6,
    record ? `t=${record.timestamp.toFixed(2)}s end=${replayBuffer.endTime.toFixed(2)}s` : 'no record');

  const dc = new DeathCam(replayBuffer);
  check('the Death Cam arms on a player death with a full window',
    dc.start(record), `phase=${dc.phase}`);
  const at = dc.killerPositionAt(record.timestamp);
  check('the replay reconstructs the killer at the lethal timestamp',
    !!at && Math.abs(at.x - lastKillerX) < 1.5,
    at ? `x=${at.x.toFixed(1)} want≈${lastKillerX}` : 'no sample');
  const pAt = dc.playerPositionAt(record.timestamp);
  check('…and the victim beside them',
    !!pAt && Math.abs(pAt.x) < 1.5, pAt ? `x=${pAt.x.toFixed(1)}` : 'no sample');
}

// B4 — camera auto-select + the manual switch (spec §4).
{
  const sample = makeReplaySample();
  const a0 = sample.actors[0];
  a0.slot = 3; a0.kind = 'player'; a0.x = 0; a0.y = 0; a0.alive = true;
  const a1 = sample.actors[1];
  a1.slot = 5; a1.kind = 'enemy'; a1.x = 120; a1.y = 0; a1.alive = true;
  sample.actorCount = 2;
  check('both bodies readable -> two-shot',
    DeathCam.autoSelectMode(sample, 960, 5) === 'KILLER_WIDE', DeathCam.autoSelectMode(sample, 960, 5));
  check('two-shot will not fit -> tight on the killer',
    DeathCam.autoSelectMode(sample, 200, 5) === 'KILLER_CLOSE', DeathCam.autoSelectMode(sample, 200, 5));
  sample.actorCount = 1; // killer left the window
  check('no killer actor in the window -> overhead',
    DeathCam.autoSelectMode(sample, 960, 5) === 'OVERHEAD', DeathCam.autoSelectMode(sample, 960, 5));
  check('an unknown slot never frames as a body',
    DeathCam.autoSelectMode(sample, 960, 99) === 'OVERHEAD', DeathCam.autoSelectMode(sample, 960, 99));

  const manual = new DeathCam(replayBuffer);
  manual.applySettings({ enabled: true, cinematic: false });
  manual.setMode('CINEMATIC');
  check('CINEMATIC is gated off when the setting is off', manual.mode !== 'CINEMATIC', manual.mode);
  manual.setMode('OVERHEAD');
  check('a manual switch lands', manual.mode === 'OVERHEAD', manual.mode);
  manual.setMode('WIDE' as never);
  check('an unknown mode is ignored', manual.mode === 'OVERHEAD', manual.mode);
  manual.applySettings({ cinematic: true });
  manual.setMode('CINEMATIC');
  check('CINEMATIC arms once the setting allows it', manual.mode === 'CINEMATIC', manual.mode);
}

// B5 — the sequence itself: freeze → transition → replay → latch, plus the
// skip path, the auto-skip path and "Death Cam off" (spec §3, §5, §7).
{
  const { record } = history;
  const ghost = new EnemyController('replay-killer', 240, 0, 'BOSS');
  const cam = new Camera();
  let blooms = 0;
  const sink = { spawnMuzzleBloom: () => { blooms++; } };
  const soundWasOn = SoundFX.enabled;
  SoundFX.enabled = false;

  try {
    const dc = new DeathCam(replayBuffer);
    dc.applySettings({ enabled: true, duration: 3 });
    check('the freeze beat opens the sequence', dc.start(record) && dc.phase === 'FREEZE', dc.phase);
    check('the replay is not on screen during the freeze', !dc.replaying && !dc.overlayVisible);

    check('the reconstruction takes the screen', dc.beginReplay([ghost], 960), `phase=${dc.phase}`);
    check('the replay opens at the head of the window', dc.progress === 0, dc.progress.toFixed(3));
    check('the window never promises more history than exists',
      dc.windowSeconds > 0.2 && dc.windowSeconds <= 3 + 1e-6,
      `${dc.windowSeconds.toFixed(2)}s of a 3s setting`);

    let peak = 0;
    let frames = 0;
    while (dc.replaying && frames < 900) {
      dc.update(1 / 60, 960, 540, cam, [ghost], sink);
      peak = Math.max(peak, dc.progress);
      frames++;
    }
    check('the replay plays through to the end', dc.phase === 'OFF', `${frames} frames, phase=${dc.phase}`);
    check('the progress bar reaches 100% before it closes', peak >= 0.999, `peak=${peak.toFixed(3)}`);
    check('the reconstruction posed the recorded bodies',
      dc.frame().enemyCount === 1 && dc.frame().playerPose !== null,
      `enemies=${dc.frame().enemyCount} player=${dc.frame().playerPose ? 'yes' : 'no'}`);
    check('the end latches exactly once', dc.consumeFinished() && !dc.consumeFinished());
    check('a finished replay stops driving the audio clock', SoundFX.timeScale === 1);

    const skipper = new DeathCam(replayBuffer);
    skipper.applySettings({ enabled: true });
    skipper.start(record);
    skipper.beginReplay([ghost], 960);
    skipper.skip();
    check('SKIP drops straight out of the replay',
      skipper.phase === 'OFF' && skipper.consumeFinished() && !skipper.consumeFinished());

    const auto = new DeathCam(replayBuffer);
    auto.applySettings({ enabled: true, autoSkip: true });
    auto.start(record);
    check('auto-skip still runs the freeze beat', auto.phase === 'FREEZE', auto.phase);
    check('auto-skip then refuses the replay', auto.beginReplay([], 960) === false && auto.phase === 'OFF');

    const legacy = new DeathCam(replayBuffer);
    legacy.applySettings({ enabled: false });
    check('Death Cam off leaves the shipped flow alone',
      legacy.start(record) === false && legacy.phase === 'OFF' && !legacy.running);

    const empty = new DeathCam(new ReplayBuffer());
    check('no recorded history falls back to the shipped flow',
      empty.start(record) === false && !empty.running);
  } finally {
    SoundFX.enabled = soundWasOn;
  }
  check('the replay fires the recorded muzzle events', blooms >= 1, `${blooms} blooms`);
}

// B6 — settings: authored durations, sanitising, and persistence (spec §7).
{
  check('the authored duration list is exactly the four',
    DEATH_CAM_DURATIONS.join(',') === '3,4,5,6', DEATH_CAM_DURATIONS.join(','));
  check('a bogus duration falls back to the default', sanitizeDeathCamDuration(7, 4) === 4);
  check('a persisted duration is honoured', sanitizeDeathCamDuration(6, 4) === 6);
  check('a non-numeric duration falls back', sanitizeDeathCamDuration('wide', 4) === 4);

  const store = new Map<string, string>();
  const shim = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: () => null,
    get length() { return store.size; },
  };
  const scope = globalThis as unknown as { window?: unknown };
  const hadWindow = Object.prototype.hasOwnProperty.call(scope, 'window');
  const prevWindow = scope.window;
  scope.window = { localStorage: shim };
  try {
    saveSettings({
      ...DEFAULT_SETTINGS,
      deathCam: false,
      deathCamDuration: 6,
      deathCamCinematic: false,
      deathCamSlowMotion: false,
      deathCamShake: false,
      deathCamAutoSkip: true,
    });
    const back = loadSettings();
    check('every death cam setting survives a save/load round trip',
      back.deathCam === false && back.deathCamDuration === 6 && back.deathCamCinematic === false &&
      back.deathCamSlowMotion === false && back.deathCamShake === false && back.deathCamAutoSkip === true,
      `on=${back.deathCam} dur=${back.deathCamDuration} skip=${back.deathCamAutoSkip}`);

    saveSettings({ ...DEFAULT_SETTINGS, deathCamDuration: 42, deathCam: 'yes' } as unknown as GameSettings);
    const dirty = loadSettings();
    check('a corrupt death cam block falls back to the shipped defaults',
      dirty.deathCamDuration === 4 && dirty.deathCam === true,
      `dur=${dirty.deathCamDuration} on=${dirty.deathCam}`);
  } finally {
    if (hadWindow) scope.window = prevWindow;
    else delete scope.window;
  }
  const restored = loadSettings();
  check('storage back off, the shipped defaults still load',
    restored.deathCamDuration === 4 && restored.deathCam === true,
    `dur=${restored.deathCamDuration}`);
}

console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

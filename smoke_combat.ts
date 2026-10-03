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

console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

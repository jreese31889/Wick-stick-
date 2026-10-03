/**
 * PHASE 3 1 — the single source of truth for the gamepad layout.
 *
 * InputManager.poll() implements exactly this table; the touch button badges,
 * How-to-Play grid, pause-menu footer and combat manual all read from here,
 * so a binding can never be documented one way and shipped another.
 *
 * Standard layout (PHASE 3):
 *   Left stick / D-pad move · Right stick aim · RT fire · LT ADS (hold)
 *   A jump · B dodge · X context (interact / reload) · Y weapon swap
 *   LB punch · RB kick · L3 block · R3 grab · Select focus · Start pause
 */
export interface PadBindingRow {
  action: string;
  pad: string;
  touch: string;
}

export const PAD_BINDINGS: PadBindingRow[] = [
  { action: 'Move', pad: 'Left stick / D-pad', touch: 'Left-thumb joystick' },
  { action: 'Aim (precision)', pad: 'Right stick / hold LT', touch: 'Aim pad (bottom centre)' },
  { action: 'Punch', pad: 'LB (L1)', touch: 'PUNCH button' },
  { action: 'Kick', pad: 'RB (R1)', touch: 'KICK button' },
  { action: 'Combo special', pad: 'Hold LB + RB', touch: 'Hold PUNCH + KICK' },
  { action: 'Block / parry', pad: 'L3 (left stick click)', touch: 'BLOCK button' },
  { action: 'Grab / takedown', pad: 'R3 (right stick click)', touch: 'GRAB button' },
  { action: 'Dodge roll', pad: 'B (Circle)', touch: 'DODGE button' },
  { action: 'Jump', pad: 'A (Cross)', touch: 'JUMP button' },
  { action: 'Shoot gun', pad: 'RT (R2)', touch: 'SHOOT button' },
  { action: 'Interact / reload', pad: 'X (context)', touch: 'ACTION / RELOAD button' },
  { action: 'Swap firearm', pad: 'Y (Triangle)', touch: 'SWAP button' },
  { action: 'Bullet-time focus', pad: 'Select / Share', touch: 'FOCUS button · two-finger tap' },
  { action: 'Finisher', pad: 'Chain 5+ hits, then strike', touch: 'Chain 5+ hits, then strike' },
  { action: 'Pause', pad: 'Start / Menu', touch: 'Pause button (top right)' },
];

/** Compact pad badge shown on each touch control (TouchControlId keys). */
export const PAD_BADGE: Record<string, string> = {
  punch: 'LB',
  kick: 'RB',
  block: 'L3',
  grab: 'R3',
  dodge: 'B',
  jump: 'A',
  shoot: 'RT',
  swap: 'Y',
  reload: 'X',
  interact: 'X',
  focus: 'SEL',
  joystick: '',
  aimpad: '',
};

/** One-line legend for the pause menu / HUD while a pad is connected. */
export function padFooterHint(padName: string): string {
  return `${padName}: A jump · B dodge · LB/RB combo · X interact · Y swap · Start pause`;
}

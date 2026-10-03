/**
 * PHASE 2 — cosmetic palettes.
 *
 * The stick figure and every weapon are drawn straight from these two plain
 * records, so a skin / tint is nothing more than an Object.assign into module
 * state that the renderer reads on the next frame. No render path changes, no
 * per-frame allocation, and the shipped defaults live here as the baseline —
 * at boot (before any profile is applied) the game looks byte-identical to
 * Phase 1B.
 */

/**
 * Body / tie / accent colourway for the player rig (StickRig).
 *
 * OWNER 2026-10-03: the player has NO suit — a plain stick figure whose only
 * garment is the red tie, so `tie` ships red and is not skin-overridable
 * (the signature stays constant across colourways).
 */
export interface PlayerPalette {
  /** Bright body stroke — front limbs and torso fill */
  ivory: string;
  /** Back limbs sit one shade deeper for depth without going dark */
  ivoryBack: string;
  /** Legacy foot/fist shade kept for saved colourway data */
  shoe: string;
  /** Dark outline pass drawn underneath everything */
  outline: string;
  /** Legacy shirt fields kept so saved skins stay valid (no suit is drawn) */
  shirt: string;
  shirtEdge: string;
  /** The one garment: the red necktie (signature, constant across skins) */
  tie: string;
  cuff: string;
  /** Rim glow rgb prefix (alpha appended per draw) */
  glow: string;
  /** Brow / interior detail mark */
  detail: string;
}

/** Shipped John Stick colourway — plain ivory figure, signature red tie. */
export const DEFAULT_PLAYER_PALETTE: PlayerPalette = {
  ivory: '#f6efdf',
  ivoryBack: '#e3dbc7',
  shoe: '#c9c0aa',
  outline: '#08090e',
  shirt: '#ffffff',
  shirtEdge: '#14151c',
  tie: '#d92626',
  cuff: '#ffffff',
  glow: '255, 240, 206',
  detail: '#1b1c24',
};

/** Live palette the rig reads while drawing — mutated only by skin swaps. */
export const PLAYER_STYLE: PlayerPalette = { ...DEFAULT_PLAYER_PALETTE };

/** Paints a skin onto the live palette (defaults fill any missing field). */
export function applyPlayerPalette(palette: Partial<PlayerPalette>): void {
  Object.assign(PLAYER_STYLE, DEFAULT_PLAYER_PALETTE, palette);
  // Owner mandate: the necktie is the player's one garment and its colour is
  // part of the character read — colourways repaint the body, never the tie.
  PLAYER_STYLE.tie = DEFAULT_PLAYER_PALETTE.tie;
}

/** Accent colours for blades and firearms (StickRig + Renderer pickups). */
export interface WeaponTintPalette {
  /** Grip / handle wrap */
  grip: string;
  /** Katana tsuba + small hardware accents */
  guard: string;
  /** Polished blade / knife steel */
  blade: string;
  /** Firearm slide + frame body */
  slide: string;
  /** Small inline accents on pickups (sights, rails) */
  accent: string;
  /** Rear sight / optic pip */
  sight: string;
  /** Blade bloom stroke (rgba string) */
  glow: string;
}

/** Shipped steel + amber tint — the exact Phase 1B weapon colours. */
export const DEFAULT_WEAPON_TINT: WeaponTintPalette = {
  grip: '#18181b',
  guard: '#d97706',
  blade: '#f8fafc',
  slide: '#18181b',
  accent: '#7dd3fc',
  sight: '#fbbf24',
  glow: 'rgba(217, 249, 157, 0.4)',
};

/** Live weapon tint the rig + renderer read while drawing. */
export const WEAPON_TINT: WeaponTintPalette = { ...DEFAULT_WEAPON_TINT };

/** Paints a weapon tint onto the live palette (defaults fill missing fields). */
export function applyWeaponTintPalette(palette: Partial<WeaponTintPalette>): void {
  Object.assign(WEAPON_TINT, DEFAULT_WEAPON_TINT, palette);
}

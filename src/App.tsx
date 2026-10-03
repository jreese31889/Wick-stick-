import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { GameLoop } from './engine/GameLoop';
import { GUNS } from './engine/Weapons';
import { GameCanvas } from './components/GameCanvas';
import { VirtualControls } from './components/VirtualControls';
import {
  Activity,
  Cpu,
  Eye,
  Gamepad2,
  Smartphone,
  HelpCircle,
  Volume2,
  VolumeX,
  RotateCcw,
  Zap,
  Coins,
  Shield,
  Award,
  Sparkles,
  Sword,
  Check,
  DoorOpen,
  X,
  Plus,
  Pause,
  Play,
  Target,
  Bot,
  Trophy
} from 'lucide-react';
import { SoundFX } from './engine/SoundFX';
import { Haptics } from './engine/Haptics';
import { Music } from './engine/Music';
import { AIAgentsModal } from './components/AIAgentsModal';
import { HowToPlayModal } from './components/HowToPlayModal';
import { RotateDeviceOverlay } from './components/RotateDeviceOverlay';
import { useLandscapeLock, shouldShowRotateHint } from './hooks/useLandscapeLock';
import { MainMenu } from './components/MainMenu';
import { PauseMenu } from './components/PauseMenu';
import { OptionsModal } from './components/OptionsModal';
import { TouchLayoutEditor } from './components/TouchLayoutEditor';
import { StageSelectModal, STAGES, getNextStage, TRAINING_STAGE } from './components/StageSelectModal';
import type { StageDef } from './components/StageSelectModal';
import { TrainingPanel } from './components/TrainingPanel';
import { setDifficulty } from './engine/Difficulty';
import { GameOverScreen } from './components/GameOverScreen';
import type { RunStats } from './components/GameOverScreen';
import {
  applyQuality,
  applyMusicVolume,
  applySfxVolume,
  loadProgress,
  loadSettings,
  saveProgress,
  saveSettings,
} from './components/settings';
import type { GameProgress, GameSettings, TouchControlId, TouchLayout } from './components/settings';
import { initBackButton, exitApp, setScreenAwake, isNativePlatform, installTouchGuards } from './platform/Platform';
import {
  loadProfile,
  saveProfile,
  resetProfile as resetProfileStore,
  type GameProfile,
} from './profile/ProfileStore';
import {
  grantXp,
  computeRunProfile,
  refreshUnlocks,
  evaluateAchievements,
  styleRankIndex,
  xpToNext,
  XP_VALUES,
} from './profile/Progression';
import {
  ACHIEVEMENT_MAP,
  UNLOCK_MAP,
  UPGRADE_MAP,
  upgradeCost,
  SKIN_PALETTES,
  TINT_PALETTES,
  type UpgradeId,
} from './profile/Catalogs';
import { onProgress, PROGRESS_EVENTS, type ProgressEvent } from './profile/ProgressEvents';
import { applyPlayerPalette, applyWeaponTintPalette } from './engine/Palettes';
import { UpgradesModal } from './components/UpgradesModal';
import { AppearanceModal } from './components/AppearanceModal';
import { AchievementsModal } from './components/AchievementsModal';
import { ProfileStatsModal } from './components/ProfileStatsModal';
import { ProgressionToasts, type ProgressToast } from './components/ProgressionToasts';

export interface MilestoneItem {
  id: number;
  title: string;
  description: string;
  category: string;
  reward: string;
  check: (gameLoop: GameLoop) => boolean;
}

const MILESTONES_CATALOG: MilestoneItem[] = [
  {
    id: 1,
    title: 'Milestone 1: Initiation',
    description: 'Master procedural stick locomotion, slide sweeps, and combat dodge rolls.',
    category: 'Fundamentals',
    reward: '+50 Style Points',
    check: () => true, // Initialized
  },
  {
    id: 2,
    title: 'Milestone 2: Martial Discipline',
    description: 'Chain a 5x Combo strike or execute a frame-perfect parry stun.',
    category: 'Combat Arts',
    reward: '+100 Style Points',
    check: (g) => g.combatDirector.stats.maxCombo >= 5 || g.combatDirector.stats.parryCount >= 1,
  },
  {
    id: 3,
    title: 'Milestone 3: Gun-Fu Mastery',
    description: 'Deliver a close-quarters point-blank execution shot (<95px).',
    category: 'Marksmanship',
    reward: 'Tactical Quickdraw',
    check: (g) => g.combatDirector.stats.takedownCount >= 1,
  },
  {
    id: 4,
    title: 'Milestone 4: Collateral Havoc',
    description: 'Shatter champagne tables and glass display partition exhibits.',
    category: 'Environment',
    reward: 'Glass Edge',
    check: (g) => g.environmentManager.destructibles.some(d => d.isBroken) || g.player.physics.coins > 0,
  },
  {
    id: 5,
    title: 'Milestone 5: Continental Specie',
    description: 'Requisition black-market perks from the Continental Armory using Gold Coins.',
    category: 'High Table Vault',
    reward: 'Continental Seal',
    check: (g) => Object.values(g.player.physics.perks).some(Boolean),
  },
  {
    id: 6,
    title: 'Milestone 6: High Table Master Duel',
    description: 'Face and eliminate the High Table Master Boss in single combat.',
    category: 'Boss Duel',
    reward: 'Gold Sovereign',
    check: (g) => g.waveNumber >= 4 && (g.enemies.some(e => e.type === 'BOSS' && e.health <= 0) || g.waveNumber > 4),
  },
  {
    id: 7,
    title: 'Milestone 7: Apex Baba Yaga',
    description: 'Overcome the new Vanguard Defender (shield guard) and Shadow Elite Shinobi assassin.',
    category: 'Elite Syndicate',
    reward: 'Legendary Status',
    check: (g) => g.waveNumber >= 5 || g.enemies.some(e => (e.type === 'DEFENDER' || e.type === 'ELITE') && e.health <= 0),
  },
  {
    id: 8,
    title: 'Milestone 8: The Marquis Protocol',
    description: 'Confront and eliminate High Table Grandmaster Marquis de Gramont in single combat.',
    category: 'Sovereign Endgame',
    reward: 'Sovereign Magnum & Dual Stance',
    check: (g) => g.waveNumber >= 6 && (g.enemies.some(e => e.type === 'MARQUIS' && e.health <= 0) || g.waveNumber > 6),
  },
];

const PERK_CATALOG = [
  {
    id: 'KEVLAR_WEAVE' as const,
    name: 'Kevlar Ballistic Weave',
    cost: 5,
    description: '+30 Maximum Health and 20% ballistic damage reduction.',
    badge: 'Defense'
  },
  {
    id: 'ADRENALINE_INFUSION' as const,
    name: 'Adrenaline Infusion',
    cost: 6,
    description: '+57% Stamina recovery rate during fluid martial-arts maneuvers.',
    badge: 'Agility'
  },
  {
    id: 'EXTENDED_MAG' as const,
    name: 'Extended 9mm Mag',
    cost: 7,
    description: 'Expands tactical pistol magazine capacity from 7 to 12 rounds.',
    badge: 'Gun-Fu'
  },
  {
    id: 'LETHAL_BLADE' as const,
    name: 'Lethal Edge Honing',
    cost: 8,
    description: 'Katana and Tactical Knife deliver +12 lethal damage and +8 weapon durability.',
    badge: 'Armory'
  },
  {
    id: 'VAMPIRIC_TAKEDOWN' as const,
    name: 'Vampiric Execution',
    cost: 10,
    description: 'Siphon +25 Health directly on every cinematic execution takedown.',
    badge: 'Mastery'
  },
  {
    id: 'BULLET_DEFLECT' as const,
    name: 'Steel Mirror Deflection',
    cost: 12,
    description: 'Frame-perfect Katana strikes deflect hostile gunfire back into syndicate enforcers.',
    badge: 'Mastery'
  },
  {
    id: 'SOVEREIGN_MAGNUM' as const,
    name: 'Sovereign Heavy Magnum',
    cost: 15,
    description: 'High-caliber gold ordnance deals +40 damage and bypasses ballistic shield defense.',
    badge: 'High Table'
  },
];

const PERK_ICONS: Record<typeof PERK_CATALOG[number]['id'], typeof Shield> = {
  KEVLAR_WEAVE: Shield,
  ADRENALINE_INFUSION: Zap,
  EXTENDED_MAG: Sparkles,
  LETHAL_BLADE: Sword,
  VAMPIRIC_TAKEDOWN: Award,
  BULLET_DEFLECT: Sparkles,
  SOVEREIGN_MAGNUM: Target,
};

/**
 * PHASE 4 E5 — how hot the run score should be right now.
 *   0 explore (squad wiped) · 1 tension (alive, still at range)
 *   2 combat (engaged)     · 3 boss (High Table duellist standing)
 * A single pass over the squad, no allocation — safe at the tracker's 4 Hz.
 */
function sampleScoreIntensity(loop: GameLoop): number {
  let alive = 0;
  let engaged = 0;
  let boss = false;
  const playerX = loop.player.physics.position.x;
  for (const enemy of loop.enemies) {
    if (enemy.health <= 0 || enemy.state === 'DOWNED') continue;
    alive++;
    if (enemy.type === 'BOSS' || enemy.type === 'MARQUIS') boss = true;
    const gap = Math.abs(enemy.position.x - playerX);
    if (gap < 420 || enemy.state === 'WINDUP' || enemy.state === 'ATTACK') engaged++;
  }
  if (boss) return 3;
  if (engaged > 0) return 2;
  if (alive > 0) return 1;
  return 0;
}

export default function App() {
  const gameLoop = useMemo(() => new GameLoop(), []);
  const [, setTick] = useState(0);
  const [showDebug, setShowDebug] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [showPerks, setShowPerks] = useState(false);
  const [showMilestones, setShowMilestones] = useState(false);
  const [showAIAgents, setShowAIAgents] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showStageSelect, setShowStageSelect] = useState(false);
  const [showVictory, setShowVictory] = useState(false);
  // PHASE 2 progression screens
  const [showUpgrades, setShowUpgrades] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [rotateDismissed, setRotateDismissed] = useState(false);
  // PHASE 3 2: touch layout editor (draft saved only on "Save layout")
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);
  const [layoutDraft, setLayoutDraft] = useState<TouchLayout | null>(null);
  // PHASE 3 5: Android back at the root screen → confirm before leaving
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // Persistent settings (audio / graphics / HUD) + career progression
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  const [progress, setProgress] = useState<GameProgress>(loadProgress);
  const [activeStage, setActiveStage] = useState<StageDef>(STAGES[0]);
  const [kills, setKills] = useState(0);
  const [runTimeSec, setRunTimeSec] = useState(0);

  // Run telemetry lives in refs so the 250ms tracker can update it cheaply
  const killsRef = useRef(0);
  const deadEnemiesRef = useRef<WeakSet<object>>(new WeakSet());
  const runSecondsRef = useRef(0);
  const trackerLastTickRef = useRef(0);
  const displayedSecondsRef = useRef(0);
  // 'latched' = this run already produced a victory; 'open' = overlay is up (clock frozen)
  const victoryLatchedRef = useRef(false);
  const victoryOpenRef = useRef(false);
  const clearedWaveRef = useRef<number | null>(null);

  // Landscape-first launch: fullscreen + Screen Orientation API lock
  const { isPortrait, lockSupported, lockLandscape } = useLandscapeLock();

  // Re-arm the rotate hint whenever the device goes back to landscape
  useEffect(() => {
    if (!isPortrait) setRotateDismissed(false);
  }, [isPortrait]);

  const handleStateUpdate = useCallback(() => {
    setTick(t => (t + 1) % 1000);
  }, []);

  // P6B-05: the perf chip is painted straight into the DOM by the engine
  // loop (fps + update/render ms), so the 0.5 s telemetry tick never has to
  // wake React just to refresh a number.
  const perfSpanRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    gameLoop.perfSpanEl = perfSpanRef.current;
    gameLoop.updatePerfSpan();
  }, [gameLoop, settings.showFps]);

  // P6-02: surface the FX/pool/pose counters while the Rig debug toggle is on
  useEffect(() => {
    gameLoop.debugStatsEnabled = showDebug;
    gameLoop.updatePerfSpan();
  }, [gameLoop, showDebug]);

  /** Drops any held virtual inputs so a paused/frozen screen can't leave one latched. */
  const clearVirtualInputs = useCallback(() => {
    const input = gameLoop.inputManager;
    input.setVirtualJoystick(0, 0);
    input.setVirtualAim(0, 0, false);
    const buttons = [
      'jump', 'dodge', 'attack', 'heavy', 'block',
      'grab', 'shoot', 'reload', 'interact', 'focus', 'special', 'swap',
    ] as const;
    for (const button of buttons) input.setVirtualButton(button, false);
  }, [gameLoop]);

  const toggleDebug = () => {
    const next = !showDebug;
    setShowDebug(next);
    gameLoop.debugMode = next;
  };

  const toggleSound = () => {
    const active = gameLoop.toggleSound();
    setIsMuted(!active);
    // Keep the persisted volume in sync with the HUD mute button.
    setSettings(s => ({
      ...s,
      sfxVolume: active ? (s.sfxVolume > 0 ? s.sfxVolume : 60) : 0,
    }));
  };

  const handleReset = () => {
    gameLoop.resetFight();
  };

  const togglePause = useCallback(() => {
    // Pause only exists mid-run: never from the title, game-over or victory.
    // PHASE 3 2: the layout editor owns the screen, so pausing/resuming is
    // locked out until it is saved or cancelled.
    if (layoutEditorOpen) return;
    if (!hasStarted || gameLoop.isGameOver || victoryOpenRef.current) return;
    const willPause = !gameLoop.isPaused;
    if (willPause) clearVirtualInputs();
    gameLoop.togglePause();
    setTick(t => (t + 1) % 1000);
  }, [gameLoop, hasStarted, clearVirtualInputs, layoutEditorOpen]);

  const togglePauseRef = useRef(togglePause);

  // ============================================================
  // PHASE 2 — persistent profile: XP / levels, banked coins, unlocks,
  // upgrades, achievements and lifetime stats.
  //
  // The profile object is the single mutable source of truth; it is
  // written in place and mirrored to localStorage only on event-driven
  // commits (wave clear, purchase, unlock, run end, settings change) —
  // never per frame.
  // ============================================================
  const profileRef = useRef<GameProfile | null>(null);
  if (profileRef.current === null) {
    profileRef.current = loadProfile();
    // Boot paint: the equipped cosmetics win before the first frame renders.
    applyPlayerPalette(SKIN_PALETTES[profileRef.current.selectedSkin]);
    applyWeaponTintPalette(TINT_PALETTES[profileRef.current.selectedTint]);
  }
  /** Coins swept out of the run purse during THIS run (end-screen total). */
  const runBankRef = useRef(0);
  /** Last wave number that paid a WAVE_CLEAR (debug spawns can re-wipe). */
  const lastClearedWaveRef = useRef<number | null>(null);
  const toastIdRef = useRef(1);
  const [toasts, setToasts] = useState<ProgressToast[]>([]);

  /** Stacks a progression notification (max 3) that self-expires. */
  const pushToast = useCallback((toast: Omit<ProgressToast, 'id'>) => {
    const id = toastIdRef.current++;
    setToasts((prev) => [...prev.slice(-2), { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  /** Grants XP and narrates any level-up with a toast + fanfare. */
  const grantXpWithToast = useCallback(
    (amount: number) => {
      const p = profileRef.current;
      if (!p || amount <= 0) return;
      const levels = grantXp(p, amount);
      if (levels > 0) {
        SoundFX.playLevelUp();
        pushToast({
          kind: 'level',
          title: `LEVEL ${p.level}`,
          body: 'New gear unlocked — see Safehouse & Wardrobe',
        });
      }
    },
    [pushToast]
  );

  /**
   * Settles a mutated profile: grants now-qualified unlocks, evaluates
   * achievements, pays their coin/XP rewards (which can cascade into more
   * levels/unlocks), persists, and wakes the UI. One save per call.
   */
  const commitProfile = useCallback(() => {
    const p = profileRef.current;
    if (!p) return;
    let rounds = 0;
    while (rounds++ < 8) {
      const unlockedIds = refreshUnlocks(p);
      const achievementIds = evaluateAchievements(p);
      if (unlockedIds.length === 0 && achievementIds.length === 0) break;
      for (const id of unlockedIds) {
        const def = UNLOCK_MAP[id];
        pushToast({
          kind: 'unlock',
          title: 'UNLOCKED',
          body: def ? `${def.name} — ${def.description}` : id,
        });
      }
      for (const id of achievementIds) {
        const def = ACHIEVEMENT_MAP[id];
        if (!def) continue;
        p.coins += def.rewardCoins;
        SoundFX.playAchievement();
        pushToast({
          kind: 'achievement',
          title: def.title,
          body: `+${def.rewardCoins} coins • +${def.rewardXp} XP`,
        });
        grantXpWithToast(def.rewardXp);
      }
    }
    saveProfile(p);
    setTick((t) => (t + 1) % 1000);
  }, [pushToast, grantXpWithToast]);

  /** Sweeps the run purse into the bank and folds it into lifetime earnings. */
  const bankCoins = useCallback(() => {
    const p = profileRef.current;
    if (!p) return;
    const purse = gameLoop.player.physics.coins;
    if (purse <= 0) return;
    gameLoop.player.physics.coins = 0;
    p.coins += purse;
    p.stats.coinsEarned += purse;
    runBankRef.current += purse;
  }, [gameLoop]);

  /** Gameplay events → XP, lifetime stats, banking and achievement checks. */
  const handleProgressEvent = useCallback(
    (event: ProgressEvent) => {
      const p = profileRef.current;
      if (!p) return;
      const data = event.data ?? {};
      const num = (key: string) => (typeof data[key] === 'number' ? (data[key] as number) : 0);

      switch (event.type) {
        case PROGRESS_EVENTS.KILL: {
          p.stats.kills += 1;
          if (data.env) p.stats.envKills += 1;
          if (data.boss) p.stats.bossKills += 1;
          grantXpWithToast(
            data.boss ? XP_VALUES.BOSS_KILL : data.heavy ? XP_VALUES.HEAVY_KILL : XP_VALUES.KILL
          );
          commitProfile();
          break;
        }
        case PROGRESS_EVENTS.EXECUTION: {
          p.stats.executions += 1;
          grantXpWithToast(XP_VALUES.EXECUTION);
          gameLoop.player.grantFocus(gameLoop.player.focusGainRatio);
          commitProfile();
          break;
        }
        case PROGRESS_EVENTS.DISARM: {
          p.stats.disarms += 1;
          commitProfile();
          break;
        }
        case PROGRESS_EVENTS.RICOCHET_KILL: {
          p.stats.ricochetKills += 1;
          commitProfile();
          break;
        }
        case PROGRESS_EVENTS.WAVE_CLEAR: {
          const wave = Math.max(1, num('wave'));
          if (lastClearedWaveRef.current === wave) break;
          lastClearedWaveRef.current = wave;
          bankCoins();
          p.stats.wavesCleared += 1;
          p.stats.bestWave = Math.max(p.stats.bestWave, wave);
          p.stats.bestCombo = Math.max(p.stats.bestCombo, num('maxCombo'));
          const rank = typeof data.styleRank === 'string' ? data.styleRank : 'D';
          p.stats.bestStyleRank = Math.max(p.stats.bestStyleRank, styleRankIndex(rank));
          if (num('damageTaken') <= 0) p.stats.noDamageWaves += 1;
          grantXpWithToast(XP_VALUES.WAVE_CLEAR + (XP_VALUES.STYLE_BONUS[rank] ?? 0));
          commitProfile();
          break;
        }
        default:
          break;
      }
    },
    [commitProfile, grantXpWithToast, bankCoins, gameLoop]
  );

  // Subscribe once per handler identity (both are stable across renders).
  useEffect(() => onProgress(handleProgressEvent), [handleProgressEvent]);

  /** PHASE 2: buys the next tier of a Safehouse upgrade with banked coins. */
  const buyUpgrade = (id: UpgradeId) => {
    const p = profileRef.current;
    if (!p) return;
    bankCoins(); // purse counts toward the spendable balance
    const tier = p.upgrades[id] ?? 0;
    const def = UPGRADE_MAP[id];
    const cost = upgradeCost(id, tier);
    if (!def || cost <= 0 || p.coins < cost) return;
    p.coins -= cost;
    p.upgrades[id] = tier + 1;
    SoundFX.playCoinPickup();
    commitProfile();
  };

  /** Applies a selected loadout / figure colourway / tint (unlocked ids only). */
  const selectCosmetic = (kind: 'loadout' | 'skin' | 'tint', id: string) => {
    const p = profileRef.current;
    if (!p || !p.unlocks.includes(id)) return;
    if (kind === 'loadout') p.selectedLoadout = id;
    else if (kind === 'skin') p.selectedSkin = id;
    else p.selectedTint = id;
    if (kind === 'skin') applyPlayerPalette(SKIN_PALETTES[id]);
    if (kind === 'tint') applyWeaponTintPalette(TINT_PALETTES[id]);
    SoundFX.playGunCock();
    commitProfile();
  };

  /** Wipes progression (Options → Reset Profile) but keeps audio/graphics. */
  const handleResetProfile = useCallback(() => {
    const fresh = resetProfileStore();
    fresh.settings = { ...settings };
    profileRef.current = fresh;
    applyPlayerPalette(SKIN_PALETTES[fresh.selectedSkin]);
    applyWeaponTintPalette(TINT_PALETTES[fresh.selectedTint]);
    saveProfile(fresh);
    pushToast({ kind: 'info', title: 'PROFILE WIPED', body: 'Level, coins and unlocks reset' });
    setTick((t) => (t + 1) % 1000);
  }, [settings, pushToast]);

  const buyPerk = (perkId: typeof PERK_CATALOG[number]['id'], cost: number) => {
    // PHASE 2: sweep the purse first so banked + field coins buy perks.
    bankCoins();
    const p = profileRef.current;
    if (p && p.coins >= cost && !physics.perks[perkId]) {
      p.coins -= cost;
      gameLoop.player.applyPerk(perkId);
      SoundFX.playCoinPickup();
      commitProfile();
    }
  };

  /** Resets the run clock, kill tally and victory latch for a fresh contract. */
  const resetRunTelemetry = useCallback(() => {
    killsRef.current = 0;
    setKills(0);
    runSecondsRef.current = 0;
    displayedSecondsRef.current = 0;
    setRunTimeSec(0);
    trackerLastTickRef.current = performance.now();
    victoryLatchedRef.current = false;
    victoryOpenRef.current = false;
    clearedWaveRef.current = null;
    // PHASE 2: fresh run — new coin ledger, new wave-clear payout window
    runBankRef.current = 0;
    lastClearedWaveRef.current = null;
    // PHASE 4 E5: back to the explore pulse until the squad shows up
    Music.setIntensity(0);
    setShowVictory(false);
  }, []);

  /**
   * G7 — boots the Training Arena: three spawnable dummies, the mechanic
   * checklist, no contract writes and a fighter that cannot die. Runs the
   * same profile paint as a contract so ammo / loadout behave identically.
   */
  const startTraining = useCallback(() => {
    void lockLandscape(true);
    clearVirtualInputs();
    resetRunTelemetry();

    gameLoop.fullReset();
    const p = profileRef.current;
    if (p) gameLoop.applyRunProfile(computeRunProfile(p));
    // fullReset drops the drill (every contract boot does) — enter AFTER it.
    gameLoop.enterTraining();
    gameLoop.setPaused(false);

    setActiveStage(TRAINING_STAGE);
    setHasStarted(true);
    setShowStageSelect(false);
    setShowOptions(false);
    setShowPerks(false);
    setShowMilestones(false);
    setShowAIAgents(false);
    setShowHelp(false);
    setShowHowToPlay(false);
    setShowUpgrades(false);
    setShowAppearance(false);
    setShowAchievements(false);
    setShowProfile(false);
    setLayoutEditorOpen(false);
    SoundFX.playDoorOpen();
    setTick(t => (t + 1) % 1000);
  }, [gameLoop, lockLandscape, clearVirtualInputs, resetRunTelemetry]);

  /** Boots the game straight into a chosen stage with a fresh fighter. */
  const startStage = useCallback(
    (stage: StageDef) => {
      // G7: the training card (and any restart on it) boots the drill —
      // it must never fall through into spawnSquad and mint a contract.
      if (stage.id === 0) {
        startTraining();
        return;
      }
      void lockLandscape(true);
      clearVirtualInputs();
      resetRunTelemetry();

      gameLoop.fullReset();
      // PHASE 2: paint damage / health / speed / focus / loadout onto the run
      const p = profileRef.current;
      if (p) gameLoop.applyRunProfile(computeRunProfile(p));
      gameLoop.waveNumber = stage.wave;
      if (stage.spawn === 'boss') gameLoop.spawnBossDuel();
      else if (stage.spawn === 'elite') gameLoop.spawnEliteDuo();
      else if (stage.spawn === 'marquis') gameLoop.spawnMarquisDuel();
      else gameLoop.spawnSquad(stage.squad);
      gameLoop.setPaused(false);

      setActiveStage(stage);
      setHasStarted(true);
      setShowStageSelect(false);
      setShowOptions(false);
      setShowPerks(false);
      setShowMilestones(false);
      setShowAIAgents(false);
      setShowHelp(false);
      setShowHowToPlay(false);
      setShowUpgrades(false);
      setShowAppearance(false);
      setShowAchievements(false);
      setShowProfile(false);
      setLayoutEditorOpen(false);
      SoundFX.playDoorOpen();
    },
    [gameLoop, lockLandscape, clearVirtualInputs, resetRunTelemetry, startTraining]
  );

  const restartStage = useCallback(() => {
    startStage(activeStage);
  }, [startStage, activeStage]);

  /** G7 — leaves the drill and lands back on the contract board. */
  const exitTraining = useCallback(() => {
    clearVirtualInputs();
    resetRunTelemetry();
    gameLoop.fullReset();
    gameLoop.setPaused(true);
    setHasStarted(false);
    setShowStageSelect(true);
    setShowOptions(false);
    setTick(t => (t + 1) % 1000);
  }, [gameLoop, clearVirtualInputs, resetRunTelemetry]);

  /** Quit to the title screen with a clean slate. */
  const goToTitle = useCallback(() => {
    // PHASE 2: sweep the purse before fullReset drops the fighter's coins
    bankCoins();
    commitProfile();
    clearVirtualInputs();
    resetRunTelemetry();
    gameLoop.fullReset();
    gameLoop.setPaused(true);
    setHasStarted(false);
    setShowStageSelect(false);
    setShowOptions(false);
    setShowPerks(false);
    setShowMilestones(false);
    setShowAIAgents(false);
    setShowHelp(false);
    setShowHowToPlay(false);
    setShowUpgrades(false);
    setShowAppearance(false);
    setShowAchievements(false);
    setShowProfile(false);
    setLayoutEditorOpen(false);
    setShowExitConfirm(false);
    setTick(t => (t + 1) % 1000);
  }, [gameLoop, clearVirtualInputs, resetRunTelemetry, bankCoins, commitProfile]);

  /** Stage cleared → record progression (unlocks the next contract). */
  const recordWaveCleared = useCallback((wave: number) => {
    setProgress(prev => {
      const stage = STAGES.find(s => s.wave === wave && !s.endless);
      const clearedStages =
        stage && !prev.clearedStages.includes(stage.id) ? [...prev.clearedStages, stage.id] : prev.clearedStages;
      return {
        ...prev,
        clearedStages,
        highestWaveCleared: Math.max(prev.highestWaveCleared, wave),
      };
    });
  }, []);

  /** Wave 6 Marquis falls → the High Table is toppled. */
  const triggerVictory = useCallback(() => {
    victoryLatchedRef.current = true;
    victoryOpenRef.current = true;
    clearVirtualInputs();
    gameLoop.setPaused(true);
    const stats = gameLoop.combatDirector.stats;
    const timeSec = Math.floor(runSecondsRef.current);
    setProgress(prev => ({
      ...prev,
      victories: prev.victories + 1,
      bestScore: Math.max(prev.bestScore, stats.score),
      bestMaxCombo: Math.max(prev.bestMaxCombo, stats.maxCombo),
      bestKills: Math.max(prev.bestKills, killsRef.current),
      bestTimeSec: prev.bestTimeSec > 0 ? Math.min(prev.bestTimeSec, timeSec) : timeSec,
    }));
    // PHASE 2: lifetime victory + coin sweep for the profile
    const p = profileRef.current;
    if (p) {
      p.stats.victories += 1;
      p.stats.bestCombo = Math.max(p.stats.bestCombo, stats.maxCombo);
      bankCoins();
      commitProfile();
    }
    setShowVictory(true);
    setTick(t => (t + 1) % 1000);
  }, [gameLoop, clearVirtualInputs, bankCoins, commitProfile]);

  const continueEndless = useCallback(() => {
    clearVirtualInputs();
    victoryOpenRef.current = false;
    setShowVictory(false);
    gameLoop.setPaused(false);
    gameLoop.nextWave();
    SoundFX.playDoorOpen();
    setTick(t => (t + 1) % 1000);
  }, [gameLoop, clearVirtualInputs]);

  const updateSettings = useCallback((patch: Partial<GameSettings>) => {
    setSettings(prev => ({ ...prev, ...patch }));
  }, []);

  /* PHASE 3 2 — touch layout editor session -------------------------- */
  const openLayoutEditor = useCallback(() => {
    setLayoutDraft(settings.touchLayout);
    setShowOptions(false);
    setLayoutEditorOpen(true);
  }, [settings.touchLayout]);

  const moveLayoutControl = useCallback((id: TouchControlId, offset: { x: number; y: number }) => {
    setLayoutDraft(prev => ({
      preset: 'custom',
      offsets: { ...(prev?.offsets ?? {}), [id]: offset },
    }));
  }, []);

  const saveLayoutEditor = useCallback(() => {
    updateSettings({ touchLayout: layoutDraft });
    setLayoutEditorOpen(false);
  }, [updateSettings, layoutDraft]);

  // Settings → engine + document (quality tier drives the CSS effect budget)
  useEffect(() => {
    applyQuality(settings.quality);
    applySfxVolume(settings.sfxVolume);
    // PHASE 4 E5: score level on the music bus (0 stops the scheduler too)
    applyMusicVolume(settings.musicVolume);
    gameLoop.soundMuted = settings.sfxVolume === 0;
    // P5-01 + P5-02: one knob → canvas resolution, blur gates, FX budgets
    gameLoop.quality = settings.quality;
    // PHASE 1B E6: gameplay haptics gate (pad rumble + phone vibration)
    Haptics.enabled = settings.haptics;
    // PHASE 3 1: gamepad deadzones + stick sensitivity
    gameLoop.inputManager.applyTuning({
      moveDeadzone: settings.padMoveDeadzone,
      aimDeadzone: settings.padAimDeadzone,
      moveSensitivity: settings.padMoveSensitivity,
      aimSensitivity: settings.padAimSensitivity,
    });
    // PHASE 3 4: aim magnetism level (mirrored through GameLoop so fullReset keeps it)
    gameLoop.aimAssist = settings.aimAssist;
    // G5: the enemy-behaviour tier (module-level, read every frame by the AI)
    setDifficulty(settings.difficulty);
    setIsMuted(settings.sfxVolume === 0);
    saveSettings(settings);
    // PHASE 2: settings ride along in the profile (audio/graphics survive a wipe)
    const p = profileRef.current;
    if (p) {
      p.settings = { ...settings };
      saveProfile(p);
    }
  }, [settings, gameLoop]);

  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  // Keep the gamepad pause binding pointed at the latest handler
  useEffect(() => {
    togglePauseRef.current = togglePause;
  });

  useEffect(() => {
    // Boot to the title screen with the simulation held
    gameLoop.setPaused(true);
    gameLoop.inputManager.onPauseRequested = () => {
      togglePauseRef.current();
    };
    gameLoop.inputManager.onGamepadChange = (status) => {
      setTick(t => (t + 1) % 1000);
      // PHASE 3 1: announce connect/disconnect so the player knows which
      // input device owns the fight right now.
      pushToast(
        status.connected
          ? { kind: 'info', title: 'GAMEPAD CONNECTED', body: `${status.name} — standard layout active` }
          : { kind: 'info', title: 'GAMEPAD DISCONNECTED', body: 'Touch controls remain active' }
      );
    };
  }, [gameLoop, pushToast]);

  const isPaused = gameLoop.isPaused;
  const isGameOver = gameLoop.isGameOver;

  // PHASE 4 E5 — arm the score after the first real user gesture (autoplay
  // policy), then keep it on the screen that owns the session: title theme,
  // adaptive run score, and a halt behind pause / defeat / victory.
  useEffect(() => {
    Music.init();
  }, []);

  useEffect(() => {
    if (!hasStarted) Music.setScene('menu');
    else if (isGameOver) Music.setScene('gameover');
    else if (showVictory) Music.setScene('victory');
    else if (isPaused) Music.setScene('paused');
    else Music.setScene('run');
  }, [hasStarted, isGameOver, showVictory, isPaused]);

  // Escape / Android back both run this shared overlay stack so a system
  // back press can never do something the Escape key wouldn't.
  const closeTopmostOverlay = useCallback((): boolean => {
    if (showExitConfirm) {
      setShowExitConfirm(false);
      return true;
    }
    if (layoutEditorOpen) {
      setLayoutEditorOpen(false);
      return true;
    }
    if (showOptions) setShowOptions(false);
    else if (showStageSelect) setShowStageSelect(false);
    else if (showHowToPlay) setShowHowToPlay(false);
    else if (showHelp) setShowHelp(false);
    else if (showUpgrades) setShowUpgrades(false);
    else if (showAppearance) setShowAppearance(false);
    else if (showAchievements) setShowAchievements(false);
    else if (showProfile) setShowProfile(false);
    else if (showPerks) setShowPerks(false);
    else if (showMilestones) setShowMilestones(false);
    else if (showAIAgents) setShowAIAgents(false);
    else return false;
    return true;
  }, [
    showExitConfirm,
    layoutEditorOpen,
    showOptions,
    showStageSelect,
    showHowToPlay,
    showHelp,
    showPerks,
    showMilestones,
    showAIAgents,
    showUpgrades,
    showAppearance,
    showAchievements,
    showProfile,
  ]);

  // Escape closes the topmost dialog, otherwise it toggles the pause menu
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (closeTopmostOverlay()) return;
      if (hasStarted && !isGameOver && !showVictory) togglePauseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeTopmostOverlay, hasStarted, isGameOver, showVictory]);

  /**
   * PHASE 3 5 — the one system-back policy (Android hardware back, browser
   * back, and the same rules Escape follows). Returns true when the press was
   * consumed: close topmost overlay → pause an active run → resume a paused
   * run → quit a finished run to the title → confirm exit at the root screen.
   */
  const handleSystemBack = useCallback((): boolean => {
    if (closeTopmostOverlay()) return true;
    if (hasStarted && !isGameOver && !victoryOpenRef.current) {
      togglePauseRef.current(); // active run → pause; paused run → resume
      return true;
    }
    if (hasStarted) {
      goToTitle(); // game over / victory → title screen
      return true;
    }
    setShowExitConfirm(true); // root screen → explicit confirm, never a dead tap
    return true;
  }, [closeTopmostOverlay, hasStarted, isGameOver, goToTitle]);

  const backHandlerRef = useRef(handleSystemBack);
  useEffect(() => {
    backHandlerRef.current = handleSystemBack;
  });

  // PHASE 3 5/6: wire the platform back gesture (Android hardware back,
  // browser back) and the pinch/double-tap zoom guards once at boot.
  useEffect(() => {
    void initBackButton(() => backHandlerRef.current());
    installTouchGuards();
  }, []);

  // PHASE 3 6: hold the screen awake while a run is on screen
  useEffect(() => {
    setScreenAwake(hasStarted && !isGameOver && !showVictory);
  }, [hasStarted, isGameOver, showVictory]);

  // Run tracker: clock, kill tally, wave-clear progression and victory detection
  useEffect(() => {
    if (!hasStarted) return;
    trackerLastTickRef.current = performance.now();

    const id = window.setInterval(() => {
      const now = performance.now();
      const delta = (now - trackerLastTickRef.current) / 1000;
      trackerLastTickRef.current = now;

      const frozen = gameLoop.isPaused || gameLoop.isGameOver || victoryOpenRef.current;

      if (!frozen) {
        // PHASE 4 E5: the score layers against the live squad state at 4 Hz.
        Music.setIntensity(sampleScoreIntensity(gameLoop));
        runSecondsRef.current += delta;
        const whole = Math.floor(runSecondsRef.current);
        if (whole !== displayedSecondsRef.current) {
          displayedSecondsRef.current = whole;
          setRunTimeSec(whole);
        }
      }

      // Kills: dead bodies stay in the wave array until the next respawn
      let nextKills = killsRef.current;
      for (const enemy of gameLoop.enemies) {
        if (enemy.health <= 0 && enemy.state === 'DOWNED' && !deadEnemiesRef.current.has(enemy)) {
          deadEnemiesRef.current.add(enemy);
          nextKills += 1;
        }
      }
      if (nextKills !== killsRef.current) {
        killsRef.current = nextKills;
        setKills(nextKills);
      }

      // G7 — the Training Arena writes no progression: no stage clears, no
      // victory, no lifetime bests. It does re-render on this same cadence so
      // the checklist panel stays live without a timer of its own.
      if (gameLoop.training) {
        setTick(t => (t + 1) % 1000);
        return;
      }

      // PHASE 2: lifetime bests commit the moment they improve (also powers
      // the STYLE ICON / COMBO KING commendations mid-run).
      const p = profileRef.current;
      if (p) {
        const rankIdx = styleRankIndex(gameLoop.combatDirector.styleRank);
        const bestCombo = gameLoop.combatDirector.stats.maxCombo;
        if (rankIdx > p.stats.bestStyleRank || bestCombo > p.stats.bestCombo) {
          p.stats.bestStyleRank = Math.max(p.stats.bestStyleRank, rankIdx);
          p.stats.bestCombo = Math.max(p.stats.bestCombo, bestCombo);
          commitProfile();
        }
      }

      const allDowned =
        gameLoop.enemies.length > 0 &&
        gameLoop.enemies.every(e => e.health <= 0 && e.state === 'DOWNED');

      // Progression: first time this wave is fully cleared
      if (allDowned && clearedWaveRef.current !== gameLoop.waveNumber) {
        clearedWaveRef.current = gameLoop.waveNumber;
        recordWaveCleared(gameLoop.waveNumber);
      }

      // Story victory: Marquis de Gramont falls on wave 6
      if (
        !victoryLatchedRef.current &&
        !gameLoop.isGameOver &&
        gameLoop.waveNumber >= 6 &&
        allDowned &&
        gameLoop.enemies.some(e => e.type === 'MARQUIS' && e.health <= 0)
      ) {
        triggerVictory();
      }
    }, 250);

    return () => window.clearInterval(id);
  }, [hasStarted, gameLoop, recordWaveCleared, triggerVictory, commitProfile]);

  // Defeat: freeze inputs and bank the personal bests for this run
  useEffect(() => {
    if (!isGameOver) return;
    clearVirtualInputs();
    const stats = gameLoop.combatDirector.stats;
    setProgress(prev => ({
      ...prev,
      bestScore: Math.max(prev.bestScore, stats.score),
      bestMaxCombo: Math.max(prev.bestMaxCombo, stats.maxCombo),
      bestKills: Math.max(prev.bestKills, killsRef.current),
    }));
    // PHASE 2: sweep the purse into the bank + fold the run into lifetime stats
    const p = profileRef.current;
    if (p) {
      p.stats.bestCombo = Math.max(p.stats.bestCombo, stats.maxCombo);
      p.stats.bestWave = Math.max(p.stats.bestWave, gameLoop.waveNumber);
      bankCoins();
      commitProfile();
    }
  }, [isGameOver, gameLoop, clearVirtualInputs, bankCoins, commitProfile]);

  const profile = profileRef.current ?? loadProfile();
  const physics = gameLoop.player.physics;
  const enemies = gameLoop.enemies;
  const combat = gameLoop.combatDirector;
  const heldGunName = GUNS[gameLoop.player.currentGun].name;
  const roomConfig = gameLoop.environmentManager.config;
  const isDoorOpen = gameLoop.environmentManager.doorOpen;
  const isNearDoor = isDoorOpen && Math.abs(physics.position.x - gameLoop.environmentManager.doorX) < 80;

  const anyStaggered = enemies.some(e => e.isStaggered && e.state !== 'DOWNED' && e.health > 0);
  const allEnemiesDowned = enemies.length > 0 && enemies.every(e => e.health <= 0 && e.state === 'DOWNED');
  const unlockedPerksCount = Object.keys(physics.perks).filter(k => physics.perks[k as keyof typeof physics.perks]).length;

  const nextStage = getNextStage(progress);
  const showEndScreen = hasStarted && (isGameOver || showVictory);
  const currentStats: RunStats = {
    kills,
    maxCombo: combat.stats.maxCombo,
    timeSec: runTimeSec,
    score: combat.stats.score,
    wave: gameLoop.waveNumber,
    takedowns: combat.stats.takedownCount,
    parries: combat.stats.parryCount,
    damage: combat.stats.totalDamageDealt,
    // Run total = coins swept to the bank this run + what is still in the purse
    coins: runBankRef.current + physics.coins,
    style: combat.stats.styleRating,
  };
  const isNewRecord = currentStats.score > 0 && currentStats.score >= progress.bestScore;

  return (
    <div
      className="relative w-full h-screen bg-[#07080b] text-neutral-200 overflow-hidden font-sans select-none touch-none"
      style={{ height: '100dvh' }}
    >
      {/* 1. CORE ENGINE CANVAS */}
      <GameCanvas gameLoop={gameLoop} onStateUpdate={handleStateUpdate} quality={settings.quality} />

      {/* 1b. CINEMATIC VIGNETTE — only mounted at the Cinematic graphics tier */}
      <div className="menu-vignette" aria-hidden="true" />

      {/* 2. TOP HUD LAYER (hidden while the layout editor owns the screen) */}
      <header
        className="safe-top safe-left safe-right absolute top-0 left-0 right-0 p-3 sm:p-5 pointer-events-none z-30 grid grid-cols-[1fr_auto] gap-x-2 gap-y-2 sm:flex sm:items-start sm:justify-between sm:gap-0"
        style={{
          display: layoutEditorOpen ? 'none' : undefined,
          opacity: settings.hudOpacity !== 100 ? settings.hudOpacity / 100 : undefined,
        }}
      >
        {/* PLAYER STATUS (Health, Stamina, Tactical Ammo) */}
        <div className="flex flex-col gap-1.5 pointer-events-auto bg-black/60 backdrop-blur-md px-3.5 py-2.5 rounded-xl border border-white/10 shadow-2xl sm:order-1">
          <div className="flex items-center justify-between gap-4">
            <span className="font-extrabold tracking-wider text-xs uppercase text-neutral-100 flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              JOHN
            </span>
            <span className="text-[11px] font-mono font-medium text-neutral-400">
              {Math.round(physics.health)} / {physics.maxHealth}
            </span>
          </div>

          {/* Health Bar */}
          <div className="w-32 sm:w-48 h-2.5 bg-neutral-900 rounded-full overflow-hidden border border-white/10">
            <div
              className="h-full bg-gradient-to-r from-red-600 via-rose-500 to-amber-400 transition-all duration-100"
              style={{ width: `${(physics.health / physics.maxHealth) * 100}%` }}
            />
          </div>

          {/* Stamina Bar — labelled (P4 colour-blind cue) so the read never
              depends on green alone; it pulses when nearly spent */}
          <div className="w-32 sm:w-48 flex items-center gap-1.5">
            <span
              className={`text-[9px] font-mono uppercase tracking-wider leading-none ${
                physics.stamina <= physics.maxStamina * 0.2
                  ? 'text-amber-400 animate-pulse'
                  : 'text-neutral-500'
              }`}
            >
              STA
            </span>
            <div className="flex-1 h-1.5 bg-neutral-900 rounded-full overflow-hidden border border-white/10">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-75"
                style={{ width: `${(physics.stamina / physics.maxStamina) * 100}%` }}
              />
            </div>
          </div>

          {/* Held firearm: name, magazine / reserve readout (Phase 1 B6/D5) */}
          <div className="flex items-center justify-between pt-0.5 text-[10px] font-mono">
            <span className="text-neutral-400 flex items-center gap-1">
              <span className="text-amber-400 font-bold">{heldGunName}</span>
              {physics.isReloading ? (
                <span className="text-yellow-400 font-bold animate-pulse">RELOADING...</span>
              ) : (
                <span className="text-neutral-300 font-bold">
                  {physics.ammo} / {physics.maxAmmo}
                </span>
              )}
              <span className="text-sky-400/90 font-bold">+{physics.reserveAmmo}</span>
            </span>
            {physics.maxAmmo <= 12 ? (
              <div className="flex items-center gap-1">
                {Array.from({ length: physics.maxAmmo }).map((_, i) => (
                  <span
                    key={i}
                    className={`inline-block w-1.5 h-3 rounded-[2px] transition-colors ${
                      i < physics.ammo
                        ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]'
                        : 'bg-neutral-700'
                    }`}
                  />
                ))}
              </div>
            ) : (
              /* Big magazines (SMG/RIFLE) read as a fill bar — 30 pips would
                 blow out the panel width on a phone */
              <div className="w-16 sm:w-20 h-2.5 bg-neutral-900 rounded-full overflow-hidden border border-white/10">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-yellow-400 transition-all duration-75"
                  style={{ width: `${(physics.ammo / physics.maxAmmo) * 100}%` }}
                />
              </div>
            )}
          </div>
          {/* High Table Gold Coins, Level & Equipped Weapon */}
          <div className="flex items-center gap-2 pt-1 border-t border-white/5 flex-wrap">
            <div className="flex items-center gap-1.5 text-amber-300 font-mono text-[11px] font-bold">
              <Coins className="w-3.5 h-3.5 text-yellow-400" />
              <span>{profile.coins + physics.coins} COINS</span>
            </div>

            {/* PHASE 2: level chip with a thin XP pip */}
            <div
              className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-400/30 text-emerald-300 font-mono text-[10px] font-bold"
              title={`${profile.xp} / ${xpToNext(profile.level)} XP`}
            >
              <span>LV {profile.level}</span>
              <span className="inline-block w-10 h-1 bg-black/60 rounded-full overflow-hidden align-middle">
                <span
                  className="block h-full bg-emerald-400 rounded-full"
                  style={{
                    width: `${Math.min(100, Math.round((profile.xp / Math.max(1, xpToNext(profile.level))) * 100))}%`,
                  }}
                />
              </span>
            </div>

            {physics.equippedWeapon !== 'UNARMED' && (
              <div className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-white/10 text-white border border-white/10">
                <Sword className="w-3 h-3 text-amber-400" />
                <span className="font-bold text-amber-300">{physics.equippedWeapon}</span>
                <span className="text-neutral-400">
                  {physics.equippedWeapon === 'KATANA'
                    ? `[${physics.weaponDurability}]`
                    : physics.equippedWeapon === 'SHOTGUN'
                    ? `[${physics.weaponDurability} SHELLS]`
                    : `[THROW]`}
                </span>
              </div>
            )}
          </div>

          {/* Type-C Controller Status Badge */}
          <div className="flex items-center gap-1.5 pt-1 text-[10px] font-mono border-t border-white/5">
            {gameLoop.inputManager.gamepadStatus.connected ? (
              <div className="flex items-center gap-1 text-emerald-400 font-bold">
                <Gamepad2 className="w-3.5 h-3.5 animate-pulse" />
                <span>{gameLoop.inputManager.gamepadStatus.name}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 text-neutral-400 font-medium">
                <Smartphone className="w-3.5 h-3.5 text-neutral-500" />
                <span>Mobile Touch Controls</span>
              </div>
            )}
          </div>
        </div>

        {/* CENTER: CURRENT ACTION & TAKEDOWN CUE & WAVE COUNTER */}
        <div className="flex flex-col items-center gap-1.5 pointer-events-none col-span-2 sm:order-2">
          <div className="flex items-center gap-2">
            <div className="px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[11px] font-mono tracking-widest text-neutral-300 shadow-lg flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-bold text-amber-300">{physics.state.replace('ATTACK_', '')}</span>
              {physics.isSliding && <span className="text-emerald-400 font-semibold">• SLIDE</span>}
              {physics.isDodging && <span className="text-sky-400 font-semibold">• ROLL</span>}
              {physics.isBlocking && <span className="text-blue-400 font-semibold">• GUARD</span>}
            </div>

            <div className="px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[11px] font-mono font-bold text-neutral-300 shadow-lg">
              WAVE {gameLoop.waveNumber}
            </div>
          </div>

          {/* Live Combo & Score Readouts (polled via the same tick re-render as the rest of the HUD) */}
          <div className="flex items-center gap-1.5 flex-wrap justify-center">
            {combat.stats.comboCount >= 1 && (
              <div
                className={`px-3 py-1 rounded-full bg-black/70 backdrop-blur-md border text-[11px] font-mono font-bold shadow-lg flex items-center gap-1.5 transition-all ${
                  combat.stats.finisherArmed
                    ? 'border-amber-400 text-amber-200 shadow-[0_0_16px_rgba(251,191,36,0.55)] animate-pulse'
                    : combat.stats.comboCount >= 5
                    ? 'border-orange-400/70 text-orange-200'
                    : 'border-orange-400/40 text-orange-300'
                }`}
              >
                <Zap className={`w-4 h-4 ${combat.stats.finisherArmed ? 'text-amber-300' : 'text-orange-400'}`} />
                <span className="text-base font-black leading-none">{combat.stats.comboCount}x</span>
                <span className="tracking-widest">COMBO</span>
                <span className="text-[10px] text-rose-300/90 font-semibold">
                  ×{combat.comboDamageMultiplier().toFixed(2)} DMG
                </span>
              </div>
            )}

            {combat.stats.finisherArmed && (
              <div className="px-3 py-1 rounded-full bg-amber-500/25 border border-amber-300 text-[11px] font-mono font-black tracking-widest text-amber-200 shadow-[0_0_18px_rgba(251,191,36,0.6)] animate-bounce">
                FINISHER READY
              </div>
            )}

            {/* Signature-move callout (FLYING KICK / LEG SWEEP / GUN-FU ...) */}
            {combat.moveBannerTimer > 0 && combat.moveBanner && (
              <div className="px-3 py-1 rounded-full bg-sky-500/25 border border-sky-300 text-[11px] font-mono font-black tracking-widest text-sky-100 shadow-[0_0_18px_rgba(56,189,248,0.55)] animate-bounce">
                {combat.moveBanner}
              </div>
            )}
            <div
              className={`px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border text-[11px] font-mono font-bold shadow-lg flex items-center gap-1.5 ${
                combat.stats.score > 0
                  ? 'border-amber-400/40 text-amber-300'
                  : 'border-white/10 text-neutral-500 opacity-60'
              }`}
            >
              <Trophy className={`w-3.5 h-3.5 ${combat.stats.score > 0 ? 'text-amber-400' : 'text-neutral-600'}`} />
              SCORE {combat.stats.score.toLocaleString()}
            </div>
          </div>

          {/* Chamber & Theme Title */}
          <div className="text-[10px] font-mono tracking-wider text-neutral-400 uppercase text-center">
            {roomConfig.title} • {roomConfig.subtitle}
          </div>

          {/* Contextual Stagger Takedown Banner */}
          {anyStaggered && (
            <div className="px-3.5 py-1 rounded-full bg-amber-500/20 border border-amber-400 text-amber-300 text-xs font-bold tracking-wider animate-bounce flex items-center gap-1.5 shadow-xl">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              ENEMY STAGGERED • TAP GRAB / R3 FOR TAKEDOWN!
            </div>
          )}

          {/* Exit Door Alert / Next Chamber Prompt */}
          {isDoorOpen && (
            <div className="px-3.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400 text-emerald-300 text-xs font-bold tracking-wider animate-pulse flex items-center gap-1.5 shadow-xl">
              <DoorOpen className="w-4 h-4 text-emerald-400" />
              {isNearDoor ? 'TAP GRAB TO ADVANCE!' : 'CHAMBER CLEARED • ADVANCE TO EXIT DOOR'}
            </div>
          )}

          {/* Downed / Victory Banner */}
          {allEnemiesDowned && !isDoorOpen && (
            <button
              onClick={() => gameLoop.nextWave()}
              className="pointer-events-auto px-4 py-2 rounded-full bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black text-xs font-black tracking-wider flex items-center gap-2 shadow-2xl transition-all border border-amber-200 animate-pulse"
            >
              <Zap className="w-4 h-4 text-black" />
              ALL THREATS ELIMINATED • NEXT WAVE ({gameLoop.waveNumber + 1})
            </button>
          )}
        </div>

        {/* RIGHT: SQUAD TOGGLES & CONTROLS */}
        <div className="flex items-center gap-1.5 sm:gap-2 pointer-events-auto col-start-2 row-start-1 justify-self-end sm:order-3">
          {/* Squad Encounter Size & Boss Toggle */}
          <div className="hidden 2xl:flex items-center gap-1 bg-black/60 backdrop-blur-md p-1 rounded-xl border border-white/10 text-[11px] font-mono shadow-lg">
            {[1, 2, 3].map((count) => (
              <button
                key={count}
                onClick={() => gameLoop.spawnSquad(count)}
                className={`px-2.5 py-2 rounded-lg font-bold transition-all ${
                  gameLoop.squadSize === count && !enemies.some((e) => e.type === 'BOSS')
                    ? 'bg-amber-500 text-black shadow-md'
                    : 'text-neutral-400 hover:text-white bg-white/5'
                }`}
                title={`Spawn ${count} enemies`}
              >
                {count === 1 ? '1v1' : count === 2 ? '1v2' : '1v3'}
              </button>
            ))}
            <button
              onClick={() => gameLoop.spawnBossDuel()}
              className={`px-2.5 py-2 rounded-lg font-bold transition-all flex items-center gap-1 ${
                enemies.some((e) => e.type === 'BOSS')
                  ? 'bg-gradient-to-r from-red-600 to-amber-500 text-white shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                  : 'text-amber-400 hover:text-amber-200 bg-amber-500/10 border border-amber-500/30'
              }`}
              title="Spawn High Table Master Boss"
            >
              👑 BOSS
            </button>
            <button
              onClick={() => gameLoop.spawnEliteDuo()}
              className={`px-2.5 py-2 rounded-lg font-bold transition-all flex items-center gap-1 ${
                gameLoop.squadSize === 5 && !enemies.some((e) => e.type === 'BOSS')
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-[0_0_8px_rgba(147,51,234,0.5)]'
                  : 'text-purple-400 hover:text-purple-200 bg-purple-500/10 border border-purple-500/30'
              }`}
              title="Milestone 7: Spawn Elite Vanguard & Shinobi Duo"
            >
              ⚡ ELITE
            </button>
          </div>

          {/* AI Agents Game Studio Button */}
          <button
            id="toggle-ai-agents-btn"
            onClick={() => setShowAIAgents(!showAIAgents)}
            className={`p-2 min-h-[44px] rounded-xl backdrop-blur-md border text-xs transition-all shadow-lg hidden xl:flex items-center gap-1.5 ${
              showAIAgents
                ? 'bg-gradient-to-r from-amber-500 to-purple-600 border-amber-300 text-white shadow-[0_0_15px_rgba(245,158,11,0.5)] font-black'
                : 'bg-black/60 border-amber-500/30 text-amber-300 hover:text-white'
            }`}
            title="High Table AI Syndicate Bureau (Multiple AI Agents)"
          >
            <Bot className="w-4 h-4 text-amber-400 animate-pulse" />
            <span className="font-mono text-[11px] font-bold">
              AI Studio
            </span>
          </button>

          {/* Tactical Pause Toggle */}
          <button
            id="toggle-pause-btn"
            onClick={togglePause}
            className={`p-2 min-h-[44px] min-w-[44px] justify-center rounded-xl backdrop-blur-md border text-xs transition-all shadow-lg flex items-center gap-1.5 ${
              isPaused
                ? 'bg-amber-500 border-amber-300 text-black shadow-[0_0_15px_rgba(245,158,11,0.6)] animate-pulse font-black'
                : 'bg-black/60 border-white/10 text-neutral-300 hover:text-white'
            }`}
            title="Pause Mission (Start / Menu)"
          >
            {isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4" />}
            <span className="hidden lg:inline font-mono text-[11px] font-bold">
              {isPaused ? 'RESUME' : 'PAUSE'}
            </span>
          </button>

          {/* Perks Shop Toggle */}
          <button
            id="toggle-perks-btn"
            onClick={() => setShowPerks(!showPerks)}
            className={`p-2 min-h-[44px] min-w-[44px] justify-center rounded-xl backdrop-blur-md border text-xs transition-all shadow-lg flex items-center gap-1.5 ${
              showPerks || unlockedPerksCount > 0
                ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                : 'bg-black/60 border-white/10 text-neutral-400 hover:text-neutral-200'
            }`}
            title="High Table Armory Perks"
          >
            <Award className="w-4 h-4 text-amber-400" />
            <span className="hidden lg:inline font-mono text-[11px] font-bold">
              {unlockedPerksCount > 0 ? `${unlockedPerksCount}/5` : 'Perks'}
            </span>
          </button>

          {/* Milestones & High Table Contracts Toggle */}
          <button
            id="toggle-milestones-btn"
            onClick={() => setShowMilestones(!showMilestones)}
            className={`p-2 min-h-[44px] rounded-xl backdrop-blur-md border text-xs transition-all shadow-lg hidden xl:flex items-center gap-1.5 ${
              showMilestones
                ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                : 'bg-black/60 border-white/10 text-neutral-400 hover:text-neutral-200'
            }`}
            title="Milestone 7 & Contracts"
          >
            <Target className="w-4 h-4 text-sky-400" />
            <span className="font-mono text-[11px] font-bold hidden md:inline">
              Milestones
            </span>
          </button>

          {/* Sound Toggle */}
          <button
            id="toggle-sound-btn"
            onClick={toggleSound}
            className={`p-2 min-h-[44px] min-w-[44px] justify-center rounded-xl backdrop-blur-md border text-xs transition-all shadow-lg flex items-center gap-1.5 ${
              !isMuted
                ? 'bg-black/60 border-white/10 text-neutral-300 hover:text-white'
                : 'bg-red-500/20 border-red-500 text-red-400'
            }`}
            title="Toggle Sound Effects"
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
          </button>

          {/* Reset / Respawn Encounter Button */}
          <button
            id="reset-fight-btn"
            onClick={handleReset}
            className="p-2 min-h-[44px] min-w-[44px] justify-center rounded-xl bg-black/60 backdrop-blur-md border border-white/10 text-neutral-400 hover:text-neutral-200 text-xs shadow-lg transition-all hidden xl:flex items-center"
            title="Reset Encounter"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Debug Bone Overlay Toggle */}
          <button
            id="toggle-debug-btn"
            onClick={toggleDebug}
            className={`p-2 min-h-[44px] rounded-xl backdrop-blur-md border text-xs transition-all shadow-lg hidden sm:flex items-center gap-1.5 ${
              showDebug
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                : 'bg-black/60 border-white/10 text-neutral-400 hover:text-neutral-200'
            }`}
            title="Toggle Skeletal Rig Overlay"
          >
            <Eye className="w-4 h-4" />
            <span className="hidden lg:inline font-mono text-[11px]">Rig</span>
          </button>

          {/* Controls / Info Modal Toggle */}
          <button
            id="toggle-help-btn"
            onClick={() => setShowHelp(!showHelp)}
            className="p-2 min-h-[44px] min-w-[44px] justify-center rounded-xl bg-black/60 backdrop-blur-md border border-white/10 text-neutral-400 hover:text-neutral-200 text-xs shadow-lg transition-all flex items-center"
            title="Combat Guide"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          {/* FPS Counter (Options → HUD) — engine writes fps/update/render ms */}
          {settings.showFps && (
            <div className="px-2.5 py-1.5 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 text-neutral-400 font-mono text-[11px] hidden xl:flex items-center gap-1 shadow-lg">
              <Cpu className="w-3.5 h-3.5 text-neutral-500" />
              <span ref={perfSpanRef} />
            </div>
          )}
        </div>
      </header>

      {/* 3. HELP & COMBAT GUIDE MODAL */}
      {showHelp && (
        <div className="absolute inset-0 z-[54] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="max-w-xl w-full bg-neutral-900 border border-neutral-700 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Gamepad2 className="w-5 h-5 text-amber-400" />
                Mobile Touch & Type-C Controller Guide
              </h2>
              <button
                onClick={() => setShowHelp(false)}
                className="text-neutral-400 hover:text-white min-h-[44px] min-w-[44px] flex items-center justify-center text-sm font-semibold rounded-lg hover:bg-white/10 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Combat Stats summary */}
            <div className="grid grid-cols-4 gap-2 text-center bg-black/40 p-3 rounded-xl border border-white/5 font-mono text-xs">
              <div>
                <div className="text-neutral-500 text-[10px] uppercase">Max Combo</div>
                <div className="text-amber-400 font-bold text-base">{combat.stats.maxCombo}x</div>
              </div>
              <div>
                <div className="text-neutral-500 text-[10px] uppercase">Parries</div>
                <div className="text-sky-400 font-bold text-base">{combat.stats.parryCount}</div>
              </div>
              <div>
                <div className="text-neutral-500 text-[10px] uppercase">Takedowns</div>
                <div className="text-emerald-400 font-bold text-base">{combat.stats.takedownCount}</div>
              </div>
              <div>
                <div className="text-neutral-500 text-[10px] uppercase">Style</div>
                <div className="text-rose-400 font-bold text-base">{combat.stats.styleRating}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {/* Type-C Controller Mapping */}
              <div className="bg-neutral-950/70 p-3.5 rounded-xl border border-white/5 space-y-1.5 font-mono">
                <div className="font-bold text-amber-300 flex items-center gap-1.5 font-sans text-xs">
                  <Gamepad2 className="w-4 h-4 text-emerald-400" />
                  Type-C Gamepad Controls (Kishi / Backbone)
                </div>
                <div className="text-neutral-300"><span className="text-white font-semibold">Left Stick / D-Pad:</span> Locomotion & Slide Aim</div>
                <div className="text-neutral-300"><span className="text-sky-300 font-semibold">Right Stick:</span> Twin-stick aim (precision aim model)</div>
                <div className="text-neutral-300"><span className="text-sky-300 font-semibold">A / Cross:</span> Jump Ascent</div>
                <div className="text-neutral-300"><span className="text-emerald-300 font-semibold">B / Circle:</span> Combat Dodge Roll / Slide</div>
                <div className="text-neutral-300"><span className="text-neutral-300 font-semibold">X / Square:</span> Context — enter door / tactical reload</div>
                <div className="text-neutral-300"><span className="text-amber-300 font-semibold">Y / Triangle:</span> Cycle Firearms (pistol → SMG → shotgun → rifle)</div>
                <div className="text-neutral-300"><span className="text-rose-300 font-semibold">LB / L1:</span> PUNCH — jab / cross / spin string</div>
                <div className="text-neutral-300"><span className="text-amber-300 font-semibold">RB / R1:</span> KICK — long-reach power kick (guard break)</div>
                <div className="text-neutral-300"><span className="text-blue-300 font-semibold">L3 (click):</span> Guard Block / Perfect Parry</div>
                <div className="text-neutral-300"><span className="text-orange-300 font-semibold">R3 (click):</span> Grab / Close-Quarters Takedown</div>
                <div className="text-neutral-300"><span className="text-neutral-400 font-semibold">LT / L2 (hold):</span> Precision Aim — laser + tightened spread</div>
                <div className="text-neutral-300"><span className="text-amber-400 font-semibold">RT / R2:</span> Gun-Fu Fire / Shotgun / Throw</div>
                <div className="text-neutral-300"><span className="text-purple-300 font-semibold">Select / Share:</span> Bullet-Time Focus</div>
                <div className="text-neutral-300"><span className="text-neutral-400 font-semibold">Start / Menu:</span> Tactical Pause Menu</div>
              </div>

              {/* Mobile Touch & Tactics */}
              <div className="bg-neutral-950/70 p-3.5 rounded-xl border border-white/5 space-y-1.5 font-mono">
                <div className="font-bold text-sky-300 flex items-center gap-1.5 font-sans text-xs">
                  <Smartphone className="w-4 h-4 text-sky-400" />
                  Touch Screen Gestures & Tactics
                </div>
                <div className="text-neutral-400">• <span className="text-white font-semibold">Left Thumb:</span> 360° dynamic virtual joystick for running and sliding.</div>
                <div className="text-neutral-400">• <span className="text-white font-semibold">Right Thumb:</span> Big PUNCH + KICK hero buttons, plus block, dodge, jump and gun cluster.</div>
                <div className="text-neutral-400">• <span className="text-amber-300 font-semibold">Swipes:</span> Flick right on the look area to swap, flick down to reload, two-finger tap for focus.</div>
                <div className="text-neutral-400">• <span className="text-sky-300 font-semibold">Layout:</span> Options → Touch Controls resizes the buttons and lets you drag every control into place.</div>
                <div className="text-neutral-400">• <span className="text-rose-300 font-semibold">Combos:</span> Chain hits inside the timing window — damage scales up and every 5 hits loads a FINISHER.</div>
                <div className="text-neutral-400">• <span className="text-yellow-300 font-semibold">Gun-Fu Double Tap:</span> Tap Shoot at point-blank range (&lt;95px) for critical slow-mo executions.</div>
                <div className="text-neutral-400">• <span className="text-sky-300 font-semibold">Guard Break:</span> Tap KICK when enemies guard (🛡️ GUARD) to shatter stance!</div>
                <div className="text-neutral-400">• <span className="text-emerald-300 font-semibold">Slide Trip:</span> Slide into blocking enemies to sweep their legs out.</div>
                <div className="text-neutral-400">• <span className="text-purple-300 font-semibold">Perfect Parry:</span> Tap Block just before hit connects for slow-motion stun.</div>
                <div className="text-neutral-400">• <span className="text-sky-300 font-semibold">Parry Riposte:</span> Land any strike right after a perfect parry for 2.5× counter damage.</div>
                <div className="text-neutral-400">• <span className="text-amber-300 font-semibold">Flying Kick:</span> Hold a full sprint for a beat, then tap KICK to launch down the line.</div>
                <div className="text-neutral-400">• <span className="text-rose-300 font-semibold">Leg Sweep:</span> PUNCH → PUNCH → KICK chains into a low knockdown sweep.</div>
                <div className="text-neutral-400">• <span className="text-yellow-300 font-semibold">Grip Execution:</span> Hold SHOOT + tap GRAB for a pistol-grip headshot — GRAB alone judo-slams and bowls the body through the squad.</div>
                <div className="text-neutral-400">• <span className="text-orange-300 font-semibold">Pistol Whip:</span> Tap Shoot with an enemy on the muzzle — free heavy hit, no round spent.</div>
                <div className="text-neutral-400">• <span className="text-amber-400 font-semibold">Haptic Feedback:</span> Native vibration on mobile devices & Type-C controller rumble motors.</div>
              </div>
            </div>

            <button
              onClick={() => setShowHelp(false)}
              className="w-full min-h-[44px] py-2.5 bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors shadow-lg cursor-pointer"
            >
              Resume Fight
            </button>
          </div>
        </div>
      )}

      {/* 4. HIGH TABLE CONTINENTAL ARMORY & PERKS MODAL */}
      {showPerks && (
        <div
          className="fixed inset-0 z-[55] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPerks(false);
          }}
        >
          <div className="max-w-2xl w-full bg-[#0d0f15] border border-amber-500/30 rounded-2xl p-5 sm:p-6 shadow-[0_0_50px_rgba(245,158,11,0.2)] flex flex-col gap-4 text-neutral-200 relative menu-in">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-yellow-600/30 border border-amber-400/40 flex items-center justify-center shadow-lg">
                  <Award className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-black tracking-wider text-amber-300 uppercase font-mono flex items-center gap-2">
                    The Continental Armory
                    <span className="text-[10px] font-sans px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                      REQUISITIONS
                    </span>
                  </h2>
                  <p className="text-xs text-neutral-400">
                    High Table Black-Market Perks & Combat Enhancements
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowPerks(false)}
                className="p-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                title="Close (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Specie Balance & Coin Counter */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-black/50 border border-amber-500/20 rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-yellow-600 via-amber-400 to-yellow-200 flex items-center justify-center shadow-[0_0_15px_rgba(245,158,11,0.5)]">
                  <Coins className="w-5 h-5 text-black" />
                </div>
                <div>
                  <div className="text-[10px] uppercase font-mono tracking-wider text-neutral-400">
                    High Table Specie Balance
                  </div>
                  <div className="text-xl font-black font-mono text-amber-300 flex items-center gap-1.5">
                    <span>{profile.coins + physics.coins}</span>
                    <span className="text-xs font-normal text-amber-400/80">GOLD COINS</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="text-xs font-mono text-neutral-300 bg-white/5 px-3 py-1.5 rounded-lg border border-white/10">
                  <span className="text-amber-400 font-bold">{unlockedPerksCount}</span> / {PERK_CATALOG.length} Unlocked
                </div>
                {showDebug && (
                  <button
                    onClick={() => {
                      physics.coins += 5;
                      SoundFX.playCoinPickup();
                      setTick(t => (t + 1) % 1000);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-mono font-bold flex items-center gap-1 transition-all"
                    title="Add test coins"
                  >
                    <Plus className="w-3.5 h-3.5" /> +5 Coins
                  </button>
                )}
              </div>
            </div>

            {/* Perks Catalog Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[58vh] overflow-y-auto pr-1">
              {PERK_CATALOG.map((perk) => {
                const isOwned = Boolean(physics.perks[perk.id]);
                const spendable = profile.coins + physics.coins;
                const canAfford = spendable >= perk.cost;
                const IconComponent = PERK_ICONS[perk.id] || Sparkles;

                return (
                  <div
                    key={perk.id}
                    className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between gap-3 ${
                      isOwned
                        ? 'bg-emerald-950/20 border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.12)]'
                        : canAfford
                        ? 'bg-neutral-900/90 border-amber-500/30 hover:border-amber-400 shadow-md'
                        : 'bg-neutral-900/40 border-white/5 opacity-75'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`p-2.5 rounded-xl shrink-0 ${
                          isOwned
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        }`}
                      >
                        <IconComponent className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-sm text-neutral-100 truncate">
                            {perk.name}
                          </span>
                          <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-white/10 text-neutral-400 shrink-0">
                            {perk.badge}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-300 mt-1 leading-relaxed">
                          {perk.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-white/5 mt-auto">
                      <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-amber-400">
                        <Coins className="w-3.5 h-3.5 text-yellow-400" />
                        <span>{perk.cost} COINS</span>
                      </div>

                      {isOwned ? (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-bold font-mono">
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ACTIVE
                        </div>
                      ) : (
                        <button
                          disabled={!canAfford}
                          onClick={() => buyPerk(perk.id, perk.cost)}
                          className={`px-4 py-1.5 min-h-[44px] rounded-lg text-xs font-bold font-mono transition-all flex items-center gap-1.5 ${
                            canAfford
                              ? 'bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black shadow-lg cursor-pointer active:scale-95'
                              : 'bg-white/5 text-neutral-500 cursor-not-allowed border border-white/5'
                          }`}
                        >
                          <Award className="w-3.5 h-3.5" />
                          {canAfford ? 'UNLOCK' : `NEED ${perk.cost - spendable}`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Armory Footer */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-white/10 text-xs text-neutral-400 font-mono">
              <span className="text-[11px] text-neutral-400">
                Tip: Plug in a Type-C controller (Backbone / Kishi / GameSir) for hardware console controls.
              </span>
              <button
                onClick={() => setShowPerks(false)}
                className="w-full sm:w-auto min-h-[44px] px-6 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold transition-colors text-center cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. MILESTONES & CONTRACTS MODAL */}
      {showMilestones && (
        <div
          className="fixed inset-0 z-[55] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowMilestones(false);
          }}
        >
          <div className="max-w-2xl w-full bg-[#0c0e14] border border-sky-500/30 rounded-2xl p-5 sm:p-6 shadow-[0_0_50px_rgba(56,189,248,0.18)] flex flex-col gap-4 text-neutral-200 relative menu-in">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-sky-500/20 pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500/20 to-blue-600/30 border border-sky-400/40 flex items-center justify-center shadow-lg">
                  <Target className="w-5 h-5 text-sky-400" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-black tracking-wider text-sky-300 uppercase font-mono flex items-center gap-2">
                    High Table Contracts
                    <span className="text-[10px] font-sans px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 font-bold">
                      MILESTONES
                    </span>
                  </h2>
                  <p className="text-xs text-neutral-400">
                    Syndicate Combat Milestones & Assassin Progression
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowMilestones(false)}
                className="p-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Close (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Milestones Progress Banner */}
            {(() => {
              const completedCount = MILESTONES_CATALOG.filter(m => m.check(gameLoop)).length;
              const percent = Math.round((completedCount / MILESTONES_CATALOG.length) * 100);
              return (
                <div className="bg-black/50 border border-sky-500/20 rounded-xl p-3.5 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-neutral-400 uppercase tracking-wider">Continental Career Progression</span>
                    <span className="text-sky-300 font-bold">{completedCount} of {MILESTONES_CATALOG.length} Milestones Achieved ({percent}%)</span>
                  </div>
                  <div className="w-full h-2 bg-neutral-900 rounded-full overflow-hidden border border-white/10">
                    <div
                      className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-300"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })()}

            {/* Milestones Catalog List */}
            <div className="space-y-2.5 max-h-[55vh] overflow-y-auto pr-1">
              {MILESTONES_CATALOG.map((m) => {
                const isCompleted = m.check(gameLoop);
                const isMilestone7 = m.id === 7;

                return (
                  <div
                    key={m.id}
                    className={`p-3.5 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      isCompleted
                        ? 'bg-emerald-950/20 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.1)]'
                        : isMilestone7
                        ? 'bg-purple-950/20 border-purple-500/40'
                        : 'bg-neutral-900/60 border-white/5'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                          isCompleted
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : isMilestone7
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 animate-pulse'
                            : 'bg-white/5 text-neutral-400 border border-white/10'
                        }`}
                      >
                        {isCompleted ? <Check className="w-4 h-4" /> : <Target className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`font-bold text-sm ${isCompleted ? 'text-white' : isMilestone7 ? 'text-purple-200' : 'text-neutral-300'}`}>
                            {m.title}
                          </span>
                          <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-white/10 text-neutral-400">
                            {m.category}
                          </span>
                          {isMilestone7 && (
                            <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-purple-500/30 text-purple-300 border border-purple-400/40 font-bold">
                              NEW
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-neutral-400 mt-0.5">{m.description}</p>
                        <div className="text-[10px] font-mono text-amber-400/90 mt-1 flex items-center gap-1">
                          <span>Reward:</span>
                          <span className="font-semibold text-amber-300">{m.reward}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:self-center shrink-0">
                      {isMilestone7 && !isCompleted && (
                        <button
                          onClick={() => {
                            gameLoop.spawnEliteDuo();
                            setShowMilestones(false);
                            if (isPaused) togglePause();
                          }}
                          className="px-4 py-1.5 min-h-[44px] rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-mono text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
                        >
                          ⚡ Battle Elite Duo
                        </button>
                      )}

                      {isCompleted ? (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-mono font-bold">
                          <Check className="w-3.5 h-3.5" />
                          ACHIEVED
                        </div>
                      ) : (
                        <div className="px-3 py-1.5 rounded-lg bg-neutral-800 text-neutral-400 border border-white/10 text-xs font-mono">
                          IN PROGRESS
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs font-mono text-neutral-400">
              <span>Advance waves and eliminate threats to achieve all milestones.</span>
              <button
                onClick={() => setShowMilestones(false)}
                className="px-6 py-1.5 min-h-[44px] rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. TACTICAL PAUSE MENU OVERLAY */}
      {/* 6. PAUSE MENU (hidden while the layout editor is open so the live
          controls stay visible and draggable) */}
      {hasStarted && isPaused && !isGameOver && !showVictory && !layoutEditorOpen && (
        <PauseMenu
          gameLoop={gameLoop}
          runTimeSec={runTimeSec}
          coins={profile.coins + physics.coins}
          isMuted={isMuted}
          showDebug={showDebug}
          onResume={togglePause}
          onRestart={restartStage}
          onOptions={() => setShowOptions(true)}
          onMainMenu={goToTitle}
          onHelp={() => setShowHelp(true)}
          onHowToPlay={() => setShowHowToPlay(true)}
          onPerks={() => setShowPerks(true)}
          onMilestones={() => setShowMilestones(true)}
          onAIStudio={() => setShowAIAgents(true)}
          onToggleSound={toggleSound}
          onToggleDebug={toggleDebug}
        />
      )}

      {/* 7. MOBILE ON-SCREEN VIRTUAL CONTROLS (gameplay + layout editing) */}
      {(hasStarted && !isGameOver && !showVictory) || layoutEditorOpen ? (
        <VirtualControls
          inputManager={gameLoop.inputManager}
          equippedWeapon={physics.equippedWeapon}
          nearDoor={isNearDoor}
          buttonScale={settings.touchButtonScale / 100}
          layout={layoutEditorOpen ? layoutDraft : settings.touchLayout}
          editing={layoutEditorOpen}
          gesturesEnabled={settings.swipeGestures}
          opacity={settings.hudOpacity}
          onMoveControl={moveLayoutControl}
        />
      ) : null}

      {/* 7a. PHASE 3 2 — drag-to-place touch layout editor */}
      <TouchLayoutEditor
        isOpen={layoutEditorOpen}
        layout={layoutDraft}
        onChange={setLayoutDraft}
        onDefault={() => setLayoutDraft(null)}
        onRevert={() => setLayoutDraft(settings.touchLayout)}
        onSave={saveLayoutEditor}
        onCancel={() => setLayoutEditorOpen(false)}
      />

      {/* 6b. PHASE 2 — level-up / unlock / achievement toasts */}
      <ProgressionToasts toasts={toasts} />

      {/* 7b. LANDSCAPE HINT — portrait handhelds get a rotate-your-device prompt */}
      <RotateDeviceOverlay
        visible={!rotateDismissed && shouldShowRotateHint(isPortrait)}
        lockSupported={lockSupported}
        onRotateTap={() => void lockLandscape(true)}
        onDismiss={() => setRotateDismissed(true)}
      />

      {/* 8. HIGH TABLE MULTI-AI-AGENTS STUDIO */}
      <AIAgentsModal
        isOpen={showAIAgents}
        onClose={() => setShowAIAgents(false)}
        gameLoop={gameLoop}
        onApplied={() => setTick(t => (t + 1) % 1000)}
      />

      {/* 8b. HOW TO PLAY — compact real-bindings legend (title screen + pause menu) */}
      <HowToPlayModal
        isOpen={showHowToPlay}
        onClose={() => setShowHowToPlay(false)}
        padConnected={gameLoop.inputManager.gamepadStatus.connected}
        padName={gameLoop.inputManager.gamepadStatus.name}
      />

      {/* 8c. PHASE 2 — Safehouse upgrades (coins → permanent tiers) */}
      <UpgradesModal
        isOpen={showUpgrades}
        profile={profile}
        spendable={profile.coins + physics.coins}
        onBuy={buyUpgrade}
        onClose={() => setShowUpgrades(false)}
      />

      {/* 8d. PHASE 2 — loadout / figure colourway / weapon tint */}
      <AppearanceModal
        isOpen={showAppearance}
        profile={profile}
        onSelectLoadout={(id) => selectCosmetic('loadout', id)}
        onSelectSkin={(id) => selectCosmetic('skin', id)}
        onSelectTint={(id) => selectCosmetic('tint', id)}
        onClose={() => setShowAppearance(false)}
      />

      {/* 8e. PHASE 2 — career commendations */}
      <AchievementsModal
        isOpen={showAchievements}
        profile={profile}
        onClose={() => setShowAchievements(false)}
      />

      {/* 8f. PHASE 2 — lifetime dossier */}
      <ProfileStatsModal
        isOpen={showProfile}
        profile={profile}
        onClose={() => setShowProfile(false)}
      />

      {/* 9. MAIN MENU — Play / Stages / Options / How to Play */}
      {!hasStarted && (
        <MainMenu
          progress={progress}
          profile={profile}
          nextStage={nextStage}
          onPlay={() => startStage(nextStage)}
          onStageSelect={() => setShowStageSelect(true)}
          onUpgrades={() => setShowUpgrades(true)}
          onAppearance={() => setShowAppearance(true)}
          onAchievements={() => setShowAchievements(true)}
          onProfile={() => setShowProfile(true)}
          onOptions={() => setShowOptions(true)}
          onHowToPlay={() => setShowHowToPlay(true)}
        />
      )}

      {/* 10. END SCREENS — contract defeat & High Table victory with run stats */}
      {showEndScreen && (
        <GameOverScreen
          variant={isGameOver ? 'defeat' : 'victory'}
          stats={currentStats}
          stageName={activeStage.name}
          isNewRecord={isNewRecord}
          onRetry={restartStage}
          onStages={() => setShowStageSelect(true)}
          onMainMenu={goToTitle}
          onContinue={continueEndless}
        />
      )}

      {/* 11. OPTIONS — sound volume, graphics quality, HUD & PHASE 3 controls */}
      <OptionsModal
        isOpen={showOptions}
        settings={settings}
        onChange={updateSettings}
        onResetProfile={handleResetProfile}
        onEditLayout={openLayoutEditor}
        padConnected={gameLoop.inputManager.gamepadStatus.connected}
        padName={gameLoop.inputManager.gamepadStatus.name}
        onClose={() => setShowOptions(false)}
      />

      {/* 12. STAGE SELECT — progression contract board */}
      <StageSelectModal
        isOpen={showStageSelect}
        progress={progress}
        difficulty={settings.difficulty}
        onSelect={startStage}
        onTraining={startTraining}
        onClose={() => setShowStageSelect(false)}
      />

      {/* 12b. G7 — Training Arena checklist (only while a drill is live) */}
      {hasStarted && gameLoop.training && (
        <TrainingPanel onReset={() => gameLoop.resetTraining()} onExit={exitTraining} />
      )}

      {/* 13. PHASE 3 5 — back gesture at the root screen asks before leaving */}
      {showExitConfirm && (
        <div className="fixed inset-0 z-[80] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="menu-in w-full max-w-sm bg-[#0d0f15] border border-amber-500/40 rounded-2xl p-5 shadow-[0_0_60px_rgba(245,158,11,0.25)] flex flex-col gap-4 text-neutral-200 text-center">
            <div>
              <h2 className="text-base font-black uppercase tracking-widest text-amber-300 font-mono">
                Leave John Stick?
              </h2>
              <p className="text-[11px] font-mono text-neutral-400 mt-2 leading-relaxed">
                {isNativePlatform()
                  ? 'Progress is saved — the app closes on exit.'
                  : 'Progress is saved — close this tab to quit.'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setShowExitConfirm(false)}
                className="min-h-[44px] rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-neutral-300 font-black uppercase tracking-widest text-xs transition-colors cursor-pointer"
              >
                Stay
              </button>
              <button
                onClick={() => {
                  setShowExitConfirm(false);
                  exitApp();
                }}
                className="min-h-[44px] rounded-xl bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white font-black uppercase tracking-widest text-xs transition-transform active:scale-95 cursor-pointer"
              >
                Exit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

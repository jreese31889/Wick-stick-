import { useState, useMemo, useCallback, useEffect } from 'react';
import { GameLoop } from './engine/GameLoop';
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
  Bot
} from 'lucide-react';
import { SoundFX } from './engine/SoundFX';
import { AIAgentsModal } from './components/AIAgentsModal';

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

export default function App() {
  const gameLoop = useMemo(() => new GameLoop(), []);
  const [, setTick] = useState(0);
  const [showDebug, setShowDebug] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showPerks, setShowPerks] = useState(false);
  const [showMilestones, setShowMilestones] = useState(false);
  const [showAIAgents, setShowAIAgents] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const handleStateUpdate = useCallback(() => {
    setTick(t => (t + 1) % 1000);
  }, []);

  const toggleDebug = () => {
    const next = !showDebug;
    setShowDebug(next);
    gameLoop.debugMode = next;
  };

  const toggleSound = () => {
    const active = gameLoop.toggleSound();
    setIsMuted(!active);
  };

  const handleReset = () => {
    gameLoop.resetFight();
  };

  const togglePause = useCallback(() => {
    gameLoop.togglePause();
    setTick(t => (t + 1) % 1000);
  }, [gameLoop]);

  const buyPerk = (perkId: typeof PERK_CATALOG[number]['id'], cost: number) => {
    if (physics.coins >= cost && !physics.perks[perkId]) {
      physics.coins -= cost;
      gameLoop.player.applyPerk(perkId);
      SoundFX.playCoinPickup();
      setTick(t => (t + 1) % 1000);
    }
  };

  useEffect(() => {
    gameLoop.inputManager.onPauseRequested = () => {
      togglePause();
    };
    gameLoop.inputManager.onGamepadChange = () => {
      setTick(t => (t + 1) % 1000);
    };
  }, [gameLoop, togglePause]);

  const isPaused = gameLoop.isPaused;

  const physics = gameLoop.player.physics;
  const fps = gameLoop.fps;
  const enemies = gameLoop.enemies;
  const combat = gameLoop.combatDirector;
  const roomConfig = gameLoop.environmentManager.config;
  const isDoorOpen = gameLoop.environmentManager.doorOpen;
  const isNearDoor = isDoorOpen && Math.abs(physics.position.x - gameLoop.environmentManager.doorX) < 80;

  const anyStaggered = enemies.some(e => e.isStaggered && e.state !== 'DOWNED' && e.health > 0);
  const allEnemiesDowned = enemies.length > 0 && enemies.every(e => e.health <= 0 && e.state === 'DOWNED');
  const unlockedPerksCount = Object.keys(physics.perks).filter(k => physics.perks[k as keyof typeof physics.perks]).length;

  return (
    <div className="relative w-full h-screen bg-[#07080b] text-neutral-200 overflow-hidden font-sans select-none touch-none">
      {/* 1. CORE ENGINE CANVAS */}
      <GameCanvas gameLoop={gameLoop} onStateUpdate={handleStateUpdate} />

      {/* 2. TOP HUD LAYER */}
      <header className="absolute top-0 left-0 right-0 p-3 sm:p-5 pointer-events-none z-30 flex items-start justify-between">
        {/* PLAYER STATUS (Health, Stamina, Tactical Ammo) */}
        <div className="flex flex-col gap-1.5 pointer-events-auto bg-black/60 backdrop-blur-md px-3.5 py-2.5 rounded-xl border border-white/10 shadow-2xl">
          <div className="flex items-center justify-between gap-4">
            <span className="font-extrabold tracking-wider text-xs uppercase text-neutral-100 flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              WICK
            </span>
            <span className="text-[11px] font-mono font-medium text-neutral-400">
              {Math.round(physics.health)} / {physics.maxHealth}
            </span>
          </div>

          {/* Health Bar */}
          <div className="w-36 sm:w-48 h-2.5 bg-neutral-900 rounded-full overflow-hidden border border-white/10">
            <div
              className="h-full bg-gradient-to-r from-red-600 via-rose-500 to-amber-400 transition-all duration-100"
              style={{ width: `${(physics.health / physics.maxHealth) * 100}%` }}
            />
          </div>

          {/* Stamina Bar */}
          <div className="w-36 sm:w-48 h-1.5 bg-neutral-900 rounded-full overflow-hidden border border-white/10">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-75"
              style={{ width: `${(physics.stamina / physics.maxStamina) * 100}%` }}
            />
          </div>

          {/* Tactical 9mm Ammo Indicator */}
          <div className="flex items-center justify-between pt-0.5 text-[10px] font-mono">
            <span className="text-neutral-400 flex items-center gap-1">
              <span className="text-amber-400 font-bold">PISTOL</span>
              {physics.isReloading ? (
                <span className="text-yellow-400 font-bold animate-pulse">RELOADING...</span>
              ) : (
                <span className="text-neutral-300 font-bold">
                  {physics.ammo} / {physics.maxAmmo}
                </span>
              )}
            </span>
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
          </div>
          {/* High Table Gold Coins & Equipped Weapon */}
          <div className="flex items-center gap-2 pt-1 border-t border-white/5">
            <div className="flex items-center gap-1.5 text-amber-300 font-mono text-[11px] font-bold">
              <Coins className="w-3.5 h-3.5 text-yellow-400" />
              <span>{physics.coins} COINS</span>
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
        <div className="flex flex-col items-center gap-1.5 pointer-events-none">
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

          {/* Chamber & Theme Title */}
          <div className="text-[10px] font-mono tracking-wider text-neutral-400 uppercase text-center">
            {roomConfig.title} • {roomConfig.subtitle}
          </div>

          {/* Contextual Stagger Takedown Banner */}
          {anyStaggered && (
            <div className="px-3.5 py-1 rounded-full bg-amber-500/20 border border-amber-400 text-amber-300 text-xs font-bold tracking-wider animate-bounce flex items-center gap-1.5 shadow-xl">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              ENEMY STAGGERED • TAP GRAB / RB FOR TAKEDOWN!
            </div>
          )}

          {/* Exit Door Alert / Next Chamber Prompt */}
          {isDoorOpen && (
            <div className="px-3.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400 text-emerald-300 text-xs font-bold tracking-wider animate-pulse flex items-center gap-1.5 shadow-xl">
              <DoorOpen className="w-4 h-4 text-emerald-400" />
              {isNearDoor ? 'TAP ENTER / ACTION TO ADVANCE!' : 'CHAMBER CLEARED • ADVANCE TO EXIT DOOR'}
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
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Squad Encounter Size & Boss Toggle */}
          <div className="hidden sm:flex items-center gap-1 bg-black/60 backdrop-blur-md p-1 rounded-xl border border-white/10 text-[11px] font-mono shadow-lg">
            {[1, 2, 3].map((count) => (
              <button
                key={count}
                onClick={() => gameLoop.spawnSquad(count)}
                className={`px-2 py-0.5 rounded-lg font-bold transition-all ${
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
              className={`px-2 py-0.5 rounded-lg font-bold transition-all flex items-center gap-1 ${
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
              className={`px-2 py-0.5 rounded-lg font-bold transition-all flex items-center gap-1 ${
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
            className={`p-2 rounded-xl backdrop-blur-md border text-xs transition-all shadow-lg flex items-center gap-1.5 ${
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
            className={`p-2 rounded-xl backdrop-blur-md border text-xs transition-all shadow-lg flex items-center gap-1.5 ${
              isPaused
                ? 'bg-amber-500 border-amber-300 text-black shadow-[0_0_15px_rgba(245,158,11,0.6)] animate-pulse font-black'
                : 'bg-black/60 border-white/10 text-neutral-300 hover:text-white'
            }`}
            title="Pause Mission (Start / Menu)"
          >
            {isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4" />}
            <span className="hidden sm:inline font-mono text-[11px] font-bold">
              {isPaused ? 'RESUME' : 'PAUSE'}
            </span>
          </button>

          {/* Perks Shop Toggle */}
          <button
            id="toggle-perks-btn"
            onClick={() => setShowPerks(!showPerks)}
            className={`p-2 rounded-xl backdrop-blur-md border text-xs transition-all shadow-lg flex items-center gap-1.5 ${
              showPerks || unlockedPerksCount > 0
                ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                : 'bg-black/60 border-white/10 text-neutral-400 hover:text-neutral-200'
            }`}
            title="High Table Armory Perks"
          >
            <Award className="w-4 h-4 text-amber-400" />
            <span className="font-mono text-[11px] font-bold">
              {unlockedPerksCount > 0 ? `${unlockedPerksCount}/5` : 'Perks'}
            </span>
          </button>

          {/* Milestones & High Table Contracts Toggle */}
          <button
            id="toggle-milestones-btn"
            onClick={() => setShowMilestones(!showMilestones)}
            className={`p-2 rounded-xl backdrop-blur-md border text-xs transition-all shadow-lg flex items-center gap-1.5 ${
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
            className={`p-2 rounded-xl backdrop-blur-md border text-xs transition-all shadow-lg flex items-center gap-1.5 ${
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
            className="p-2 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 text-neutral-400 hover:text-neutral-200 text-xs shadow-lg transition-all"
            title="Reset Encounter"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Debug Bone Overlay Toggle */}
          <button
            id="toggle-debug-btn"
            onClick={toggleDebug}
            className={`p-2 rounded-xl backdrop-blur-md border text-xs transition-all shadow-lg flex items-center gap-1.5 ${
              showDebug
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                : 'bg-black/60 border-white/10 text-neutral-400 hover:text-neutral-200'
            }`}
            title="Toggle Skeletal Rig Overlay"
          >
            <Eye className="w-4 h-4" />
            <span className="hidden md:inline font-mono text-[11px]">Rig</span>
          </button>

          {/* Controls / Info Modal Toggle */}
          <button
            id="toggle-help-btn"
            onClick={() => setShowHelp(!showHelp)}
            className="p-2 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 text-neutral-400 hover:text-neutral-200 text-xs shadow-lg transition-all"
            title="Combat Guide"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          {/* FPS Counter */}
          <div className="px-2.5 py-1.5 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 text-neutral-400 font-mono text-[11px] flex items-center gap-1 shadow-lg">
            <Cpu className="w-3.5 h-3.5 text-neutral-500" />
            <span className={fps >= 55 ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
              {fps}
            </span>
          </div>
        </div>
      </header>

      {/* 3. HELP & COMBAT GUIDE MODAL */}
      {showHelp && (
        <div className="absolute inset-0 z-40 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="max-w-xl w-full bg-neutral-900 border border-neutral-700 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Gamepad2 className="w-5 h-5 text-amber-400" />
                Mobile Touch & Type-C Controller Guide
              </h2>
              <button
                onClick={() => setShowHelp(false)}
                className="text-neutral-400 hover:text-white px-2 py-1 text-sm font-semibold rounded-lg hover:bg-white/10 cursor-pointer"
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
                <div className="text-neutral-300"><span className="text-sky-300 font-semibold">A / Cross:</span> Jump Ascent</div>
                <div className="text-neutral-300"><span className="text-emerald-300 font-semibold">B / Circle:</span> Combat Dodge Roll / Slide</div>
                <div className="text-neutral-300"><span className="text-rose-300 font-semibold">X / Square:</span> Light Strike (1-2-3 Combo)</div>
                <div className="text-neutral-300"><span className="text-amber-300 font-semibold">Y / Triangle:</span> Heavy Guard Break Crush</div>
                <div className="text-neutral-300"><span className="text-blue-300 font-semibold">LB / L1:</span> Guard Block / Perfect Parry</div>
                <div className="text-neutral-300"><span className="text-yellow-300 font-semibold">RB / R1:</span> Grab / Close-Quarters Takedown</div>
                <div className="text-neutral-300"><span className="text-neutral-400 font-semibold">LT / L2:</span> Tactical Pistol Reload</div>
                <div className="text-neutral-300"><span className="text-amber-400 font-semibold">RT / R2:</span> Gun-Fu Fire / Shotgun / Throw</div>
                <div className="text-neutral-300"><span className="text-purple-300 font-semibold">Select / L3 / R3:</span> Bullet-Time Focus</div>
                <div className="text-neutral-300"><span className="text-neutral-400 font-semibold">Start / Menu:</span> Tactical Pause Menu</div>
              </div>

              {/* Mobile Touch & Tactics */}
              <div className="bg-neutral-950/70 p-3.5 rounded-xl border border-white/5 space-y-1.5 font-mono">
                <div className="font-bold text-sky-300 flex items-center gap-1.5 font-sans text-xs">
                  <Smartphone className="w-4 h-4 text-sky-400" />
                  Touch Screen Gestures & Tactics
                </div>
                <div className="text-neutral-400">• <span className="text-white font-semibold">Left Thumb:</span> 360° dynamic virtual joystick for running and sliding.</div>
                <div className="text-neutral-400">• <span className="text-white font-semibold">Right Thumb:</span> Instant-response strike, dodge, block, and firearm cluster.</div>
                <div className="text-neutral-400">• <span className="text-yellow-300 font-semibold">Gun-Fu Double Tap:</span> Tap Shoot at point-blank range (&lt;95px) for critical slow-mo executions.</div>
                <div className="text-neutral-400">• <span className="text-sky-300 font-semibold">Guard Break:</span> Tap Heavy button when enemies guard (🛡️ GUARD) to shatter stance!</div>
                <div className="text-neutral-400">• <span className="text-emerald-300 font-semibold">Slide Trip:</span> Slide into blocking enemies to sweep their legs out.</div>
                <div className="text-neutral-400">• <span className="text-purple-300 font-semibold">Perfect Parry:</span> Tap Block just before hit connects for slow-motion stun.</div>
                <div className="text-neutral-400">• <span className="text-amber-400 font-semibold">Haptic Feedback:</span> Native vibration on mobile devices & Type-C controller rumble motors.</div>
              </div>
            </div>

            <button
              onClick={() => setShowHelp(false)}
              className="w-full py-2.5 bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors shadow-lg cursor-pointer"
            >
              Resume Fight
            </button>
          </div>
        </div>
      )}

      {/* 4. HIGH TABLE CONTINENTAL ARMORY & PERKS MODAL */}
      {showPerks && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPerks(false);
          }}
        >
          <div className="max-w-2xl w-full bg-[#0d0f15] border border-amber-500/30 rounded-2xl p-5 sm:p-6 shadow-[0_0_50px_rgba(245,158,11,0.2)] flex flex-col gap-4 text-neutral-200 relative animate-in fade-in zoom-in-95 duration-150">
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
                className="p-1.5 rounded-xl text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
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
                    <span>{physics.coins}</span>
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
                const canAfford = physics.coins >= perk.cost;
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
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-all flex items-center gap-1.5 ${
                            canAfford
                              ? 'bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black shadow-lg cursor-pointer active:scale-95'
                              : 'bg-white/5 text-neutral-500 cursor-not-allowed border border-white/5'
                          }`}
                        >
                          <Award className="w-3.5 h-3.5" />
                          {canAfford ? 'UNLOCK' : `NEED ${perk.cost - physics.coins}`}
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
                className="w-full sm:w-auto px-4 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold transition-colors text-center cursor-pointer"
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
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowMilestones(false);
          }}
        >
          <div className="max-w-2xl w-full bg-[#0c0e14] border border-sky-500/30 rounded-2xl p-5 sm:p-6 shadow-[0_0_50px_rgba(56,189,248,0.18)] flex flex-col gap-4 text-neutral-200 relative animate-in fade-in zoom-in-95 duration-150">
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
                className="p-1.5 rounded-xl text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
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
                          className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-mono text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
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
                className="px-4 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. TACTICAL PAUSE MENU OVERLAY */}
      {isPaused && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) togglePause();
          }}
        >
          <div className="max-w-md w-full bg-[#0d0f15] border border-amber-500/40 rounded-2xl p-6 shadow-[0_0_60px_rgba(245,158,11,0.25)] flex flex-col gap-5 text-neutral-200 relative">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-3 h-3 rounded-full bg-amber-400 animate-ping" />
                <div>
                  <h2 className="text-lg font-black tracking-widest text-amber-300 uppercase font-mono">
                    Mission Suspended
                  </h2>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                    Tactical Combat Pause
                  </span>
                </div>
              </div>
              <button
                onClick={togglePause}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Resume (P or Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Chamber Status Info */}
            <div className="bg-black/50 border border-white/10 rounded-xl p-3.5 space-y-2 text-xs font-mono">
              <div className="flex items-center justify-between text-neutral-400">
                <span>CHAMBER:</span>
                <span className="text-white font-bold">{roomConfig.title} (WAVE {gameLoop.waveNumber})</span>
              </div>
              <div className="flex items-center justify-between text-neutral-400">
                <span>STYLE RATING:</span>
                <span className="text-amber-400 font-bold">{combat.stats.styleRating}</span>
              </div>
              <div className="flex items-center justify-between text-neutral-400">
                <span>CURRENT COMBO:</span>
                <span className="text-white font-bold">{combat.stats.comboCount}x (Max {combat.stats.maxCombo}x)</span>
              </div>
              <div className="flex items-center justify-between text-neutral-400">
                <span>SPECIE COLLECTED:</span>
                <span className="text-yellow-400 font-bold flex items-center gap-1">
                  <Coins className="w-3.5 h-3.5 text-yellow-400" />
                  {physics.coins} Gold Coins
                </span>
              </div>
              <div className="flex items-center justify-between text-neutral-400">
                <span>EXECUTIONS / PARRIES:</span>
                <span className="text-emerald-400 font-bold">{combat.stats.takedownCount} Takedowns • {combat.stats.parryCount} Parries</span>
              </div>
            </div>

            {/* Menu Actions */}
            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={togglePause}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black font-black uppercase tracking-wider text-xs flex items-center justify-center gap-2 shadow-lg transition-transform active:scale-95 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                Resume Mission
              </button>

              <button
                onClick={() => {
                  setShowPerks(true);
                }}
                className="w-full py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-amber-500/30 text-amber-300 font-bold uppercase tracking-wider text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Award className="w-4 h-4 text-amber-400" />
                Continental Armory & Perks
              </button>

              <button
                onClick={() => {
                  setShowMilestones(true);
                }}
                className="w-full py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-sky-500/30 text-sky-300 font-bold uppercase tracking-wider text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Target className="w-4 h-4 text-sky-400" />
                Milestone 7 & Contracts
              </button>

              <button
                onClick={() => {
                  setShowAIAgents(true);
                }}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-950/60 to-purple-950/60 hover:from-amber-900/70 hover:to-purple-900/70 border border-amber-500/40 text-amber-300 font-bold uppercase tracking-wider text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-md"
              >
                <Bot className="w-4 h-4 text-amber-400" />
                AI Syndicate Bureau (Multi-Agent Studio)
              </button>

              <button
                onClick={() => {
                  setShowHelp(true);
                }}
                className="w-full py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-neutral-300 font-bold uppercase tracking-wider text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <HelpCircle className="w-4 h-4 text-neutral-400" />
                Combat Operations Manual
              </button>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={() => {
                    handleReset();
                    togglePause();
                  }}
                  className="py-2 rounded-xl bg-red-950/40 hover:bg-red-900/50 border border-red-500/30 text-red-300 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Restart Chamber
                </button>

                <button
                  onClick={toggleSound}
                  className="py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-neutral-300 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  {isMuted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5 text-emerald-400" />}
                  {isMuted ? 'Muted' : 'Sound On'}
                </button>
              </div>
            </div>

            <div className="text-[10px] text-center text-neutral-400 font-mono">
              Tap Resume Mission or press Start on your Type-C gamepad to continue combat.
            </div>
          </div>
        </div>
      )}

      {/* 7. MOBILE ON-SCREEN VIRTUAL CONTROLS */}
      <VirtualControls
        inputManager={gameLoop.inputManager}
        equippedWeapon={physics.equippedWeapon}
        nearDoor={isNearDoor}
      />

      {/* 8. HIGH TABLE MULTI-AI-AGENTS STUDIO */}
      <AIAgentsModal
        isOpen={showAIAgents}
        onClose={() => setShowAIAgents(false)}
        gameLoop={gameLoop}
        onApplied={() => setTick(t => (t + 1) % 1000)}
      />
    </div>
  );
}

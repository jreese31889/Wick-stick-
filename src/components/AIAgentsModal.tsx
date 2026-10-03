import React, { useState } from 'react';
import {
  Bot,
  Sparkles,
  Building2,
  Swords,
  ShieldAlert,
  Scroll,
  X,
  Play,
  RotateCcw,
  Zap,
  Check,
  Send,
  Loader2,
  Crown
} from 'lucide-react';
import { GameLoop } from '../engine/GameLoop';
import { SoundFX } from '../engine/SoundFX';
import { EnemyController } from '../engine/EnemyController';
import { WeaponType } from '../types/game';

interface AIAgentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  gameLoop: GameLoop;
  onApplied: () => void;
}

type AgentTab = 'architect' | 'director' | 'armorer' | 'lorekeeper' | 'council';

export const AIAgentsModal: React.FC<AIAgentsModalProps> = ({
  isOpen,
  onClose,
  gameLoop,
  onApplied,
}) => {
  const [activeTab, setActiveTab] = useState<AgentTab>('council');
  const [loading, setLoading] = useState(false);
  const [userPrompt, setUserPrompt] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Agent Results State
  const [chamberResult, setChamberResult] = useState<any>(null);
  const [encounterResult, setEncounterResult] = useState<any>(null);
  const [weaponResult, setWeaponResult] = useState<any>(null);
  const [contractResult, setContractResult] = useState<any>(null);
  const [expansionResult, setExpansionResult] = useState<any>(null);

  if (!isOpen) return null;

  // 1. Call Agent: The Architect
  const handleGenerateChamber = async (preset?: string) => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/agents/architect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userPrompt || preset }),
      });
      const data = await res.json();
      if (data.chamber) {
        setChamberResult(data.chamber);
        SoundFX.playWhoosh(1.1);
        setStatusMessage('The Architect has designed a new combat chamber!');
      }
    } catch {
      setStatusMessage('Network issue - check connection.');
    } finally {
      setLoading(false);
    }
  };

  // Inject Chamber into active game loop
  const handleApplyChamber = (chamberData: any) => {
    if (!chamberData) return;
    const env = gameLoop.environmentManager;
    env.config.title = chamberData.title || env.config.title;
    env.config.subtitle = chamberData.subtitle || env.config.subtitle;
    env.config.accentColor = chamberData.accentColor || env.config.accentColor;
    env.config.ambienceColor = chamberData.ambienceColor || env.config.ambienceColor;
    env.config.hasRain = Boolean(chamberData.hasRain);
    env.config.hasNeonLights = Boolean(chamberData.hasNeonLights);

    // Rebuild room furniture
    env.reset();
    env.roomBannerTimer = 3.5;
    SoundFX.playDoorOpen();
    onApplied();
    setStatusMessage(`Chamber "${chamberData.title}" injected into game!`);
  };

  // 2. Call Agent: The Director
  const handleGenerateEncounter = async (preset?: string) => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/agents/director', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userPrompt || preset }),
      });
      const data = await res.json();
      if (data.encounter) {
        setEncounterResult(data.encounter);
        SoundFX.playPunch('heavy');
        setStatusMessage('The Director has choreographed a custom assassin squad!');
      }
    } catch {
      setStatusMessage('Network issue - check connection.');
    } finally {
      setLoading(false);
    }
  };

  // Inject Encounter into active game loop
  const handleApplyEncounter = (encounterData: any) => {
    if (!encounterData || !encounterData.enemies) return;
    const px = gameLoop.player.physics.position.x;
    const newEnemies: EnemyController[] = [];

    encounterData.enemies.forEach((e: any, index: number) => {
      const offset = (index + 1) * (index % 2 === 0 ? 170 : -190);
      const enemy = new EnemyController(
        `agent-enemy-${Date.now()}-${index}`,
        px + offset,
        0,
        e.type || 'BASIC',
        e.moveSpeed || 100
      );
      if (e.maxHealth) {
        enemy.maxHealth = e.maxHealth;
        enemy.health = e.maxHealth;
      }
      if (e.maxStagger) {
        enemy.maxStagger = e.maxStagger;
      }
      if (e.suitColor) enemy.suitColor = e.suitColor;
      if (e.tieColor) enemy.tieColor = e.tieColor;
      newEnemies.push(enemy);
    });

    gameLoop.enemies = newEnemies;
    SoundFX.playPunch('slam');
    onApplied();
    setStatusMessage(`Spawned ${newEnemies.length} custom syndicate assassins!`);
  };

  // 3. Call Agent: The Armorer
  const handleGenerateWeapon = async (preset?: string) => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/agents/armorer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userPrompt || preset }),
      });
      const data = await res.json();
      if (data.weapon) {
        setWeaponResult(data.weapon);
        SoundFX.playBladeSlash();
        setStatusMessage('The Armorer has forged an experimental weapon!');
      }
    } catch {
      setStatusMessage('Network issue - check connection.');
    } finally {
      setLoading(false);
    }
  };

  // Inject Weapon directly into arena
  const handleApplyWeapon = (weaponData: any) => {
    if (!weaponData) return;
    const env = gameLoop.environmentManager;
    const px = gameLoop.player.physics.position.x;
    const dir = gameLoop.player.physics.facingRight ? 1 : -1;
    const targetType: WeaponType =
      weaponData.type === 'SHOTGUN' ? 'SHOTGUN' : weaponData.type === 'KNIFE' ? 'KNIFE' : 'KATANA';

    env.dropWeapon(targetType, px + dir * 60, -70);
    SoundFX.playCoinPickup();
    onApplied();
    setStatusMessage(`Forged ${weaponData.name} and dropped into the chamber!`);
  };

  // 4. Call Agent: The Lorekeeper
  const handleGenerateContract = async (preset?: string) => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/agents/lorekeeper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userPrompt || preset }),
      });
      const data = await res.json();
      if (data.contract) {
        setContractResult(data.contract);
        SoundFX.playCoinPickup();
        setStatusMessage('The Lorekeeper has issued a High Table contract!');
      }
    } catch {
      setStatusMessage('Network issue - check connection.');
    } finally {
      setLoading(false);
    }
  };

  // 5. Council Swarm: Auto-Expand Game All-in-One
  const handleCouncilCollaborate = async (themePreset?: string) => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/agents/collaborate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: userPrompt || themePreset || 'Neon Cyber Underworld' }),
      });
      const data = await res.json();
      if (data.expansion) {
        setExpansionResult(data.expansion);
        SoundFX.playPunch('slam');
        setStatusMessage('The High Table Council has generated a full game expansion!');
      }
    } catch {
      setStatusMessage('Network issue - check connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyFullExpansion = () => {
    if (!expansionResult) return;
    handleApplyChamber(expansionResult.chamber);
    handleApplyEncounter(expansionResult.encounter);
    handleApplyWeapon(expansionResult.weapon);
    setContractResult(expansionResult.contract);
    setStatusMessage(`⚡ Full "${expansionResult.expansionName}" successfully deployed!`);
  };

  return (
    <div
      className="safe-top safe-bottom safe-left safe-right fixed inset-0 z-[56] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto menu-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-w-3xl w-full bg-[#0d0f17] border border-amber-500/40 rounded-2xl p-5 sm:p-6 shadow-[0_0_60px_rgba(245,158,11,0.2)] flex flex-col gap-4 text-neutral-200 relative">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-purple-600/30 border border-amber-400/40 flex items-center justify-center shadow-lg">
              <Bot className="w-5 h-5 text-amber-400 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-wider text-amber-300 uppercase font-mono flex items-center gap-2">
                High Table AI Syndicate Bureau
                <span className="text-[10px] font-sans px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                  MULTI-AGENT STUDIO
                </span>
              </h2>
              <p className="text-xs text-neutral-400">
                Specialized AI Agents actively architecting and building out the game
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Toast Banner */}
        {statusMessage && (
          <div className="px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-mono flex items-center gap-2 menu-in">
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Agent Navigation Tabs */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 bg-black/50 p-1.5 rounded-xl border border-white/10 text-xs font-mono">
          <button
            onClick={() => setActiveTab('council')}
            className={`py-2 px-2.5 rounded-lg flex items-center justify-center gap-1.5 font-bold transition-all ${
              activeTab === 'council'
                ? 'bg-gradient-to-r from-amber-500 to-yellow-400 text-black shadow-md'
                : 'text-amber-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Crown className="w-3.5 h-3.5" />
            <span>Council Swarm</span>
          </button>

          <button
            onClick={() => setActiveTab('architect')}
            className={`py-2 px-2.5 rounded-lg flex items-center justify-center gap-1.5 font-bold transition-all ${
              activeTab === 'architect'
                ? 'bg-sky-500 text-black shadow-md'
                : 'text-sky-300 hover:text-white hover:bg-white/5'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>The Architect</span>
          </button>

          <button
            onClick={() => setActiveTab('director')}
            className={`py-2 px-2.5 rounded-lg flex items-center justify-center gap-1.5 font-bold transition-all ${
              activeTab === 'director'
                ? 'bg-rose-500 text-white shadow-md'
                : 'text-rose-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Swords className="w-3.5 h-3.5" />
            <span>The Director</span>
          </button>

          <button
            onClick={() => setActiveTab('armorer')}
            className={`py-2 px-2.5 rounded-lg flex items-center justify-center gap-1.5 font-bold transition-all ${
              activeTab === 'armorer'
                ? 'bg-purple-500 text-white shadow-md'
                : 'text-purple-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>The Armorer</span>
          </button>

          <button
            onClick={() => setActiveTab('lorekeeper')}
            className={`py-2 px-2.5 rounded-lg flex items-center justify-center gap-1.5 font-bold transition-all ${
              activeTab === 'lorekeeper'
                ? 'bg-emerald-500 text-black shadow-md'
                : 'text-emerald-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Scroll className="w-3.5 h-3.5" />
            <span>The Lorekeeper</span>
          </button>
        </div>

        {/* Natural Language Prompt Input */}
        <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl p-2">
          <input
            type="text"
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            placeholder={
              activeTab === 'council'
                ? 'Instruct the Council (e.g. "Create a rain-slicked cyberpunk high-table rooftop raid")...'
                : activeTab === 'architect'
                ? 'Describe chamber design (e.g. "Neon mirror hall with glass display racks")...'
                : activeTab === 'director'
                ? 'Describe combat squad (e.g. "Dual stealth shinobi assassins with riot shields")...'
                : activeTab === 'armorer'
                ? 'Describe weapon to forge (e.g. "Incendiary dragon breath shotgun with high knockback")...'
                : 'Describe contract target (e.g. "Bounty on an elusive sniper with zero parry mistakes")...'
            }
            className="flex-1 bg-transparent px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none font-mono"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (activeTab === 'council') handleCouncilCollaborate();
                else if (activeTab === 'architect') handleGenerateChamber();
                else if (activeTab === 'director') handleGenerateEncounter();
                else if (activeTab === 'armorer') handleGenerateWeapon();
                else if (activeTab === 'lorekeeper') handleGenerateContract();
              }
            }}
          />
          <button
            disabled={loading}
            onClick={() => {
              if (activeTab === 'council') handleCouncilCollaborate();
              else if (activeTab === 'architect') handleGenerateChamber();
              else if (activeTab === 'director') handleGenerateEncounter();
              else if (activeTab === 'armorer') handleGenerateWeapon();
              else if (activeTab === 'lorekeeper') handleGenerateContract();
            }}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black text-xs font-bold font-mono flex items-center gap-1.5 transition-transform active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            <span>Generate</span>
          </button>
        </div>

        {/* TAB 1: COUNCIL SWARM (All 4 Agents Collaborating) */}
        {activeTab === 'council' && (
          <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
            <div className="p-3.5 rounded-xl bg-gradient-to-br from-amber-950/20 to-purple-950/20 border border-amber-500/30 flex items-start gap-3">
              <Crown className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-neutral-300 space-y-1">
                <div className="font-bold text-amber-300 uppercase tracking-wider font-mono">
                  Autonomous Multi-Agent Collaboration
                </div>
                <p>
                  The Council activates all 4 agents in parallel: <strong>The Architect</strong> builds the chamber,{' '}
                  <strong>The Director</strong> balances the enemy wave, <strong>The Armorer</strong> forges high-table weaponry, and{' '}
                  <strong>The Lorekeeper</strong> generates the assassination contract.
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1.5">
                  <button
                    onClick={() => handleCouncilCollaborate('Osaka Neon Rain Rooftop Raid')}
                    className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-amber-300 font-mono transition-colors"
                  >
                    ⚡ Preset: Osaka Neon Rain
                  </button>
                  <button
                    onClick={() => handleCouncilCollaborate('Glass Cathedral Master Vanguard')}
                    className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-sky-300 font-mono transition-colors"
                  >
                    🏛️ Preset: Glass Cathedral
                  </button>
                  <button
                    onClick={() => handleCouncilCollaborate('Underworld Gold Vault Gauntlet')}
                    className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-emerald-300 font-mono transition-colors"
                  >
                    💰 Preset: Gold Vault Gauntlet
                  </button>
                </div>
              </div>
            </div>

            {expansionResult && (
              <div className="p-4 rounded-xl bg-black/60 border border-amber-500/40 space-y-3 font-mono text-xs menu-in">
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <span className="font-black text-amber-300 text-sm uppercase">
                    {expansionResult.expansionName}
                  </span>
                  <button
                    onClick={handleApplyFullExpansion}
                    className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black font-black text-xs flex items-center gap-1.5 transition-transform active:scale-95 shadow-lg cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Deploy Full Expansion Live
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  <div className="p-2.5 rounded-lg bg-sky-950/20 border border-sky-500/30 space-y-1">
                    <div className="text-sky-300 font-bold flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5" /> Chamber: {expansionResult.chamber?.title}
                    </div>
                    <div className="text-[11px] text-neutral-400">{expansionResult.chamber?.subtitle}</div>
                    <div className="text-[10px] text-neutral-500">{expansionResult.chamber?.description}</div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-rose-950/20 border border-rose-500/30 space-y-1">
                    <div className="text-rose-300 font-bold flex items-center gap-1">
                      <Swords className="w-3.5 h-3.5" /> Squad: {expansionResult.encounter?.squadName}
                    </div>
                    <div className="text-[11px] text-neutral-400">
                      {expansionResult.encounter?.enemies?.length} Hostiles • {expansionResult.encounter?.tacticsTip}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-purple-950/20 border border-purple-500/30 space-y-1">
                    <div className="text-purple-300 font-bold flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5" /> Weapon: {expansionResult.weapon?.name}
                    </div>
                    <div className="text-[11px] text-amber-400">{expansionResult.weapon?.specialEffect}</div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-500/30 space-y-1">
                    <div className="text-emerald-300 font-bold flex items-center gap-1">
                      <Scroll className="w-3.5 h-3.5" /> Bounty: {expansionResult.contract?.targetCodename}
                    </div>
                    <div className="text-[11px] text-yellow-400 font-bold">
                      Payout: +{expansionResult.contract?.bountyCoins} Gold Coins
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: THE ARCHITECT (Level Designer) */}
        {activeTab === 'architect' && (
          <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
            <div className="flex flex-wrap gap-2 text-xs font-mono">
              <button
                onClick={() => handleGenerateChamber('Prismatic Glass Cathedral with neon exhibits')}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sky-300"
              >
                🏛️ Glass Cathedral
              </button>
              <button
                onClick={() => handleGenerateChamber('Rain-drenched Osaka neon alleyway')}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-rose-300"
              >
                🌧️ Osaka Rain Alley
              </button>
              <button
                onClick={() => handleGenerateChamber('Subterranean high table bullion vault')}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-amber-300"
              >
                💰 High Table Vault
              </button>
            </div>

            {chamberResult && (
              <div className="p-4 rounded-xl bg-black/50 border border-sky-500/30 space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-sky-300">{chamberResult.title}</div>
                    <div className="text-[11px] text-neutral-400">{chamberResult.subtitle}</div>
                  </div>
                  <button
                    onClick={() => handleApplyChamber(chamberResult)}
                    className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-black font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Inject Chamber Live
                  </button>
                </div>
                <p className="text-neutral-300">{chamberResult.description}</p>
                <div className="flex gap-3 text-[11px] text-neutral-400 border-t border-white/5 pt-2">
                  <span>Theme: <strong className="text-white">{chamberResult.theme}</strong></span>
                  <span>Rain: <strong className="text-white">{chamberResult.hasRain ? 'Yes' : 'No'}</strong></span>
                  <span>Destructibles: <strong className="text-white">{chamberResult.destructiblesCount}</strong></span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: THE DIRECTOR (Encounter Choreographer) */}
        {activeTab === 'director' && (
          <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
            <div className="flex flex-wrap gap-2 text-xs font-mono">
              <button
                onClick={() => handleGenerateEncounter('Shadow Shinobi stealth squad with rapid strikes')}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-rose-300"
              >
                ⚡ Shinobi Strike Team
              </button>
              <button
                onClick={() => handleGenerateEncounter('Heavy riot Vanguard defenders phalanx')}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-amber-300"
              >
                🛡️ Vanguard Phalanx
              </button>
            </div>

            {encounterResult && (
              <div className="p-4 rounded-xl bg-black/50 border border-rose-500/30 space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-rose-300">{encounterResult.squadName}</div>
                    <div className="text-[11px] text-neutral-400">{encounterResult.tacticsTip}</div>
                  </div>
                  <button
                    onClick={() => handleApplyEncounter(encounterResult)}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Spawn Squad Now
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                  {encounterResult.enemies?.map((e: any, i: number) => (
                    <div key={i} className="p-2 rounded bg-white/5 border border-white/10 text-[11px] space-y-0.5">
                      <div className="font-bold text-neutral-100">{e.name}</div>
                      <div className="text-rose-400 font-bold">{e.type}</div>
                      <div className="text-neutral-400">HP: {e.maxHealth} • Spd: {e.moveSpeed}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: THE ARMORER (Weapons Crafter) */}
        {activeTab === 'armorer' && (
          <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
            <div className="flex flex-wrap gap-2 text-xs font-mono">
              <button
                onClick={() => handleGenerateWeapon('High frequency plasma Katana')}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-purple-300"
              >
                ⚔️ Plasma Katana
              </button>
              <button
                onClick={() => handleGenerateWeapon("Dragon's breath incendiary shotgun")}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-amber-300"
              >
                💥 Dragon's Breath Shotgun
              </button>
              <button
                onClick={() => handleGenerateWeapon('Tungsten tactical throwing knife')}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-emerald-300"
              >
                🗡️ Tungsten Throwing Knife
              </button>
            </div>

            {weaponResult && (
              <div className="p-4 rounded-xl bg-black/50 border border-purple-500/30 space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-purple-300">{weaponResult.name}</div>
                    <div className="text-[11px] text-amber-400">{weaponResult.specialEffect}</div>
                  </div>
                  <button
                    onClick={() => handleApplyWeapon(weaponResult)}
                    className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Forge & Drop in Arena
                  </button>
                </div>
                <p className="text-neutral-300">{weaponResult.description}</p>
                <div className="flex gap-3 text-[11px] text-neutral-400 border-t border-white/5 pt-2">
                  <span>Type: <strong className="text-white">{weaponResult.type}</strong></span>
                  <span>Durability: <strong className="text-white">{weaponResult.durability}</strong></span>
                  <span>Rarity: <strong className="text-amber-400">{weaponResult.rarity}</strong></span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 5: THE LOREKEEPER (Contracts & Bounties) */}
        {activeTab === 'lorekeeper' && (
          <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
            <div className="flex flex-wrap gap-2 text-xs font-mono">
              <button
                onClick={() => handleGenerateContract('Excommunicado open assassination bounty')}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-emerald-300"
              >
                📜 High Table Open Bounty
              </button>
              <button
                onClick={() => handleGenerateContract('Glass cathedral precision parry contract')}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sky-300"
              >
                🎯 Precision Parry Contract
              </button>
            </div>

            {contractResult && (
              <div className="p-4 rounded-xl bg-black/50 border border-emerald-500/30 space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-emerald-300">
                      CONTRACT: {contractResult.targetCodename}
                    </div>
                    <div className="text-[11px] text-neutral-400">ID: {contractResult.contractId}</div>
                  </div>
                  <div className="px-3 py-1.5 rounded-lg bg-yellow-500/20 text-yellow-300 border border-yellow-400/40 font-bold">
                    +{contractResult.bountyCoins} GOLD COINS
                  </div>
                </div>
                <div className="p-2.5 rounded bg-black/40 border border-white/5 space-y-1">
                  <div className="text-amber-300 font-semibold">Objective:</div>
                  <div className="text-neutral-200">{contractResult.objective}</div>
                </div>
                <p className="text-neutral-400 text-[11px] italic">{contractResult.briefing}</p>
              </div>
            )}
          </div>
        )}

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-white/10 pt-2 text-xs font-mono text-neutral-400">
          <span>AI Agents utilize Gemini 3.8 to build and expand gameplay live.</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold transition-colors cursor-pointer"
          >
            Return to Combat
          </button>
        </div>
      </div>
    </div>
  );
};

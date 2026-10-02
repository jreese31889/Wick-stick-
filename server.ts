import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const app = express();
const port = 3000;

app.use(express.json());

// Initialize GoogleGenAI client (reads GEMINI_API_KEY from env)
let ai: GoogleGenAI | null = null;
try {
  ai = new GoogleGenAI();
} catch (e) {
  console.warn('GoogleGenAI initialization notice:', e);
}

// -------------------------------------------------------------
// 1. AGENT: THE ARCHITECT (Level & Environment Generation)
// -------------------------------------------------------------
app.post('/api/agents/architect', async (req: Request, res: Response) => {
  const { prompt, themePreset } = req.body;
  const userRequest = prompt || themePreset || 'Continental high-stakes noir chamber';

  const systemInstruction = `You are "The Architect", an elite procedural level designer AI agent for the John Wick inspired stick-figure action game "WICK STICK".
Your job is to design a high-stakes, stylish underworld combat chamber.
Return ONLY valid JSON matching this schema:
{
  "title": string (e.g. "THE GLASS CATHEDRAL", "NEO-TOKYO PENTHOUSE"),
  "subtitle": string (e.g. "High Table Glass Pavilion", "Rain-Slicked Osaka Spire"),
  "theme": "CONTINENTAL_LOUNGE" | "NEON_GALLERY" | "RAINY_ALLEY" | "PENTHOUSE_SUITE",
  "ambienceColor": string (hex color for dark background e.g. "#0a0c16"),
  "accentColor": string (hex color for neon highlights e.g. "#f59e0b"),
  "floorColor": string (hex color e.g. "#111422"),
  "hasRain": boolean,
  "hasNeonLights": boolean,
  "destructiblesCount": number (between 3 and 7),
  "description": string (atmospheric briefing in 2 sentences)
}`;

  try {
    if (process.env.GEMINI_API_KEY && ai) {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Design a custom combat chamber based on: "${userRequest}".`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.7,
        },
      });

      const text = response.text;
      if (text) {
        const parsed = JSON.parse(text);
        return res.json({ success: true, agent: 'The Architect', chamber: parsed });
      }
    }
  } catch (err) {
    console.error('Architect Agent Gemini error:', err);
  }

  // Fallback procedural chamber generator
  const presets = [
    {
      title: 'THE GLASS CATHEDRAL',
      subtitle: 'Prismatic Pavilion & Champagne Barricade',
      theme: 'NEON_GALLERY',
      ambienceColor: '#070a14',
      accentColor: '#38bdf8',
      floorColor: '#0f172a',
      hasRain: false,
      hasNeonLights: true,
      destructiblesCount: 5,
      description: 'A soaring glass atrium filled with rare museum artifacts and champagne crystal displays. Pure lethal reflections.',
    },
    {
      title: 'OSAKA ROOFTOP VERANDA',
      subtitle: 'Rain-Slicked Neon Alleyway',
      theme: 'RAINY_ALLEY',
      ambienceColor: '#05070e',
      accentColor: '#ec4899',
      floorColor: '#090d1a',
      hasRain: true,
      hasNeonLights: true,
      destructiblesCount: 4,
      description: 'Torrential neon rain pours over wet asphalt and shattered display racks as High Table enforcers close in.',
    },
    {
      title: 'THE HIGH SOVEREIGN VAULT',
      subtitle: 'Continental Bullion Chamber',
      theme: 'CONTINENTAL_LOUNGE',
      ambienceColor: '#090805',
      accentColor: '#f59e0b',
      floorColor: '#17120a',
      hasRain: false,
      hasNeonLights: false,
      destructiblesCount: 6,
      description: 'Subterranean fortified vault lined with gold bullion racks and bulletproof exhibit cases.',
    },
  ];

  const fallback = presets[Math.floor(Math.random() * presets.length)];
  return res.json({ success: true, agent: 'The Architect', chamber: fallback, fallback: true });
});

// -------------------------------------------------------------
// 2. AGENT: THE DIRECTOR (Combat & Encounter Choreographer)
// -------------------------------------------------------------
app.post('/api/agents/director', async (req: Request, res: Response) => {
  const { prompt, difficulty } = req.body;
  const userRequest = prompt || `Encounter with difficulty: ${difficulty || 'Master'}`;

  const systemInstruction = `You are "The Director", an expert martial-arts combat choreographer AI agent for "WICK STICK".
Your job is to choreograph a dynamic syndicate assassin encounter.
Return ONLY valid JSON matching this schema:
{
  "squadName": string (e.g. "SHADOW SHINOBI AMBUSH", "VANGUARD SHIELD PHALANX"),
  "description": string (tactical intel briefing in 2 sentences),
  "tacticsTip": string (how to defeat them using slides, parries, or weapon throws),
  "enemies": [
    {
      "name": string,
      "type": "BASIC" | "RUSHER" | "HEAVY" | "DEFENDER" | "ELITE" | "BOSS",
      "maxHealth": number (50 to 300),
      "moveSpeed": number (70 to 180),
      "maxStagger": number (20 to 100),
      "suitColor": string (hex color),
      "tieColor": string (hex color)
    }
  ]
}`;

  try {
    if (process.env.GEMINI_API_KEY && ai) {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Choreograph a custom assassin squad based on: "${userRequest}".`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.75,
        },
      });

      const text = response.text;
      if (text) {
        const parsed = JSON.parse(text);
        return res.json({ success: true, agent: 'The Director', encounter: parsed });
      }
    }
  } catch (err) {
    console.error('Director Agent Gemini error:', err);
  }

  // Fallback procedural encounter
  const fallback = {
    squadName: 'APEX SYNDICATE INFILTRATION',
    description: 'A fortified Vanguard Defender paired with a high-speed Shadow Shinobi flanker and midnight enforcer.',
    tacticsTip: 'Use Heavy Guard-Break on the Defender, and slide under the Shinobi to trip their sweep!',
    enemies: [
      {
        name: 'Vanguard Titan',
        type: 'DEFENDER' as const,
        maxHealth: 130,
        moveSpeed: 85,
        maxStagger: 75,
        suitColor: '#1c1917',
        tieColor: '#f59e0b',
      },
      {
        name: 'Shadow Shinobi',
        type: 'ELITE' as const,
        maxHealth: 85,
        moveSpeed: 170,
        maxStagger: 35,
        suitColor: '#0f172a',
        tieColor: '#a855f7',
      },
      {
        name: 'Continental Enforcer',
        type: 'BASIC' as const,
        maxHealth: 65,
        moveSpeed: 110,
        maxStagger: 30,
        suitColor: '#18181b',
        tieColor: '#ef4444',
      },
    ],
  };

  return res.json({ success: true, agent: 'The Director', encounter: fallback, fallback: true });
});

// -------------------------------------------------------------
// 3. AGENT: THE ARMORER (Weapons & Perks Crafter)
// -------------------------------------------------------------
app.post('/api/agents/armorer', async (req: Request, res: Response) => {
  const { prompt, category } = req.body;
  const userRequest = prompt || `Custom weapon in category: ${category || 'Experimental'}`;

  const systemInstruction = `You are "The Armorer", master weaponsmith of the Continental High Table.
You forge lethal custom weaponry and tactical enhancements for John Wick.
Return ONLY valid JSON matching this schema:
{
  "name": string (e.g. "Dragon's Breath Katana", "Sovereign 12-Gauge"),
  "type": "KATANA" | "KNIFE" | "SHOTGUN",
  "durability": number (between 5 and 25),
  "damageMultiplier": number (between 1.2 and 2.5),
  "specialEffect": string (e.g. "Shreds guard shields on impact", "Explosive incendiary spread"),
  "description": string (tactical flavor text),
  "rarity": "SPECIE" | "MASTERWORK" | "MYTHIC"
}`;

  try {
    if (process.env.GEMINI_API_KEY && ai) {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Forge a custom lethal weapon based on: "${userRequest}".`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.8,
        },
      });

      const text = response.text;
      if (text) {
        const parsed = JSON.parse(text);
        return res.json({ success: true, agent: 'The Armorer', weapon: parsed });
      }
    }
  } catch (err) {
    console.error('Armorer Agent Gemini error:', err);
  }

  // Fallback procedural weapon
  const weapons = [
    {
      name: 'Vibranium-Forged Katana',
      type: 'KATANA' as const,
      durability: 18,
      damageMultiplier: 1.8,
      specialEffect: 'High-frequency blade shatters enemy block stances instantly.',
      description: 'Folded ten thousand times in the Osaka continental foundry. Unmatched cutting edge.',
      rarity: 'MASTERWORK' as const,
    },
    {
      name: "Dragon's Breath Street Sweeper",
      type: 'SHOTGUN' as const,
      durability: 8,
      damageMultiplier: 2.2,
      specialEffect: 'Incendiary magnesium shells trigger massive knockback shockwaves.',
      description: 'Custom short-barrel shotgun loaded with high-temperature flechettes.',
      rarity: 'MYTHIC' as const,
    },
    {
      name: 'Tungsten Obsidian Throwing Blade',
      type: 'KNIFE' as const,
      durability: 6,
      damageMultiplier: 2.4,
      specialEffect: 'Pierces through multiple hostiles in a straight trajectory.',
      description: 'Aerodynamic throwing knife with tungsten-carbide weighted core.',
      rarity: 'SPECIE' as const,
    },
  ];

  const fallback = weapons[Math.floor(Math.random() * weapons.length)];
  return res.json({ success: true, agent: 'The Armorer', weapon: fallback, fallback: true });
});

// -------------------------------------------------------------
// 4. AGENT: THE LOREKEEPER (Underworld Contracts & Bounties)
// -------------------------------------------------------------
app.post('/api/agents/lorekeeper', async (req: Request, res: Response) => {
  const { prompt } = req.body;
  const userRequest = prompt || 'High-value Continental open contract';

  const systemInstruction = `You are "The Lorekeeper", the High Table Syndicate Chronicler and Contract Administrator for "WICK STICK".
Your job is to issue underworld assassination contracts and bounties.
Return ONLY valid JSON matching this schema:
{
  "contractId": string (e.g. "HTC-9042"),
  "targetCodename": string (e.g. "THE GHOST OF OSAKA", "THE IRON BARON"),
  "bountyCoins": number (between 5 and 15),
  "objective": string (e.g. "Eliminate 3 enemies without taking health damage", "Execute 2 point-blank executions"),
  "briefing": string (flavor narrative briefing),
  "rewardTitle": string (e.g. "Continental Sovereign Seal")
}`;

  try {
    if (process.env.GEMINI_API_KEY && ai) {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Generate an underworld assassination contract based on: "${userRequest}".`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.7,
        },
      });

      const text = response.text;
      if (text) {
        const parsed = JSON.parse(text);
        return res.json({ success: true, agent: 'The Lorekeeper', contract: parsed });
      }
    }
  } catch (err) {
    console.error('Lorekeeper Agent Gemini error:', err);
  }

  // Fallback procedural contract
  const fallback = {
    contractId: `HTC-${Math.floor(1000 + Math.random() * 9000)}`,
    targetCodename: 'ZERO: HIGH TABLE MASTER',
    bountyCoins: 10,
    objective: 'Survive and clear wave with an APEX or BABA YAGA style rating.',
    briefing: 'The High Table has issued an excommunicado order. Elimination of the envoy restores Continental privileges.',
    rewardTitle: 'High Table Gold Sovereign',
  };

  return res.json({ success: true, agent: 'The Lorekeeper', contract: fallback, fallback: true });
});

// -------------------------------------------------------------
// 5. COUNCIL COLLABORATION: AUTO-EXPAND GAME
// -------------------------------------------------------------
app.post('/api/agents/collaborate', async (req: Request, res: Response) => {
  const { theme } = req.body;
  const userRequest = theme || 'Neo-Noir Cyber High Table Expansion';

  try {
    if (process.env.GEMINI_API_KEY && ai) {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `All 4 AI Agents collaborate to build a complete game expansion for "WICK STICK" based on theme: "${userRequest}".
Return ONLY valid JSON matching this schema:
{
  "expansionName": string,
  "chamber": {
    "title": string,
    "subtitle": string,
    "theme": "CONTINENTAL_LOUNGE" | "NEON_GALLERY" | "RAINY_ALLEY" | "PENTHOUSE_SUITE",
    "ambienceColor": string,
    "accentColor": string,
    "floorColor": string,
    "hasRain": boolean,
    "hasNeonLights": boolean,
    "destructiblesCount": number,
    "description": string
  },
  "encounter": {
    "squadName": string,
    "description": string,
    "tacticsTip": string,
    "enemies": [
      {
        "name": string,
        "type": "BASIC" | "RUSHER" | "HEAVY" | "DEFENDER" | "ELITE" | "BOSS",
        "maxHealth": number,
        "moveSpeed": number,
        "maxStagger": number,
        "suitColor": string,
        "tieColor": string
      }
    ]
  },
  "weapon": {
    "name": string,
    "type": "KATANA" | "KNIFE" | "SHOTGUN",
    "durability": number,
    "damageMultiplier": number,
    "specialEffect": string,
    "description": string,
    "rarity": "SPECIE" | "MASTERWORK" | "MYTHIC"
  },
  "contract": {
    "contractId": string,
    "targetCodename": string,
    "bountyCoins": number,
    "objective": string,
    "briefing": string,
    "rewardTitle": string
  }
}`,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.75,
        },
      });

      const text = response.text;
      if (text) {
        const parsed = JSON.parse(text);
        return res.json({ success: true, expansion: parsed });
      }
    }
  } catch (err) {
    console.error('Council collaborate error:', err);
  }

  // Fallback collaboration
  const fallback = {
    expansionName: 'THE PRISMATIC SANCTUARY EXPANSION',
    chamber: {
      title: 'THE PRISMATIC SANCTUARY',
      subtitle: 'Saint Jude Underworld Vault',
      theme: 'NEON_GALLERY' as const,
      ambienceColor: '#070a16',
      accentColor: '#8b5cf6',
      floorColor: '#0e1222',
      hasRain: false,
      hasNeonLights: true,
      destructiblesCount: 6,
      description: 'High-ceiling glass gallery filled with neon stained glass and reinforced display pedestals.',
    },
    encounter: {
      squadName: 'PRISMATIC HIT SQUAD',
      description: 'An elite vanguard sentinel shielding a rapid shinobi assassin.',
      tacticsTip: 'Shatter the shield with a heavy crush, then execute with a quick knife throw!',
      enemies: [
        {
          name: 'Sanctuary Paladin',
          type: 'DEFENDER' as const,
          maxHealth: 140,
          moveSpeed: 80,
          maxStagger: 80,
          suitColor: '#171717',
          tieColor: '#8b5cf6',
        },
        {
          name: 'Shinobi Shade',
          type: 'ELITE' as const,
          maxHealth: 90,
          moveSpeed: 165,
          maxStagger: 40,
          suitColor: '#0f172a',
          tieColor: '#ec4899',
        },
      ],
    },
    weapon: {
      name: 'Prismatic Plasma Katana',
      type: 'KATANA' as const,
      durability: 20,
      damageMultiplier: 2.0,
      specialEffect: 'Unleashes glowing violet blade arcs that pierce armor.',
      description: 'Superheated blade forged from celestial steel.',
      rarity: 'MYTHIC' as const,
    },
    contract: {
      contractId: 'HTC-7701',
      targetCodename: 'PRISMATIC EXCOMMUNICADO',
      bountyCoins: 12,
      objective: 'Clear the Prismatic Sanctuary with zero downed states.',
      briefing: 'Eliminate the High Table enclave and secure the sovereign seal.',
      rewardTitle: 'Prismatic Sovereign Badge',
    },
  };

  return res.json({ success: true, expansion: fallback, fallback: true });
});

// -------------------------------------------------------------
// VITE DEV MIDDLEWARE & STATIC SERVING
// -------------------------------------------------------------
async function initServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static('dist'));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve('dist/index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`WICK STICK Server with AI Agents listening on port ${port}`);
  });
}

initServer();

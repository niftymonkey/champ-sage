/**
 * Run each coaching scenario 3x to check response consistency.
 * Shows: pick, first 150 chars of answer, timing.
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { generateText, Output, jsonSchema } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { buildSystemPrompt, buildUserPrompt } from "../src/lib/ai/prompts";
import type { CoachingContext, CoachingQuery } from "../src/lib/ai/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const apiKey = process.env.VITE_OPENAI_API_KEY!;
const model = createOpenAI({ apiKey })("gpt-5.4-mini");
const schema = jsonSchema<{
  answer: string;
  recommendations: Array<{ name: string; reasoning: string }>;
}>({
  type: "object",
  properties: {
    answer: { type: "string" },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, reasoning: { type: "string" } },
        required: ["name", "reasoning"],
        additionalProperties: false,
      },
    },
  },
  required: ["answer", "recommendations"],
  additionalProperties: false,
});

// --- Scenario 1: Bel'Veth early, AP-heavy enemy ---
const s1: { ctx: CoachingContext; query: CoachingQuery } = {
  ctx: {
    champion: {
      name: "Bel'Veth",
      level: 1,
      abilities:
        "Passive: Death in Lavender - Permanent AS stacks from takedowns.\nVoid Surge - Dash.\nAbove and Below - Knockup + slow.\nRoyal Maelstrom - Channel: lifesteal + damage reduction.\nEndless Banquet - Transform: max HP, AS, range, MS.",
      statProfile:
        "Melee | Fighter | HP: 610 (+105/lvl) | AD: 60 (+0/lvl) | AS: 0.85 (+0%/lvl) | Armor: 32 (+4.7/lvl) | MR: 32 (+2.05/lvl) | No resource",
    },
    currentItems: [],
    currentAugments: [],
    teamAnalysis:
      "Your team roles: 1 Fighter, 1 Tank, 1 Mage, 1 Marksman, 1 Support — all roles covered. Enemy damage: heavily AP (3 AP, 1 AD — favor magic resist).",
    augmentSets: [
      {
        name: "Firecracker",
        bonuses: [
          {
            threshold: 2,
            description:
              "Firecrackers bounce to 2 nearby enemies at 25% effectiveness",
          },
        ],
      },
    ],
    enemyTeam: [
      { champion: "Fizz", items: [] },
      { champion: "Lissandra", items: [] },
      { champion: "Syndra", items: [] },
      { champion: "Kindred", items: [] },
      { champion: "Yuumi", items: [] },
    ],
    allyTeam: [
      { champion: "Garen" },
      { champion: "Ahri" },
      { champion: "Jinx" },
      { champion: "Nami" },
    ],
    gameMode: "ARAM",
    lcuGameMode: "KIWI",
    gameTime: 30,
    balanceOverrides: "Damage dealt: +5%, Damage taken: -5%, Tenacity: +20%",
  },
  query: {
    question: "Goliath, Light 'em Up!, or Protein Shake?",
    augmentOptions: [
      {
        name: "Goliath",
        description:
          "Gain 75% increased size, 30% bonus health, 25% bonus attack damage, and 50 bonus attack range.",
        tier: "Prismatic",
      },
      {
        name: "Light 'em Up!",
        description:
          "Basic attacks and abilities launch Firecrackers. Firecrackers deal magic damage.",
        tier: "Gold",
        sets: ["Firecracker"],
      },
      {
        name: "Protein Shake",
        description:
          "Gain 25% heal and shield power (+ 35% per 100 bonus armor) (+ 35% per 100 bonus MR).",
        tier: "Prismatic",
      },
    ],
  },
};

// --- Scenario 2: Bel'Veth mid, quest active, all-AD enemy ---
const s2: { ctx: CoachingContext; query: CoachingQuery } = {
  ctx: {
    champion: {
      name: "Bel'Veth",
      level: 9,
      abilities:
        "Passive: Death in Lavender - Permanent AS stacks.\nVoid Surge - Dash.\nAbove and Below - Knockup.\nRoyal Maelstrom - Lifesteal + DR.\nEndless Banquet - Transform.",
      statProfile:
        "Melee | Fighter | HP: 610 (+105/lvl) | AD: 60 (+0/lvl) | AS: 0.85 (+0%/lvl) | Armor: 32 (+4.7/lvl) | MR: 32 (+2.05/lvl) | No resource",
    },
    currentItems: [
      {
        name: "Kraken Slayer",
        description: "30 AD, 40% AS, 20% Crit. On-hit proc.",
      },
      { name: "Berserker's Greaves", description: "35% AS, 45 MS." },
      { name: "Recurve Bow", description: "15% AS, 15 on-hit." },
    ],
    currentAugments: [
      {
        name: "Quest: Icathia's Fall",
        description:
          "Gain Bami's Cinder. You can now purchase Hollow Radiance and Sunfire Aegis in spite of the Immolate limit. Quest: Obtain Hollow Radiance and Sunfire Aegis. Reward: Upon completing your Quest, convert them into Void Immolation. [Void Immolation stats: 80 MR, 1000 Health, 100 Armor]",
        sets: ["Stackosaurus Rex"],
      },
      { name: "Deft", description: "Grants 60% bonus attack speed." },
    ],
    teamAnalysis:
      "Your team roles: 1 Fighter, 1 Assassin, 1 Support — no Tank, no Marksman. Enemy damage: all AD (5/5 — stack armor).",
    augmentSets: [
      {
        name: "Stackosaurus Rex",
        bonuses: [
          {
            threshold: 2,
            description: "Gain 50% more permanent stacks from abilities",
          },
        ],
      },
    ],
    enemyTeam: [
      { champion: "Zed", items: [{ name: "Youmuu's", description: "" }] },
      { champion: "Draven", items: [{ name: "BOTRK", description: "" }] },
      { champion: "Riven", items: [{ name: "Eclipse", description: "" }] },
      { champion: "Jayce", items: [{ name: "Manamune", description: "" }] },
      { champion: "Pantheon", items: [{ name: "Eclipse", description: "" }] },
    ],
    allyTeam: [
      { champion: "Katarina" },
      { champion: "Talon" },
      { champion: "Soraka" },
      { champion: "Akali" },
    ],
    gameMode: "ARAM",
    lcuGameMode: "KIWI",
    gameTime: 510,
    balanceOverrides: "Damage dealt: +5%, Damage taken: -5%, Tenacity: +20%",
  },
  query: {
    question: "What should I build next?",
    history: [
      {
        question: "Goliath, Deft, or Escape Plan?",
        answer: "Take Deft — 60% bonus AS is massive on Bel'Veth.",
      },
      {
        question: "I chose Quest: Icathia's Fall. What now?",
        answer:
          "Complete the quest — Void Immolation is enormous and your team has no tank.",
      },
    ],
  },
};

// --- Scenario 3: Ahri late, Archmage set active ---
const s3: { ctx: CoachingContext; query: CoachingQuery } = {
  ctx: {
    champion: {
      name: "Ahri",
      level: 15,
      abilities:
        "Passive: Essence Theft.\nOrb of Deception - Magic + true damage.\nFox-Fire - 3 homing bolts.\nCharm - CC + damage.\nSpirit Rush - 3 dashes + bolts.",
      statProfile:
        "Ranged (550) | Mage, Assassin | HP: 590 (+104/lvl) | AD: 53 (+0/lvl) | AS: 0.668 (+2.2%/lvl) | Armor: 21 (+4.2/lvl) | MR: 30 (+1.3/lvl) | Mana",
    },
    currentItems: [
      { name: "Luden's Echo", description: "100 AP, 10 MPen, 20 AH." },
      { name: "Rabadon's Deathcap", description: "140 AP. +35% total AP." },
      { name: "Sorcerer's Shoes", description: "18 MPen, 45 MS." },
      { name: "Void Staff", description: "70 AP, 40% MPen." },
      { name: "Shadowflame", description: "100 AP. Bonus MPen vs champions." },
    ],
    currentAugments: [
      {
        name: "Overflow",
        description: "200% mana regen. AP equal to 3% max mana.",
        sets: ["Archmage"],
      },
      {
        name: "Mind to Matter",
        description: "1 AP per 25 max mana.",
        sets: ["Archmage"],
      },
      {
        name: "Glass Cannon",
        description: "Die at 30% HP, but all damage +40%.",
      },
    ],
    teamAnalysis:
      "Your team roles: 2 Mage, 1 Assassin, 1 Fighter, 1 Support — no Tank, no Marksman. Enemy damage: mixed (3 AD, 2 AP).",
    augmentSets: [
      {
        name: "Archmage",
        bonuses: [
          {
            threshold: 2,
            description:
              "Casting an ability refunds 30% of the cooldown of another ability",
          },
        ],
      },
    ],
    enemyTeam: [
      { champion: "Yasuo", items: [{ name: "IE", description: "" }] },
      {
        champion: "Darius",
        items: [{ name: "Stridebreaker", description: "" }],
      },
      { champion: "Brand", items: [{ name: "Liandry's", description: "" }] },
      { champion: "Zyra", items: [{ name: "Luden's", description: "" }] },
      {
        champion: "Miss Fortune",
        items: [{ name: "Collector", description: "" }],
      },
    ],
    allyTeam: [
      { champion: "Katarina" },
      { champion: "Mordekaiser" },
      { champion: "Lulu" },
      { champion: "Veigar" },
    ],
    gameMode: "ARAM",
    lcuGameMode: "KIWI",
    gameTime: 1320,
    balanceOverrides: null,
  },
  query: {
    question: "Juiced, Blunt Force, or Phenomenal Evil?",
    augmentOptions: [
      {
        name: "Juiced",
        description:
          "Immobilize/ground restores 10% max mana and grants 30 AP for 8s.",
        tier: "Gold",
        sets: ["Archmage"],
      },
      {
        name: "Blunt Force",
        description: "Increases attack damage by 20%.",
        tier: "Silver",
      },
      {
        name: "Phenomenal Evil",
        description:
          "Gain 2 AP permanently per ability hit on champions. Stacks infinitely.",
        tier: "Gold",
        sets: ["Stackosaurus Rex"],
      },
    ],
  },
};

// --- Scenario 1B: Bel'Veth early, NO tank on team, Goliath should be clear winner ---
// Weaker alternatives: Blunt Force (Silver, just 20% AD) and Don't Blink (niche MS-based)
// Team has no tank, enemy is AP-heavy — Goliath's 30% bonus HP + melee fighter should dominate
const s1b: { ctx: CoachingContext; query: CoachingQuery } = {
  ctx: {
    ...s1.ctx,
    teamAnalysis:
      "Your team roles: 1 Fighter, 1 Mage, 1 Assassin, 1 Marksman — no Tank, no Support. Enemy damage: heavily AP (3 AP, 1 AD — favor magic resist).",
    allyTeam: [
      { champion: "Ahri" },
      { champion: "Katarina" },
      { champion: "Jinx" },
      { champion: "Akali" },
    ],
  },
  query: {
    question: "Goliath, Blunt Force, or Don't Blink?",
    augmentOptions: [
      {
        name: "Goliath",
        description:
          "Gain 75% increased size, 30% bonus health, 25% bonus attack damage, and 50 bonus attack range.",
        tier: "Prismatic",
      },
      {
        name: "Blunt Force",
        description: "Increases attack damage by 20%.",
        tier: "Silver",
      },
      {
        name: "Don't Blink",
        description:
          "Deal 1% increased damage per 10 movement speed you have more than the target.",
        tier: "Silver",
      },
    ],
  },
};

const scenarios = [
  {
    name: "S1: Bel'Veth early — Goliath / Protein Shake / Light 'em Up (competitive)",
    ...s1,
  },
  {
    name: "S1B: Bel'Veth early — Goliath / Blunt Force / Don't Blink (no tank, clear winner?)",
    ...s1b,
  },
  { name: "S2: Bel'Veth mid — what to build (quest + all-AD enemy)", ...s2 },
  { name: "S3: Ahri late — Juiced / Phenomenal Evil / Blunt Force", ...s3 },
];

async function main() {
  for (const s of scenarios) {
    const sys = buildSystemPrompt({
      gameMode: s.ctx.gameMode,
      lcuGameMode: s.ctx.lcuGameMode,
    });
    const usr = buildUserPrompt(s.ctx, s.query);
    console.log(`\n${"=".repeat(70)}`);
    console.log(s.name);
    console.log("=".repeat(70));
    for (let i = 0; i < 3; i++) {
      const start = Date.now();
      const r = await generateText({
        model,
        system: sys,
        prompt: usr,
        output: Output.object({ schema }),
        maxOutputTokens: 512,
      });
      const ms = Date.now() - start;
      const pick = r.output.recommendations[0]?.name ?? "N/A";
      console.log(
        `  Run ${i + 1} (${ms}ms): PICK=${pick}\n    ${r.output.answer.substring(0, 200)}`
      );
    }
  }
  console.log("\nDone.");
}

main().catch(console.error);

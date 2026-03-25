/**
 * Preview the full coaching prompts for realistic game scenarios.
 *
 * Shows exactly what the model receives with all coaching quality improvements:
 * stat profile, team analysis, set bonus progress, quest reward stats, etc.
 *
 * Optionally sends to the model with --run flag to see actual responses.
 *
 * Usage:
 *   pnpm preview-prompts          # just show prompts
 *   pnpm preview-prompts -- --run # show prompts AND get model responses
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { buildSystemPrompt, buildUserPrompt } from "../src/lib/ai/prompts";
import type { CoachingContext, CoachingQuery } from "../src/lib/ai/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const shouldRun = process.argv.includes("--run");

// =============================================================================
// Scenario 1: Early game augment selection — Bel'Veth, level 1, first augments
// Exercises: stat profile, team analysis, augment options
// =============================================================================

const scenario1Context: CoachingContext = {
  champion: {
    name: "Bel'Veth",
    level: 1,
    abilities:
      "Passive: Death in Lavender - Permanent attack speed stacks from takedowns. Temporary bonus AS after ability use.\n" +
      "Void Surge - Dash through enemies, dealing damage.\n" +
      "Above and Below - Ground slam, knockup + slow.\n" +
      "Royal Maelstrom - Channel: slashes lowest-HP enemy, grants lifesteal and damage reduction.\n" +
      "Endless Banquet - Transform: increased max HP, attack range, attack speed, move speed.",
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
        {
          threshold: 4,
          description:
            "Firecrackers bounce to 3 nearby enemies at 50% effectiveness",
        },
      ],
    },
  ],
  enemyTeam: [
    { champion: "Fizz", items: [{ name: "Amplifying Tome", description: "" }] },
    {
      champion: "Lissandra",
      items: [{ name: "Amplifying Tome", description: "" }],
    },
    {
      champion: "Syndra",
      items: [{ name: "Amplifying Tome", description: "" }],
    },
    { champion: "Kindred", items: [{ name: "Dagger", description: "" }] },
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
};

const scenario1Query: CoachingQuery = {
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
        "Your basic attacks and abilities launch Firecrackers at the target. Firecrackers deal magic damage.",
      tier: "Gold",
      sets: ["Firecracker"],
    },
    {
      name: "Protein Shake",
      description:
        "Gain 25% heal and shield power (+ 35% per 100 bonus armor) (+ 35% per 100 bonus magic resistance) heal and shield power.",
      tier: "Prismatic",
    },
  ],
};

// =============================================================================
// Scenario 2: Mid game with quest augment chosen — asking about items
// Exercises: chosen augment re-injection, quest reward stats, build constraint
// =============================================================================

const scenario2Context: CoachingContext = {
  champion: {
    name: "Bel'Veth",
    level: 9,
    abilities:
      "Passive: Death in Lavender - Permanent attack speed stacks from takedowns.\n" +
      "Void Surge - Dash through enemies.\n" +
      "Above and Below - Ground slam, knockup + slow.\n" +
      "Royal Maelstrom - Channel: lifesteal and damage reduction.\n" +
      "Endless Banquet - Transform: increased max HP, attack range, AS, move speed.",
    statProfile:
      "Melee | Fighter | HP: 610 (+105/lvl) | AD: 60 (+0/lvl) | AS: 0.85 (+0%/lvl) | Armor: 32 (+4.7/lvl) | MR: 32 (+2.05/lvl) | No resource",
  },
  currentItems: [
    {
      name: "Kraken Slayer",
      description:
        "30 Attack Damage, 40% Attack Speed, 20% Critical Strike Chance. Bring It Down: Every third attack deals bonus physical damage.",
    },
    {
      name: "Berserker's Greaves",
      description: "35% Attack Speed, 45 Move Speed.",
    },
    {
      name: "Recurve Bow",
      description: "15% Attack Speed. On-hit: 15 bonus physical damage.",
    },
  ],
  currentAugments: [
    {
      name: "Quest: Icathia's Fall",
      description:
        "Gain Bami's Cinder. You can now purchase Hollow Radiance and Sunfire Aegis in spite of the item limit imposed by Immolate. Quest: Obtain Hollow Radiance and Sunfire Aegis. Reward: Upon completing your Quest, convert the items you obtained for the quest into Void Immolation. [Void Immolation stats: 80 Magic Resist, 1000 Health, 100 Armor]",
      sets: ["Stackosaurus Rex"],
    },
    {
      name: "Deft",
      description: "Grants 60% bonus attack speed.",
    },
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
        {
          threshold: 3,
          description: "Gain 100% more permanent stacks from abilities",
        },
      ],
    },
  ],
  enemyTeam: [
    {
      champion: "Zed",
      items: [
        { name: "Youmuu's Ghostblade", description: "" },
        { name: "Serrated Dirk", description: "" },
      ],
    },
    {
      champion: "Draven",
      items: [
        { name: "Blade of the Ruined King", description: "" },
        { name: "Berserker's Greaves", description: "" },
      ],
    },
    {
      champion: "Riven",
      items: [{ name: "Eclipse", description: "" }],
    },
    {
      champion: "Jayce",
      items: [{ name: "Manamune", description: "" }],
    },
    {
      champion: "Pantheon",
      items: [{ name: "Eclipse", description: "" }],
    },
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
};

const scenario2Query: CoachingQuery = {
  question: "What should I build next?",
  history: [
    {
      question: "Goliath, Deft, or Escape Plan?",
      answer:
        "Take Deft — 60% bonus AS is massive on Bel'Veth since your entire kit scales with attack speed. Goliath's size increase makes you easier to hit.",
    },
    {
      question:
        "I chose Quest: Icathia's Fall, Deft, and Light 'em Up! which should I keep?",
      answer:
        "Keep Quest: Icathia's Fall — the Void Immolation reward (1000 HP, 100 Armor, 80 MR) is enormous, and your team has no tank. Re-roll the other two.",
    },
  ],
};

// =============================================================================
// Scenario 3: Late game, full build — different champion (Ahri, ranged mage)
// Exercises: different stat profile, enemy mixed damage, set bonus active
// =============================================================================

const scenario3Context: CoachingContext = {
  champion: {
    name: "Ahri",
    level: 15,
    abilities:
      "Passive: Essence Theft - Gains a charge on ability hit. At 3 charges, next ability heals.\n" +
      "Orb of Deception - Throws and pulls back an orb dealing magic then true damage.\n" +
      "Fox-Fire - Releases 3 fox-fires that target nearby enemies.\n" +
      "Charm - Blows a kiss that damages and charms the first enemy hit.\n" +
      "Spirit Rush - Dashes forward and fires essence bolts. Can recast up to 2 more times.",
    statProfile:
      "Ranged (550) | Mage, Assassin | HP: 590 (+104/lvl) | AD: 53 (+0/lvl) | AS: 0.668 (+2.2%/lvl) | Armor: 21 (+4.2/lvl) | MR: 30 (+1.3/lvl) | Mana",
  },
  currentItems: [
    {
      name: "Luden's Echo",
      description:
        "100 AP, 10 Magic Pen, 20 Ability Haste. Passive: Damaging abilities deal bonus magic damage to target and nearby enemies.",
    },
    {
      name: "Rabadon's Deathcap",
      description:
        "140 AP. Passive: Increases your total Ability Power by 35%.",
    },
    {
      name: "Sorcerer's Shoes",
      description: "18 Magic Penetration, 45 Move Speed.",
    },
    {
      name: "Void Staff",
      description: "70 AP, 40% Magic Penetration.",
    },
    {
      name: "Shadowflame",
      description:
        "100 AP. Passive: Damage to champions benefits from bonus magic penetration.",
    },
  ],
  currentAugments: [
    {
      name: "Overflow",
      description:
        "Your mana regeneration is increased by 200%. Gain ability power equal to 3% of your maximum mana.",
      sets: ["Archmage"],
    },
    {
      name: "Mind to Matter",
      description: "Gain 1 ability power for each 25 maximum mana you have.",
      sets: ["Archmage"],
    },
    {
      name: "Glass Cannon",
      description:
        "Gain a health threshold equal to 30% of your maximum health. You die when your health reaches this threshold, but all your damage is increased by 40%.",
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
    {
      champion: "Yasuo",
      items: [
        { name: "Infinity Edge", description: "" },
        { name: "Berserker's Greaves", description: "" },
        { name: "Phantom Dancer", description: "" },
      ],
    },
    {
      champion: "Darius",
      items: [
        { name: "Stridebreaker", description: "" },
        { name: "Dead Man's Plate", description: "" },
      ],
    },
    {
      champion: "Brand",
      items: [
        { name: "Liandry's Torment", description: "" },
        { name: "Rylai's Crystal Scepter", description: "" },
      ],
    },
    {
      champion: "Zyra",
      items: [
        { name: "Luden's Echo", description: "" },
        { name: "Morellonomicon", description: "" },
      ],
    },
    {
      champion: "Miss Fortune",
      items: [
        { name: "The Collector", description: "" },
        { name: "Youmuu's Ghostblade", description: "" },
      ],
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
};

const scenario3Query: CoachingQuery = {
  question: "Juiced, Blunt Force, or Phenomenal Evil?",
  augmentOptions: [
    {
      name: "Juiced",
      description:
        "Abilities that immobilize or ground an enemy champion restore 10% of your maximum mana and grant 30 ability power for 8 seconds.",
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
        "Gain 2 ability power permanently each time you hit an enemy champion with an ability, stacking infinitely.",
      tier: "Gold",
      sets: ["Stackosaurus Rex"],
    },
  ],
};

// =============================================================================
// Runner
// =============================================================================

interface Scenario {
  name: string;
  description: string;
  context: CoachingContext;
  query: CoachingQuery;
}

const scenarios: Scenario[] = [
  {
    name: "Scenario 1: Early game augment selection",
    description:
      "Bel'Veth Lv1, game start, first augment choice. Heavily AP enemy team. Team has all roles covered. Goliath offered (tank pivot potential).",
    context: scenario1Context,
    query: scenario1Query,
  },
  {
    name: "Scenario 2: Mid game with quest augment — build advice",
    description:
      "Bel'Veth Lv9, 8:30 in. Has Quest: Icathia's Fall (needs Hollow Radiance + Sunfire Aegis). All-AD enemy team. Team has no tank. Asking what to build.",
    context: scenario2Context,
    query: scenario2Query,
  },
  {
    name: "Scenario 3: Late game augment selection — Ahri",
    description:
      "Ahri Lv15, 22 min in. Full AP build + Glass Cannon. Has 2/2 Archmage set bonus active. Mixed enemy damage. Offered Juiced (3rd Archmage) vs Phenomenal Evil.",
    context: scenario3Context,
    query: scenario3Query,
  },
];

async function main() {
  console.log("=== COACHING PROMPT PREVIEW ===\n");
  console.log(
    `Showing ${scenarios.length} scenarios with all coaching quality improvements applied.\n`
  );

  for (const scenario of scenarios) {
    const systemPrompt = buildSystemPrompt({
      gameMode: scenario.context.gameMode,
      lcuGameMode: scenario.context.lcuGameMode,
    });
    const userPrompt = buildUserPrompt(scenario.context, scenario.query);

    const systemTokens = Math.ceil(systemPrompt.length / 4);
    const userTokens = Math.ceil(userPrompt.length / 4);

    console.log(`${"=".repeat(80)}`);
    console.log(scenario.name);
    console.log(scenario.description);
    console.log(
      `Estimated tokens: ~${systemTokens} system + ~${userTokens} user = ~${systemTokens + userTokens} total`
    );
    console.log(`${"=".repeat(80)}`);

    console.log("\n--- SYSTEM PROMPT ---\n");
    console.log(systemPrompt);

    console.log("\n--- USER PROMPT ---\n");
    console.log(userPrompt);

    if (shouldRun) {
      const apiKey = process.env.VITE_OPENAI_API_KEY;
      if (!apiKey) {
        console.error(
          "\nVITE_OPENAI_API_KEY not found in .env — skipping model call"
        );
        continue;
      }

      const { generateText, Output, jsonSchema } = await import("ai");
      const { createOpenAI } = await import("@ai-sdk/openai");
      const model = createOpenAI({ apiKey })("gpt-5.4-mini");

      const responseSchema = jsonSchema<{
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
              properties: {
                name: { type: "string" },
                reasoning: { type: "string" },
              },
              required: ["name", "reasoning"],
              additionalProperties: false,
            },
          },
        },
        required: ["answer", "recommendations"],
        additionalProperties: false,
      });

      console.log("\n--- MODEL RESPONSE ---\n");
      const startMs = Date.now();
      const result = await generateText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        output: Output.object({ schema: responseSchema }),
        maxOutputTokens: 512,
      });
      const elapsedMs = Date.now() - startMs;

      console.log(
        `(${elapsedMs}ms, ${result.usage.inputTokens}in/${result.usage.outputTokens}out)`
      );
      console.log(`Answer: ${result.output.answer}`);
      for (const [i, r] of result.output.recommendations.entries()) {
        console.log(`  #${i + 1} ${r.name}: ${r.reasoning}`);
      }
    }

    console.log("\n");
  }
}

main().catch(console.error);

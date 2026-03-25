/**
 * Test prompt quality by comparing the actual prompt from a real game
 * against an enriched version. Runs each 3x to check consistency.
 *
 * Usage:
 *   pnpm exec tsx scripts/test-prompt-quality.ts
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { generateText, Output, jsonSchema } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const apiKey = process.env.VITE_OPENAI_API_KEY;
if (!apiKey) {
  console.error("VITE_OPENAI_API_KEY not found in .env");
  process.exit(1);
}

const model = createOpenAI({ apiKey })("gpt-5.4-mini");

const responseSchema = jsonSchema<{
  answer: string;
  recommendations: Array<{ name: string; reasoning: string }>;
}>({
  type: "object",
  properties: {
    answer: { type: "string", description: "Direct answer" },
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

// =============================================================================
// VARIANT A: Exact replica of the real prompt from the 2026-03-24 game log
// =============================================================================

const SYSTEM_A = `You are a League of Legends coaching AI. The player is mid-game — they need answers FAST.

Consider the full game context when reasoning:
- Champion abilities and playstyle
- Current items and build path
- Existing augments and synergies (in augment modes)
- Enemy team composition and threats
- Ally team composition and synergies
- Game mode and its specific dynamics
- Game time and power spikes

RESPONSE LENGTH RULES (strict):
- 1-2 sentences for simple questions (what to buy, which augment).
- 3-4 bullet points max for tactical questions (when to roam, how to play a matchup).
- Never write paragraphs. Never explain what the player already knows.
- Be blunt. Give THE answer, not a menu of options with hedging.
- Only list alternatives if the player specifically asks for options.

ARAM MAYHEM AUGMENT RULES (this is ARAM Mayhem mode, not regular ARAM):
- In Mayhem, players are offered 3 augment choices at levels 1, 7, 11, and 15.
- Augments are NOT items. They are permanent passive bonuses chosen from a curated set.
- Augment names can overlap with item names. Always check the Augment Options section below for the actual augment descriptions before assuming the player is talking about an item.
- When the player lists 3 options separated by commas or 'or', they are asking you to choose between augment offers.
- RE-ROLL RULES (strict two-phase process):
  PHASE 1: Player presents 3 augments. You respond: 'Keep [best]. Re-roll the other two.'
  PHASE 2: Player reports the re-roll results (2 new augments + the 1 kept from Phase 1).
    - The KEPT augment from Phase 1 CANNOT be re-rolled again — it is locked in.
    - You can ONLY choose between the 3 options as they are now.
    - Pick the best of the 3 and tell the player to take it.
    - Do NOT say 're-roll' in Phase 2 — there are no more re-rolls.
  Example Phase 1: "Keep Demon's Dance, re-roll the other two."
  Example Phase 2: "Take Demon's Dance — it's still the best option."
- When recommending an augment, consider: champion synergy, current build path, existing augments, and enemy team.
- CRITICAL: If an augment upgrades a specific item (like 'Upgrade Collector'), only recommend it if the player already owns that item OR is planning to build it. If they don't have the item and aren't building it, the augment is wasted.
- If an Augment Options section with descriptions appears below, use those descriptions — they are the exact in-game effects.`;

const PROMPT_A = `## Game Mode: KIWI

## Game Time: 4:05

## Your Champion: Bel'Veth (Level 7)

### Abilities
Passive: Death in Lavender  - Bel'Veth gains permanent attack speed stacks after taking down large minions and monsters and champions. She also gains temporary bonus attack speed after using an ability.
Void Surge - Bel'Veth dashes in a chosen direction and damages all enemies she passes through.
Above and Below - Bel'Veth slams her tail to the ground, damaging, knocking up, and slowing her enemies.
Royal Maelstrom - Bel'Veth roots herself in place, channeling a storm of slashes around her that targets the lowest-health enemy and grants her lifesteal and damage reduction.
Endless Banquet - Bel'Veth consumes Void coral remnants, transforming into her true form and increasing her max health, attack range, attack speed, and out-of-combat move speed. Consuming the Void coral remnants of a Void epic monster will grant her a longer ultimate duration, as well as the power to summon Void remora.

### Balance Overrides
Damage dealt: +5%, Damage taken: -5%, Tenacity: +20%

### Current Items
- Hearthbound Axe: 20 Attack Damage20% Attack Speed
- Boots: 25 Move Speed
- Recurve Bow: 15% Attack SpeedStingAttacks deal 15 bonus physical damage On-Hit.
- Long Sword: 10 Attack Damage
- Poro-Snax

### Ally Team
- Briar
- Nami
- Mordekaiser
- Jinx

### Enemy Team
- Fizz: Luden's Echo, Refillable Potion, Boots, Poro-Snax
- Lissandra: Luden's Echo, Refillable Potion, Amplifying Tome, Poro-Snax
- Kindred: The Collector, Recurve Bow, Dagger, Poro-Snax
- Tristana: Yun Tal Wildarrows, Health Potion, Boots, Dagger, Poro-Snax
- Zaahen: Caulfield's Warhammer, Boots, Tunneler, Ruby Crystal, Poro-Snax

## Augment Options Being Offered

The player is choosing between these augments (NOT items):

- **Protein Shake** [Prismatic]: Gain 25%|heal and shield power (+ 35% per 100 bonus armor) (+ 35% per 100 bonus magic resistance) heal and shield power.

- **Glass Cannon** [Prismatic]: You gain a health threshold equal to Damage calculated before modifiers.

## Question
Protein Shake, Glass Cannon, or Urf's Champion.`;

// =============================================================================
// VARIANT B: Enriched prompt — same game state but with structured knowledge
// =============================================================================

const SYSTEM_B = `You are a League of Legends coaching AI. The player is mid-game — they need answers FAST.

Consider the full game context when reasoning:
- Champion role and playstyle (provided below)
- Current items and build direction
- Existing augments and synergies
- Enemy team threats (provided below)
- Ally team strengths
- Game phase and power spikes

RESPONSE LENGTH RULES (strict):
- 1-2 sentences for simple questions (what to buy, which augment).
- 3-4 bullet points max for tactical questions.
- Be blunt. Give THE answer, not hedging.

ARAM MAYHEM AUGMENT RULES:
- Players get 3 augment choices at levels 1, 7, 11, 15.
- Augments are permanent passive bonuses, NOT items.
- RE-ROLL RULES: Each card has its own independent re-roll (one use each).
  ROUND 1: Player shows 3 augments. Pick the best, tell them to re-roll the other two.
  ROUND 2: Player reports 2 new augments. You now have 3 cards: the kept one + 2 new ones.
    - If a new one beats the kept one: tell them to re-roll the kept one (its re-roll is still unused).
    - If the kept one is still best: tell them to take it. No re-rolls left on the other two.
  ROUND 3 (only if Round 2 re-rolled the kept one): Player reports 1 new augment.
    - Now pick the best of the 3 final cards. No more re-rolls exist.
  KEY: The player may only report the NEW cards. Remember which one was kept from prior rounds.
- Use augment descriptions AND role tags to evaluate synergy with the champion's playstyle.
- If an augment upgrades a specific item, only recommend it if the player has or is building that item.`;

const PROMPT_B = `## Game Mode: KIWI
## Game Phase: Early-mid (4:05). First item components, no completed mythic yet.

## Your Champion: Bel'Veth (Level 7)
**Role:** Melee DPS carry (Fighter). Scales with attack speed and on-hit effects. Wants extended fights to stack passive and sustain via Royal Maelstrom lifesteal. Damage comes from auto-attacks, not ability spam.

### Abilities
Passive: Death in Lavender - Permanent attack speed stacks from takedowns. Temporary bonus AS after ability use.
Void Surge - Dash through enemies, dealing damage.
Above and Below - Ground slam, knockup + slow.
Royal Maelstrom - Channel: slashes lowest-HP enemy, grants lifesteal and damage reduction.
Endless Banquet - Transform: increased max HP, attack range, attack speed, move speed.

### Balance Overrides
Damage dealt: +5%, Damage taken: -5%, Tenacity: +20%

### Current Items
- Hearthbound Axe (AD + AS)
- Boots (MS)
- Recurve Bow (AS + on-hit)
- Long Sword (AD)
Build direction: on-hit / attack speed DPS

### Ally Team
- Briar (melee bruiser/diver)
- Nami (enchanter support)
- Mordekaiser (AP bruiser/frontline)
- Jinx (ranged ADC)

### Team Analysis
You have two frontline threats (you + Mordekaiser) and two backline carries (Jinx + Briar). Nami provides healing/CC. Your role: dive enemy backline and sustain through fights with Royal Maelstrom.

### Enemy Team
- Fizz (AP assassin, Luden's Echo — burst threat, can one-shot you)
- Lissandra (AP mage/CC, Luden's Echo — lockdown + burst)
- Kindred (marksman, The Collector — DPS + execute)
- Tristana (marksman, Yun Tal Wildarrows — burst ADC)
- Zaahen (fighter, Caulfield's Warhammer — melee DPS)

### Enemy Threat Assessment
Heavy burst from Fizz + Lissandra (both have Luden's). Two ranged ADCs (Kindred + Tristana) will kite you. You MUST survive the initial burst to get value from your sustained DPS.

## Augment Options Being Offered

The player is choosing between these augments (NOT items):

- **Protein Shake** [Prismatic, sustain/scaling]: Gain 25% heal and shield power, scaling with bonus armor and magic resistance. Best on champions building tank stats.

- **Glass Cannon** [Prismatic, high-risk DPS]: Massive damage increase at the cost of survivability. Best on champions who can kill before getting hit.

- **Quest: Urf's Champion** [Prismatic, ability spam/CDR]: Complete a quest for massive cooldown reduction and no mana costs. Best on champions whose power comes from ability rotations.

## Question
Protein Shake, Glass Cannon, or Urf's Champion.`;

// =============================================================================
// Runner
// =============================================================================

async function runTest(
  label: string,
  system: string,
  prompt: string,
  runs: number
) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(label);
  console.log("=".repeat(70));

  for (let i = 0; i < runs; i++) {
    const startMs = Date.now();
    const result = await generateText({
      model,
      system,
      prompt,
      output: Output.object({ schema: responseSchema }),
      maxOutputTokens: 512,
    });
    const elapsedMs = Date.now() - startMs;

    console.log(
      `\n--- Run ${i + 1} (${elapsedMs}ms, ${result.usage.inputTokens}in/${result.usage.outputTokens}out) ---`
    );
    console.log(`Answer: ${result.output.answer}`);
    for (const r of result.output.recommendations) {
      console.log(
        `  #${result.output.recommendations.indexOf(r) + 1} ${r.name}: ${r.reasoning}`
      );
    }
  }
}

async function main() {
  console.log("=== PROMPT QUALITY TEST ===");
  console.log("");
  console.log("Scenario: Bel'Veth Lv7, early-mid ARAM Mayhem");
  console.log("Items: Hearthbound Axe, Boots, Recurve Bow, Long Sword");
  console.log("Allies: Briar, Nami, Mordekaiser, Jinx");
  console.log(
    "Enemies: Fizz(burst), Lissandra(burst/CC), Kindred(DPS), Tristana(burst ADC), Zaahen(fighter)"
  );
  console.log("Augment choices: Protein Shake / Glass Cannon / Urf's Champion");
  console.log("");
  console.log(
    "VARIANT A = exact replica of the prompt from the real game (2026-03-24 log)"
  );
  console.log(
    "VARIANT B = enriched with champion role, game phase, team analysis, augment role tags"
  );

  await runTest(
    "VARIANT A: Exact real-game prompt (current system)",
    SYSTEM_A,
    PROMPT_A,
    3
  );
  await runTest(
    "VARIANT B: Enriched prompt (role tags + champion role + phase + team analysis)",
    SYSTEM_B,
    PROMPT_B,
    3
  );
}

main().catch(console.error);

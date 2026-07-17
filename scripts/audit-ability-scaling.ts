/**
 * Audit wiki-sourced ability scaling across the full champion roster.
 *
 * Runs the same fetch + parse path ingest uses, then reports how much scaling
 * actually survives the quarantine gate and, crucially, WHY the rest does not.
 * The parser deliberately drops anything it cannot resolve confidently (wrong
 * damage numbers in a coaching prompt are worse than absent ones), so the
 * quarantine breakdown is the signal for which wiki template shape is worth
 * teaching it next.
 *
 * Run: pnpm audit-ability-scaling
 */
import {
  fetchLatestVersion,
  fetchChampions,
} from "../src/lib/data-ingest/sources/data-dragon";
import { fetchChampionAbilityScaling } from "../src/lib/data-ingest/sources/wiki-champion-abilities";

const SPELL_SLOTS = ["Q", "W", "E", "R"] as const;

function percent(part: number, whole: number): string {
  if (whole === 0) return "0.0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

async function main() {
  const version = await fetchLatestVersion();
  console.log(`Data Dragon version: ${version}`);

  const champions = await fetchChampions(version);
  const names = [...champions.values()].map((c) => c.name);
  console.log(`Auditing ability scaling for ${names.length} champions...\n`);

  const { byChampion, diagnostics } = await fetchChampionAbilityScaling(names);

  console.log("=== Coverage ===");
  console.log(`  Abilities requested:     ${diagnostics.abilitiesRequested}`);
  console.log(
    `  Abilities with scaling:  ${diagnostics.abilitiesWithScaling} ` +
      `(${percent(diagnostics.abilitiesWithScaling, diagnostics.abilitiesRequested)})`
  );
  console.log(
    `  Champions covered:       ${byChampion.size} / ${names.length}`
  );

  const totalStats = diagnostics.statsAccepted + diagnostics.statsQuarantined;
  console.log("\n=== Stats ===");
  console.log(
    `  Accepted:    ${diagnostics.statsAccepted} (${percent(diagnostics.statsAccepted, totalStats)})`
  );
  console.log(
    `  Quarantined: ${diagnostics.statsQuarantined} (${percent(diagnostics.statsQuarantined, totalStats)})`
  );

  console.log("\n=== Quarantine breakdown (worst first) ===");
  const reasons = [...diagnostics.quarantineReasons.entries()].sort(
    (a, b) => b[1] - a[1]
  );
  if (reasons.length === 0) {
    console.log("  Nothing quarantined.");
  }
  for (const [reason, count] of reasons) {
    console.log(`  ${String(count).padStart(4)}  ${reason}`);
    for (const example of diagnostics.quarantineExamples.get(reason) ?? []) {
      console.log(`        e.g. ${example}`);
    }
  }

  const uncovered = names.filter((n) => !byChampion.has(n.toLowerCase()));
  console.log(
    `\n=== Champions with no scaling at all (${uncovered.length}) ===`
  );
  console.log(uncovered.length === 0 ? "  None." : `  ${uncovered.join(", ")}`);

  console.log("\n=== Abilities with no scaling, by slot ===");
  for (const slot of SPELL_SLOTS) {
    const missing = names.filter(
      (n) => !byChampion.get(n.toLowerCase())?.slots[slot]
    );
    console.log(`  ${slot}: ${missing.length} / ${names.length} missing`);
  }

  console.log("\n=== Sample renderings ===");
  for (const name of ["Ahri", "Nasus", "Yasuo", "Aatrox"]) {
    const entry = byChampion.get(name.toLowerCase());
    if (!entry) {
      console.log(`  ${name}: no scaling`);
      continue;
    }
    console.log(`  ${name}:`);
    for (const slot of SPELL_SLOTS) {
      const stats = entry.slots[slot];
      if (!stats) continue;
      const rendered = stats.map((s) => `${s.label}: ${s.value}`).join(" | ");
      console.log(`    ${slot} [${rendered}]`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

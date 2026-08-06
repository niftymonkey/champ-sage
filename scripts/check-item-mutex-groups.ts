/**
 * Verify item mutex-group ingestion against the LIVE wiki ItemData module.
 *
 * Mutex groups (League's "Limited to 1 X item" purchase restrictions) are
 * only machine-readable from the wiki's Module:ItemData/data `itemlimit`
 * fields; DDragon names the groups but carries no membership. A silent wiki
 * format drift would disable both the prompt's Purchase-restrictions section
 * and the post-hoc build-path enforcement, so this script fetches the live
 * module and checks the canary group (the Last Whisper "Fatality" family,
 * the exact pair that shipped illegal builds: Lord Dominik's Regards +
 * Mortal Reminder) still resolves.
 *
 * Run: pnpm check-item-mutex-groups  (exits non-zero on any failure)
 */
import { fetchItemMutexGroups } from "../src/lib/data-ingest/sources/wiki-item-groups";

// DDragon-exact names that must be present in the Fatality group for the
// Last Whisper fix to hold in production.
const FATALITY_CANARIES = ["lord dominik's regards", "mortal reminder"];

async function main(): Promise<void> {
  const groups = await fetchItemMutexGroups();

  const membersByGroup = new Map<string, string[]>();
  for (const [name, itemGroups] of groups) {
    for (const group of itemGroups) {
      const members = membersByGroup.get(group) ?? [];
      members.push(name);
      membersByGroup.set(group, members);
    }
  }

  console.log(`Items with mutex groups: ${groups.size}`);
  console.log(`Distinct groups: ${membersByGroup.size}\n`);
  for (const [group, members] of [...membersByGroup.entries()].sort(
    ([a], [b]) => a.localeCompare(b)
  )) {
    console.log(`${group} (${members.length}): ${members.sort().join(", ")}`);
  }

  const failures: string[] = [];
  if (groups.size < 20) {
    failures.push(
      `Suspiciously few items carry groups (${groups.size}); the itemlimit field may have moved`
    );
  }
  for (const canary of FATALITY_CANARIES) {
    const itemGroups = groups.get(canary) ?? [];
    if (!itemGroups.includes("Fatality")) {
      failures.push(`Canary "${canary}" is not in the Fatality group`);
    }
  }

  if (failures.length > 0) {
    console.error(`\nFAIL:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log("\nOK: mutex-group ingestion is healthy");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

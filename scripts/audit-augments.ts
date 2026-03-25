/**
 * Audit all augment descriptions for markup artifacts, missing data, or garbled text.
 *
 * Checks for:
 * - Residual wiki markup ({{ }}, [[ ]], ''', HTML tags)
 * - Suspiciously short descriptions (< 20 chars)
 * - Quest augments without reward stats
 *
 * Run: pnpm audit-augments
 */
import { fetchAndCache } from "../src/lib/data-ingest/index";

const ARTIFACT_PATTERNS = [
  { pattern: /\{\{/, label: "residual {{ template" },
  { pattern: /\}\}/, label: "residual }} template" },
  { pattern: /\[\[/, label: "residual [[ link" },
  { pattern: /\]\]/, label: "residual ]] link" },
  { pattern: /'''/, label: "residual ''' bold" },
  { pattern: /<[a-z]+[^>]*>/i, label: "residual HTML tag" },
  { pattern: /\|/, label: "residual pipe character" },
];

async function main() {
  console.log("Loading game data (same pipeline as the app)...\n");
  const data = await fetchAndCache();

  const augments = [...data.augments.values()].filter(
    (a) => a.mode === "mayhem"
  );
  console.log(`Auditing ${augments.length} Mayhem augments...\n`);

  let issueCount = 0;

  for (const aug of augments) {
    const issues: string[] = [];

    // Check for markup artifacts
    for (const { pattern, label } of ARTIFACT_PATTERNS) {
      if (pattern.test(aug.description)) {
        const match = aug.description.match(pattern);
        const ctx = aug.description.substring(
          Math.max(0, match!.index! - 20),
          match!.index! + 40
        );
        issues.push(`${label}: ...${ctx}...`);
      }
    }

    // Check for suspiciously short descriptions
    if (aug.description.length < 20) {
      issues.push(`very short description (${aug.description.length} chars)`);
    }

    // Check quest augments for reward stats
    if (aug.name.startsWith("Quest:") && !aug.description.includes("[")) {
      issues.push("quest augment missing reward stat block");
    }

    if (issues.length > 0) {
      issueCount++;
      console.log(`--- ${aug.name} (${aug.tier}) ---`);
      for (const issue of issues) {
        console.log(`  ! ${issue}`);
      }
      console.log(`  desc: ${aug.description.substring(0, 200)}`);
      console.log();
    }
  }

  if (issueCount === 0) {
    console.log("All augments clean — no artifacts found.");
  } else {
    console.log(
      `\n${issueCount} augment(s) with issues out of ${augments.length}.`
    );
  }
}

main().catch(console.error);

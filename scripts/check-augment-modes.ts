async function main() {
  const res = await fetch(
    "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json"
  );
  const data: Array<{ augmentSmallIconPath: string; nameTRA: string }> =
    await res.json();

  const modes: Record<string, number> = {
    mayhem: 0,
    arena: 0,
    swarm: 0,
    unknown: 0,
  };
  for (const a of data) {
    const p = a.augmentSmallIconPath.toLowerCase();
    if (p.includes("kiwi/")) modes.mayhem++;
    else if (p.includes("swarm/")) modes.swarm++;
    else if (p.includes("cherry/")) modes.arena++;
    else modes.unknown++;
  }
  console.log("Mode counts:", modes);

  console.log("\nSample Mayhem paths:");
  for (const a of data
    .filter((x) => x.augmentSmallIconPath.toLowerCase().includes("kiwi/"))
    .slice(0, 5)) {
    console.log(`  ${a.nameTRA}: ${a.augmentSmallIconPath}`);
  }

  console.log("\nSample Arena paths:");
  for (const a of data
    .filter((x) => {
      const p = x.augmentSmallIconPath.toLowerCase();
      return p.includes("cherry/") && !p.includes("kiwi/");
    })
    .slice(0, 5)) {
    console.log(`  ${a.nameTRA}: ${a.augmentSmallIconPath}`);
  }

  console.log("\nSample Unknown paths:");
  for (const a of data
    .filter((x) => {
      const p = x.augmentSmallIconPath.toLowerCase();
      return (
        !p.includes("cherry/") && !p.includes("kiwi/") && !p.includes("swarm/")
      );
    })
    .slice(0, 5)) {
    console.log(`  ${a.nameTRA}: ${a.augmentSmallIconPath}`);
  }
}

main().catch(console.error);

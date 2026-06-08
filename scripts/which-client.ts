/**
 * Prints which League of Legends client(s) are installed and running, and the
 * region/patchline each running client reports. Use it to confirm whether you
 * are actually on live or PBE instead of trusting the launcher UI.
 *
 * It discovers installs from RiotClientInstalls.json, reads each LCU lockfile,
 * and queries the LCU `/riotclient/region-locale` endpoint. A region of "PBE"
 * means PBE; anything else (NA, EUW, ...) is live. WSL2 reaches the Windows LCU
 * over 127.0.0.1. Detection only works while a client is actually running.
 *
 * Run: pnpm which-client
 */
import { readFileSync, existsSync } from "node:fs";
import https from "node:https";
import { patchlineFromRegion } from "../src/lib/data-ingest/patchline";

const INSTALLS_JSON =
  process.env.RIOT_INSTALLS_JSON ??
  "/mnt/c/ProgramData/Riot Games/RiotClientInstalls.json";

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

function winPathToWsl(p: string): string {
  const drive = p.match(/^([A-Za-z]):[\\/]/);
  if (!drive) return p;
  const rest = p.slice(3).replace(/\\/g, "/");
  return `/mnt/${drive[1].toLowerCase()}/${rest}`;
}

interface Lockfile {
  port: string;
  password: string;
}

function parseLockfile(content: string): Lockfile | null {
  const parts = content.trim().split(":");
  if (parts.length < 5) return null;
  return { port: parts[2], password: parts[3] };
}

function fetchRegionLocale(
  lock: Lockfile
): Promise<{ region: string; locale: string }> {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`riot:${lock.password}`).toString("base64");
    const req = https.request(
      {
        host: "127.0.0.1",
        port: Number(lock.port),
        path: "/riotclient/region-locale",
        method: "GET",
        headers: { Authorization: `Basic ${auth}` },
        agent: insecureAgent,
        timeout: 4000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`unexpected response: ${body.slice(0, 120)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
}

async function main() {
  if (!existsSync(INSTALLS_JSON)) {
    console.log(`RiotClientInstalls.json not found at ${INSTALLS_JSON}`);
    return;
  }

  const installs = JSON.parse(readFileSync(INSTALLS_JSON, "utf8")) as {
    associated_client?: Record<string, string>;
  };
  const dirs = Object.keys(installs.associated_client ?? {}).filter((d) =>
    d.toLowerCase().includes("league of legends")
  );

  if (dirs.length === 0) {
    console.log("No League of Legends installs registered.");
    return;
  }

  console.log("League of Legends installs:");
  let anyRunning = false;
  for (const dir of dirs) {
    const lockPath = winPathToWsl(dir).replace(/\/?$/, "/") + "lockfile";
    if (!existsSync(lockPath)) {
      console.log(`  ${dir}\n    installed, not running (no lockfile)`);
      continue;
    }
    const lock = parseLockfile(readFileSync(lockPath, "utf8"));
    if (!lock) {
      console.log(`  ${dir}\n    lockfile present but unreadable`);
      continue;
    }
    anyRunning = true;
    try {
      const { region, locale } = await fetchRegionLocale(lock);
      console.log(
        `  ${dir}\n    RUNNING -> patchline=${patchlineFromRegion(
          region
        )} region=${region} locale=${locale} (port ${lock.port})`
      );
    } catch (err) {
      console.log(
        `  ${dir}\n    RUNNING but region query failed: ${
          (err as Error).message
        }`
      );
    }
  }

  if (!anyRunning) {
    console.log(
      "\nNo client is currently running. Launch League (live or PBE) and re-run."
    );
  }
  if (!dirs.some((d) => d.toLowerCase().includes("pbe"))) {
    console.log(
      "\nNote: no PBE install is registered. PBE is a separate download that appears here only after you sign into the launcher with a PBE account and let it install."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

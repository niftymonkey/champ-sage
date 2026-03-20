import https from "node:https";

const API_URL = "https://localhost:2999/liveclientdata/allgamedata";

interface Item {
  itemID: number;
  displayName: string;
}

interface Player {
  championName: string;
  team: string;
  level: number;
  riotIdGameName: string;
  scores: { kills: number; deaths: number; assists: number };
  items: Item[];
}

interface GameData {
  activePlayer: {
    riotIdGameName: string;
    level: number;
    currentGold: number;
    fullRunes: {
      generalRunes: { displayName: string }[];
      keystone: { displayName: string };
    };
  };
  allPlayers: Player[];
  gameData: { gameMode: string; gameTime: number };
}

function fetchGameData(): Promise<GameData> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      API_URL,
      { rejectUnauthorized: false, timeout: 5000 },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode === 404) {
            reject(
              Object.assign(new Error("Game is loading"), { code: "LOADING" })
            );
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`API returned ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as GameData);
          } catch {
            reject(
              Object.assign(new Error("Invalid JSON from Riot API"), {
                code: "EBADJSON",
              })
            );
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(
        Object.assign(new Error("Connection timed out"), { code: "ETIMEDOUT" })
      );
    });
    req.on("error", reject);
  });
}

async function main() {
  try {
    const data = await fetchGameData();
    const active = data.activePlayer;
    const activeName = active.riotIdGameName;
    const gameTime = data.gameData.gameTime;
    const minutes = Math.floor(gameTime / 60);
    const seconds = Math.floor(gameTime % 60);

    console.log(`\n=== Game State ===`);
    console.log(
      `Mode: ${data.gameData.gameMode} | Time: ${minutes}:${seconds.toString().padStart(2, "0")}`
    );
    console.log(
      `Your champion: Level ${active.level} | Gold: ${Math.floor(active.currentGold)}`
    );
    console.log(`Keystone: ${active.fullRunes.keystone.displayName}`);

    for (const team of ["ORDER", "CHAOS"]) {
      const players = data.allPlayers.filter((p) => p.team === team);
      if (players.length === 0) continue;

      console.log(`\n--- ${team} ---`);
      for (const p of players) {
        const isYou = p.riotIdGameName === activeName;
        const tag = isYou ? " << YOU" : "";
        const kda = `${p.scores.kills}/${p.scores.deaths}/${p.scores.assists}`;
        const items = p.items.map((i) => i.displayName).join(", ") || "none";
        console.log(
          `  ${p.championName} (Lv${p.level}) [${kda}] — ${items}${tag}`
        );
      }
    }

    console.log("");
  } catch (err) {
    const code =
      err instanceof Error && "code" in err
        ? (err as NodeJS.ErrnoException).code
        : null;
    if (code === "LOADING") {
      console.error(
        "Game is still loading. The API is up but data isn't available yet."
      );
      console.error("Wait until you're past the loading screen and try again.");
    } else if (code === "ECONNREFUSED" || code === "ETIMEDOUT") {
      console.error("Could not connect to the Riot API at localhost:2999.");
      console.error("Make sure a game is running (Practice Tool works).");
      if (process.platform === "linux") {
        console.error(
          "On WSL2, make sure mirrored networking is enabled. See CONTRIBUTING.md."
        );
      }
    } else {
      console.error("Unexpected error:", err);
    }
    process.exit(1);
  }
}

main();

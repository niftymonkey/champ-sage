/**
 * Write-side LCU operations.
 *
 * The read-side LCU proxy (`fetch_lcu` in main.ts) only ever issues GETs. This
 * module owns the one mutating call the app makes: setting the player's own
 * summoner spells during champ select via
 * `PATCH /lol-champ-select/v1/session/my-selection`.
 *
 * The HTTP transport is injected (`LcuRequester`) so the request shape and
 * response handling are unit-testable without a live client; main.ts wires the
 * real node:https requester.
 */

export interface LcuCredentials {
  port: number;
  token: string;
}

export interface LcuWriteResponse {
  statusCode: number;
  body: string;
}

export type LcuRequester = (req: {
  port: number;
  token: string;
  method: string;
  path: string;
  body: string;
}) => Promise<LcuWriteResponse>;

/** LCU endpoint that owns the local player's champ-select selection. */
export const MY_SELECTION_ENDPOINT =
  "/lol-champ-select/v1/session/my-selection";

/**
 * Set the local player's two summoner spells in the active champ-select
 * session. Both IDs must be positive integers (the LCU rejects 0/garbage and a
 * bad write would clobber the player's picks). Throws `HTTP_<code>` when the
 * client responds outside the 2xx range.
 */
export async function setSummonerSpells(
  creds: LcuCredentials,
  spell1Id: number,
  spell2Id: number,
  request: LcuRequester
): Promise<void> {
  if (!isPositiveInt(spell1Id) || !isPositiveInt(spell2Id)) {
    throw new Error(`Invalid summoner-spell pair: ${spell1Id}, ${spell2Id}`);
  }

  const res = await request({
    port: creds.port,
    token: creds.token,
    method: "PATCH",
    path: MY_SELECTION_ENDPOINT,
    body: JSON.stringify({ spell1Id, spell2Id }),
  });

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`HTTP_${res.statusCode}`);
  }
}

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * Default `LcuRequester` backed by node:https. The LCU serves a self-signed
 * cert, so certificate verification is disabled (same as the read-side proxy).
 * Basic auth is built from the lockfile token here, at the transport boundary,
 * keeping `setSummonerSpells` free of auth concerns.
 */
export const httpsLcuRequester: LcuRequester = async ({
  port,
  token,
  method,
  path,
  body,
}) => {
  const https = await import("node:https");
  const agent = new https.Agent({ rejectUnauthorized: false });
  const auth = Buffer.from(`riot:${token}`).toString("base64");

  return new Promise<LcuWriteResponse>((resolve, reject) => {
    const req = https.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        agent,
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () =>
          resolve({ statusCode: res.statusCode ?? 0, body: data })
        );
      }
    );
    // Bound the request so a stalled LCU (connection accepted, no response)
    // cannot leave the Import action hung forever. On timeout, destroy the
    // request with an error, which fires the "error" handler below and rejects.
    // A healthy local PATCH returns in well under a second, so 5s is generous.
    req.setTimeout(5000, () => {
      req.destroy(new Error("TIMEOUT"));
    });
    req.on("error", (err: Error) =>
      reject(new Error(`CONNECTION_FAILED:${err.message}`))
    );
    req.write(body);
    req.end();
  });
};

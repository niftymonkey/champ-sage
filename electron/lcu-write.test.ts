import { describe, it, expect, vi } from "vitest";
import {
  setSummonerSpells,
  MY_SELECTION_ENDPOINT,
  type LcuRequester,
} from "./lcu-write";

function okRequester(): ReturnType<typeof vi.fn> & LcuRequester {
  return vi.fn(async () => ({ statusCode: 204, body: "" })) as ReturnType<
    typeof vi.fn
  > &
    LcuRequester;
}

describe("setSummonerSpells", () => {
  it("PATCHes my-selection with the spell pair and credentials", async () => {
    const request = okRequester();
    await setSummonerSpells({ port: 5000, token: "secret" }, 4, 32, request);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      port: 5000,
      token: "secret",
      method: "PATCH",
      path: MY_SELECTION_ENDPOINT,
      body: JSON.stringify({ spell1Id: 4, spell2Id: 32 }),
    });
  });

  it("throws HTTP_<code> when the client responds outside 2xx", async () => {
    const request: LcuRequester = vi.fn(async () => ({
      statusCode: 404,
      body: "no active delegate",
    }));

    await expect(
      setSummonerSpells({ port: 5000, token: "secret" }, 4, 32, request)
    ).rejects.toThrow("HTTP_404");
  });

  it("rejects an invalid spell ID without issuing a request", async () => {
    const request = okRequester();

    await expect(
      setSummonerSpells({ port: 5000, token: "secret" }, 0, 32, request)
    ).rejects.toThrow();

    expect(request).not.toHaveBeenCalled();
  });
});

import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useSummonerSpellImport } from "./useSummonerSpellImport";

describe("useSummonerSpellImport", () => {
  it("goes importing then done on a successful write", async () => {
    let resolve!: () => void;
    const apply = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    const { result } = renderHook(() => useSummonerSpellImport({ apply }));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.importSpells(4, 32);
    });
    expect(result.current.status).toBe("importing");

    await act(async () => {
      resolve();
      await pending;
    });
    expect(result.current.status).toBe("done");
    expect(apply).toHaveBeenCalledWith(4, 32);
  });

  it("goes to error when the write fails", async () => {
    const apply = vi.fn(async () => {
      throw new Error("LCU not connected");
    });
    const { result } = renderHook(() => useSummonerSpellImport({ apply }));

    await act(async () => {
      await result.current.importSpells(4, 32);
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
  });
});

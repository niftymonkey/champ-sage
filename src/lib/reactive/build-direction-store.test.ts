import { describe, it, expect, beforeEach } from "vitest";
import {
  playerBuildDirection$,
  setPlayerBuildDirection,
  clearPlayerBuildDirection,
} from "./build-direction-store";

beforeEach(() => {
  playerBuildDirection$.next(null);
});

describe("setPlayerBuildDirection", () => {
  it("writes the new direction onto the subject", () => {
    setPlayerBuildDirection("ad");
    expect(playerBuildDirection$.getValue()).toBe("ad");
  });

  it("overwrites a previously set direction", () => {
    setPlayerBuildDirection("ap");
    setPlayerBuildDirection("tank");
    expect(playerBuildDirection$.getValue()).toBe("tank");
  });

  it("emits each set so subscribers receive the value", () => {
    const seen: Array<string | null> = [];
    const sub = playerBuildDirection$.subscribe((v) => seen.push(v));
    setPlayerBuildDirection("supp");
    sub.unsubscribe();
    expect(seen[seen.length - 1]).toBe("supp");
  });
});

describe("clearPlayerBuildDirection", () => {
  it("returns the subject to null", () => {
    setPlayerBuildDirection("tank");
    clearPlayerBuildDirection();
    expect(playerBuildDirection$.getValue()).toBeNull();
  });

  it("is a no-op when already null", () => {
    clearPlayerBuildDirection();
    expect(playerBuildDirection$.getValue()).toBeNull();
  });
});

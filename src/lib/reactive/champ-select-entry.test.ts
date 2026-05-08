import { describe, it, expect } from "vitest";
import { isChampSelectEntry } from "./champ-select-entry";

describe("isChampSelectEntry", () => {
  it("fires when entering ChampSelect from Lobby", () => {
    expect(isChampSelectEntry("Lobby", "ChampSelect")).toBe(true);
  });

  it("fires when entering ChampSelect from ReadyCheck", () => {
    expect(isChampSelectEntry("ReadyCheck", "ChampSelect")).toBe(true);
  });

  it("fires when entering ChampSelect from Matchmaking", () => {
    expect(isChampSelectEntry("Matchmaking", "ChampSelect")).toBe(true);
  });

  it("fires when entering ChampSelect from null (initial)", () => {
    expect(isChampSelectEntry(null, "ChampSelect")).toBe(true);
  });

  it("does NOT fire when staying in ChampSelect", () => {
    expect(isChampSelectEntry("ChampSelect", "ChampSelect")).toBe(false);
  });

  it("does NOT fire when leaving ChampSelect for InProgress (game starting)", () => {
    expect(isChampSelectEntry("ChampSelect", "GameStart")).toBe(false);
  });

  it("does NOT fire on InProgress emissions", () => {
    expect(isChampSelectEntry("GameStart", "InProgress")).toBe(false);
  });

  it("does NOT fire on EndOfGame", () => {
    expect(isChampSelectEntry("InProgress", "EndOfGame")).toBe(false);
  });

  it("does NOT fire when phase stays None", () => {
    expect(isChampSelectEntry("None", "None")).toBe(false);
  });
});

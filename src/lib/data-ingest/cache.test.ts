import { describe, it, expect } from "vitest";
import { mapToObject, objectToMap } from "./cache";

describe("mapToObject", () => {
  it("converts a string-keyed Map to a plain object", () => {
    const map = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    expect(mapToObject(map)).toEqual({ a: 1, b: 2 });
  });

  it("converts a number-keyed Map to a plain object", () => {
    const map = new Map([
      [1001, { name: "Boots" }],
      [1002, { name: "Cloak" }],
    ]);
    expect(mapToObject(map)).toEqual({
      "1001": { name: "Boots" },
      "1002": { name: "Cloak" },
    });
  });

  it("handles an empty Map", () => {
    const map = new Map();
    expect(mapToObject(map)).toEqual({});
  });
});

describe("objectToMap", () => {
  it("converts a plain object to a string-keyed Map", () => {
    const obj = { a: 1, b: 2 };
    const map = objectToMap<string, number>(obj);
    expect(map.get("a")).toBe(1);
    expect(map.get("b")).toBe(2);
    expect(map.size).toBe(2);
  });

  it("converts a plain object to a number-keyed Map", () => {
    const obj = { "1001": { name: "Boots" }, "1002": { name: "Cloak" } };
    const map = objectToMap<number, { name: string }>(obj, "number");
    expect(map.get(1001)).toEqual({ name: "Boots" });
    expect(map.get(1002)).toEqual({ name: "Cloak" });
  });

  it("handles an empty object", () => {
    const map = objectToMap({});
    expect(map.size).toBe(0);
  });

  it("roundtrips with mapToObject", () => {
    const original = new Map([
      ["aatrox", { id: "Aatrox", name: "Aatrox" }],
      ["ahri", { id: "Ahri", name: "Ahri" }],
    ]);
    const obj = mapToObject(original);
    const restored = objectToMap<string, { id: string; name: string }>(obj);
    expect(restored).toEqual(original);
  });
});

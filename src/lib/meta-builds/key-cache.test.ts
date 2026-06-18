import { describe, it, expect } from "vitest";
import {
  keyFingerprint,
  shouldPurgePuuidCaches,
  isDecryptError,
} from "./key-cache";

describe("keyFingerprint", () => {
  it("is deterministic for the same key", () => {
    expect(keyFingerprint("RGAPI-abc")).toBe(keyFingerprint("RGAPI-abc"));
  });

  it("differs for different keys", () => {
    expect(keyFingerprint("RGAPI-abc")).not.toBe(keyFingerprint("RGAPI-xyz"));
  });

  it("is a fixed-length hash that does not leak the raw key", () => {
    const fp = keyFingerprint("RGAPI-secret-value");
    expect(fp).toHaveLength(16);
    expect(fp).not.toContain("secret");
  });
});

describe("shouldPurgePuuidCaches", () => {
  it("purges when no fingerprint was recorded", () => {
    expect(shouldPurgePuuidCaches(null, "abc123")).toBe(true);
  });

  it("purges when the key changed", () => {
    expect(shouldPurgePuuidCaches("old456", "new789")).toBe(true);
  });

  it("does not purge when the key is unchanged", () => {
    expect(shouldPurgePuuidCaches("same000", "same000")).toBe(false);
  });
});

describe("isDecryptError", () => {
  it("is true for a 400 with an Exception decrypting message", () => {
    expect(
      isDecryptError(400, "Bad Request - Exception decrypting zbedq86w")
    ).toBe(true);
  });

  it("is case-insensitive on the message", () => {
    expect(isDecryptError(400, "exception DECRYPTING foo")).toBe(true);
  });

  it("is false for a 400 that is not a decrypt error", () => {
    expect(isDecryptError(400, "Bad Request - Invalid params")).toBe(false);
  });

  it("is false for non-400 statuses", () => {
    expect(isDecryptError(404, "Not found")).toBe(false);
    expect(isDecryptError(200, undefined)).toBe(false);
  });

  it("is false when the message is missing", () => {
    expect(isDecryptError(400, undefined)).toBe(false);
  });
});

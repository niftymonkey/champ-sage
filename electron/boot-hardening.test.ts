import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifySettingsRead,
  corruptBackupPath,
  formatErrorForLog,
  shouldSuppressUncaught,
  nextRetryDelayMs,
  guardInit,
  parseSimulatedBootError,
  drainWithTimeout,
  preserveFileCopy,
  RENDERER_RETRY_POLICY,
} from "./boot-hardening";

function errnoError(code: string): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(`${code}: simulated`);
  err.code = code;
  return err;
}

describe("classifySettingsRead", () => {
  it("returns the parsed object when the file holds a JSON object", () => {
    const outcome = classifySettingsRead({
      kind: "read",
      raw: '{"voiceProvider":"whisper"}',
    });
    expect(outcome.status).toBe("ok");
    expect(outcome.data).toEqual({ voiceProvider: "whisper" });
    expect(outcome.safeToOverwrite).toBe(true);
  });

  it("treats a missing file as first launch, which is safe to write", () => {
    const outcome = classifySettingsRead({
      kind: "error",
      error: errnoError("ENOENT"),
    });
    expect(outcome.status).toBe("missing");
    expect(outcome.data).toEqual({});
    expect(outcome.safeToOverwrite).toBe(true);
  });

  it("treats an empty file as first launch rather than corruption", () => {
    const outcome = classifySettingsRead({ kind: "read", raw: "   \n" });
    expect(outcome.status).toBe("missing");
    expect(outcome.safeToOverwrite).toBe(true);
  });

  // The hazard this whole classification exists for: readSettingsFile used to
  // swallow a parse error into {}, and the next settings:set wrote that {}
  // back, destroying the user's settings without a word.
  it("flags unparseable JSON as corrupt and refuses to overwrite it", () => {
    const outcome = classifySettingsRead({
      kind: "read",
      raw: '{"voiceProvider":"whis',
    });
    expect(outcome.status).toBe("corrupt");
    expect(outcome.data).toEqual({});
    expect(outcome.safeToOverwrite).toBe(false);
    expect(outcome.detail).toBeTruthy();
  });

  it("flags valid JSON of the wrong shape as corrupt", () => {
    const outcome = classifySettingsRead({ kind: "read", raw: "[1,2,3]" });
    expect(outcome.status).toBe("corrupt");
    expect(outcome.safeToOverwrite).toBe(false);
  });

  it("treats JSON null as corrupt rather than an empty store", () => {
    const outcome = classifySettingsRead({ kind: "read", raw: "null" });
    expect(outcome.status).toBe("corrupt");
    expect(outcome.safeToOverwrite).toBe(false);
  });

  // A locked or permission-denied file still holds the user's real settings,
  // so overwriting it would be the same data loss as the corrupt case.
  it("treats an unreadable file as unreadable, not missing", () => {
    const outcome = classifySettingsRead({
      kind: "error",
      error: errnoError("EACCES"),
    });
    expect(outcome.status).toBe("unreadable");
    expect(outcome.data).toEqual({});
    expect(outcome.safeToOverwrite).toBe(false);
  });
});

describe("corruptBackupPath", () => {
  it("parks the bad file beside the original with a sortable stamp", () => {
    const path = corruptBackupPath(
      "/home/u/.config/champ-sage/settings.json",
      new Date("2026-08-20T22:13:05.123Z")
    );
    expect(path).toBe(
      "/home/u/.config/champ-sage/settings.json.corrupt-2026-08-20T22-13-05-123Z"
    );
  });

  // Windows rejects `:` in filenames, and userData lives on C: in this app,
  // so an ISO stamp used verbatim would throw and lose the evidence.
  it("uses no characters Windows forbids in a filename", () => {
    const path = corruptBackupPath(
      "C:\\Users\\markd\\AppData\\Roaming\\champ-sage\\settings.json",
      new Date("2026-08-20T22:13:05.123Z")
    );
    const filename = path.slice(path.lastIndexOf("\\") + 1);
    expect(filename).not.toMatch(/[:*?"<>|]/);
    expect(path.startsWith("C:\\Users")).toBe(true);
  });
});

describe("formatErrorForLog", () => {
  it("includes the stack, not just the message", () => {
    const err = new Error("boom");
    const formatted = formatErrorForLog(err);
    expect(formatted).toContain("boom");
    expect(formatted).toContain("boot-hardening.test");
  });

  it("follows the cause chain so wrapped errors keep their origin", () => {
    const root = new Error("socket closed");
    const wrapped = new Error("ingest failed", { cause: root });
    const formatted = formatErrorForLog(wrapped);
    expect(formatted).toContain("ingest failed");
    expect(formatted).toContain("socket closed");
  });

  it("renders a thrown non-Error without crashing the handler", () => {
    expect(formatErrorForLog({ weird: true })).toContain("weird");
    expect(formatErrorForLog(undefined)).toBeTruthy();
  });
});

describe("shouldSuppressUncaught", () => {
  it("suppresses everything once shutdown has started", () => {
    expect(shouldSuppressUncaught(new Error("anything"), true)).toBe(true);
  });

  it("suppresses pipe errors, which ow-electron would turn into a dialog", () => {
    expect(shouldSuppressUncaught(new Error("write EPIPE"), false)).toBe(true);
    expect(shouldSuppressUncaught(new Error("broken pipe"), false)).toBe(true);
  });

  // The regression that made this a function: a real crash used to be logged
  // message-only and otherwise ignored, which is how a dead boot looked calm.
  it("does not suppress a real error during normal running", () => {
    expect(shouldSuppressUncaught(new Error("cannot read x"), false)).toBe(
      false
    );
  });

  it("handles a thrown non-Error without assuming .message exists", () => {
    expect(shouldSuppressUncaught("just a string", false)).toBe(false);
  });
});

describe("nextRetryDelayMs", () => {
  it("backs off exponentially from the base delay", () => {
    expect(nextRetryDelayMs(1)).toBe(300);
    expect(nextRetryDelayMs(2)).toBe(600);
    expect(nextRetryDelayMs(3)).toBe(1200);
  });

  it("caps the delay so a long outage still retries briskly", () => {
    expect(nextRetryDelayMs(10)).toBe(RENDERER_RETRY_POLICY.maxMs);
  });

  it("returns null once the attempts are spent, so the caller can stop", () => {
    expect(nextRetryDelayMs(RENDERER_RETRY_POLICY.maxAttempts + 1)).toBeNull();
  });
});

describe("guardInit", () => {
  it("reports success and leaves the return value alone", async () => {
    const outcome = await guardInit("decision-log", async () => "done", {
      onError: () => {},
    });
    expect(outcome).toEqual({ step: "decision-log", ok: true });
  });

  // The whole point: a boot step that throws must not escape to whenReady,
  // because that is what left the app running with no window.
  it("contains a rejection and reports it instead of throwing", async () => {
    const onError = vi.fn();
    const outcome = await guardInit(
      "overwolf",
      async () => {
        throw new Error("GEP exploded");
      },
      { onError }
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.step).toBe("overwolf");
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBe("overwolf");
  });

  it("contains a synchronous throw the same way", async () => {
    const onError = vi.fn();
    const outcome = await guardInit(
      "menu",
      () => {
        throw new Error("sync boom");
      },
      { onError }
    );
    expect(outcome.ok).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("fails the step named by fault injection without running it", async () => {
    const run = vi.fn();
    const outcome = await guardInit("decision-log", run, {
      onError: () => {},
      simulateFailureFor: "decision-log",
    });
    expect(outcome.ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs steps that fault injection did not name", async () => {
    const run = vi.fn();
    const outcome = await guardInit("menu", run, {
      onError: () => {},
      simulateFailureFor: "decision-log",
    });
    expect(outcome.ok).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });
});

describe("parseSimulatedBootError", () => {
  it("names the step to fail when a dev server is present", () => {
    expect(parseSimulatedBootError("overwolf", "http://localhost:5173")).toBe(
      "overwolf"
    );
  });

  it("ignores the hook entirely in a packaged build", () => {
    expect(parseSimulatedBootError("overwolf", undefined)).toBeNull();
  });

  it("treats an unset or blank value as no injection", () => {
    expect(
      parseSimulatedBootError(undefined, "http://localhost:5173")
    ).toBeNull();
    expect(parseSimulatedBootError("  ", "http://localhost:5173")).toBeNull();
  });
});

describe("drainWithTimeout", () => {
  it("reports drained when the work finishes in time", async () => {
    expect(await drainWithTimeout(async () => undefined, 50)).toBe("drained");
  });

  // G17: a hung drain used to be able to hold before-quit open forever, which
  // left the process alive and poisoned the next boot's single-instance lock.
  it("gives up and reports timeout when the work hangs", async () => {
    const result = await drainWithTimeout(() => new Promise(() => {}), 20);
    expect(result).toBe("timeout");
  });

  it("reports failure rather than rejecting when the work throws", async () => {
    const result = await drainWithTimeout(async () => {
      throw new Error("close failed");
    }, 50);
    expect(result).toBe("failed");
  });
});

describe("preserveFileCopy", () => {
  function tmpFile(contents: string): { dir: string; path: string } {
    const dir = mkdtempSync(join(tmpdir(), "boot-hardening-"));
    const path = join(dir, "settings.json");
    writeFileSync(path, contents);
    return { dir, path };
  }

  it("copies the bad file aside and leaves the original in place", () => {
    const { path } = tmpFile('{"voiceProvider":"whis');
    const backup = corruptBackupPath(
      path,
      new Date("2026-08-20T22:13:05.123Z")
    );

    const outcome = preserveFileCopy(path, backup);

    expect(outcome.preserved).toBe(true);
    expect(readFileSync(backup, "utf-8")).toBe('{"voiceProvider":"whis');
    // Copy, not move: if preservation is the thing that fails, destroying the
    // original too would turn a recoverable problem into a total loss.
    expect(existsSync(path)).toBe(true);
  });

  it("never clobbers an existing backup from an earlier failure", () => {
    const { path } = tmpFile("second");
    const backup = corruptBackupPath(
      path,
      new Date("2026-08-20T22:13:05.123Z")
    );
    writeFileSync(backup, "first");

    const outcome = preserveFileCopy(path, backup);

    expect(outcome.preserved).toBe(false);
    expect(readFileSync(backup, "utf-8")).toBe("first");
  });

  it("reports failure instead of throwing when the source is gone", () => {
    const { dir } = tmpFile("x");
    const missing = join(dir, "not-here.json");
    const outcome = preserveFileCopy(missing, `${missing}.corrupt`);
    expect(outcome.preserved).toBe(false);
    expect(outcome.error).toBeTruthy();
  });
});

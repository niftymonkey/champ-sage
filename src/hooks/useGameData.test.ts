import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useGameData } from "./useGameData";
import * as dataIngest from "../lib/data-ingest";
import { notifications$ } from "../lib/reactive";
import type { AppNotification } from "../lib/reactive";
import type { LoadedGameData } from "../lib/data-ingest";

vi.mock("../lib/data-ingest", () => ({
  loadCachedGameData: vi.fn(),
  checkForNewVersion: vi.fn(),
  fetchAndCache: vi.fn(),
  loadGameData: vi.fn(),
}));

vi.mock("../lib/data-ingest/champion-id-map", () => ({
  populateChampionIdMap: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function createMockGameData(version = "15.6.1"): LoadedGameData {
  return {
    version,
    champions: new Map(),
    items: new Map(),
    runes: [],
    augments: new Map(),
    augmentSets: [],
    dictionary: {
      allNames: [],
      champions: [],
      items: [],
      augments: [],
      search: () => [],
      findInText: () => [],
    },
  };
}

let capturedNotifications: AppNotification[];
let notificationSub: { unsubscribe: () => void };

beforeEach(() => {
  vi.resetAllMocks();
  capturedNotifications = [];
  notificationSub = notifications$.subscribe((n) =>
    capturedNotifications.push(n)
  );

  // Default: production mode, zero jitter for deterministic tests
  import.meta.env.DEV = false;
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  notificationSub.unsubscribe();
  vi.restoreAllMocks();
});

describe("useGameData", () => {
  describe("warm cache (production)", () => {
    it("sets data immediately from cache without loading spinner", async () => {
      const cached = createMockGameData("15.6.1");
      vi.mocked(dataIngest.loadCachedGameData).mockResolvedValue(cached);
      vi.mocked(dataIngest.checkForNewVersion).mockResolvedValue(false);

      const { result } = renderHook(() => useGameData());

      await waitFor(() => {
        expect(result.current.data).not.toBeNull();
      });

      expect(result.current.data!.version).toBe("15.6.1");
      expect(result.current.loading).toBe(false);
    });

    it("checks version after serving cached data", async () => {
      const cached = createMockGameData("15.6.1");
      vi.mocked(dataIngest.loadCachedGameData).mockResolvedValue(cached);
      vi.mocked(dataIngest.checkForNewVersion).mockResolvedValue(false);

      renderHook(() => useGameData());

      await waitFor(() => {
        expect(dataIngest.checkForNewVersion).toHaveBeenCalledWith("15.6.1");
      });
    });

    it("does not fetch when version matches", async () => {
      const cached = createMockGameData("15.6.1");
      vi.mocked(dataIngest.loadCachedGameData).mockResolvedValue(cached);
      vi.mocked(dataIngest.checkForNewVersion).mockResolvedValue(false);

      renderHook(() => useGameData());

      await waitFor(() => {
        expect(dataIngest.checkForNewVersion).toHaveBeenCalled();
      });

      expect(dataIngest.fetchAndCache).not.toHaveBeenCalled();
    });

    it("updates data after background refresh succeeds", async () => {
      const cached = createMockGameData("15.6.1");
      const fresh = createMockGameData("15.7.1");
      vi.mocked(dataIngest.loadCachedGameData).mockResolvedValue(cached);
      vi.mocked(dataIngest.checkForNewVersion).mockResolvedValue(true);
      vi.mocked(dataIngest.fetchAndCache).mockResolvedValue(fresh);

      const { result } = renderHook(() => useGameData());

      await waitFor(() => {
        expect(result.current.data?.version).toBe("15.7.1");
      });
    });

    it("pushes success notification after background update", async () => {
      const cached = createMockGameData("15.6.1");
      const fresh = createMockGameData("15.7.1");
      vi.mocked(dataIngest.loadCachedGameData).mockResolvedValue(cached);
      vi.mocked(dataIngest.checkForNewVersion).mockResolvedValue(true);
      vi.mocked(dataIngest.fetchAndCache).mockResolvedValue(fresh);

      renderHook(() => useGameData());

      await waitFor(() => {
        const successNotif = capturedNotifications.find(
          (n) => n.level === "success"
        );
        expect(successNotif).toBeDefined();
        expect(successNotif!.message).toContain("15.7.1");
      });
    });

    it("preserves cached data on background refresh failure", async () => {
      const cached = createMockGameData("15.6.1");
      vi.mocked(dataIngest.loadCachedGameData).mockResolvedValue(cached);
      vi.mocked(dataIngest.checkForNewVersion).mockResolvedValue(true);
      vi.mocked(dataIngest.fetchAndCache).mockRejectedValue(
        new Error("Network error")
      );

      const { result } = renderHook(() => useGameData());

      await waitFor(() => {
        const errorNotif = capturedNotifications.find(
          (n) => n.level === "error"
        );
        expect(errorNotif).toBeDefined();
      });

      expect(result.current.data?.version).toBe("15.6.1");
    });
  });

  describe("cold cache (first launch)", () => {
    it("shows loading state and fetches directly", async () => {
      vi.mocked(dataIngest.loadCachedGameData).mockResolvedValue(null);
      const fresh = createMockGameData("15.6.1");
      vi.mocked(dataIngest.fetchAndCache).mockResolvedValue(fresh);

      const { result } = renderHook(() => useGameData());

      // Initially loading with no data
      expect(result.current.loading).toBe(true);
      expect(result.current.data).toBeNull();

      await waitFor(() => {
        expect(result.current.data?.version).toBe("15.6.1");
        expect(result.current.loading).toBe(false);
      });

      // No version check needed on cold cache
      expect(dataIngest.checkForNewVersion).not.toHaveBeenCalled();
    });
  });

  describe("dev mode", () => {
    it("skips cache and fetches directly", async () => {
      import.meta.env.DEV = true;
      const fresh = createMockGameData("15.6.1");
      vi.mocked(dataIngest.loadGameData).mockResolvedValue(fresh);

      const { result } = renderHook(() => useGameData());

      await waitFor(() => {
        expect(result.current.data?.version).toBe("15.6.1");
      });

      expect(dataIngest.loadCachedGameData).not.toHaveBeenCalled();
      expect(dataIngest.checkForNewVersion).not.toHaveBeenCalled();
    });
  });

  describe("manual refresh", () => {
    it("does not fetch when version is current", async () => {
      const cached = createMockGameData("15.6.1");
      vi.mocked(dataIngest.loadCachedGameData).mockResolvedValue(cached);
      vi.mocked(dataIngest.checkForNewVersion).mockResolvedValue(false);

      const { result } = renderHook(() => useGameData());

      await waitFor(() => {
        expect(result.current.data).not.toBeNull();
      });

      // Reset mocks after initial load
      vi.mocked(dataIngest.checkForNewVersion).mockClear();
      vi.mocked(dataIngest.fetchAndCache).mockClear();
      vi.mocked(dataIngest.checkForNewVersion).mockResolvedValue(false);

      await act(async () => {
        result.current.refresh();
      });

      expect(dataIngest.checkForNewVersion).toHaveBeenCalled();
      expect(dataIngest.fetchAndCache).not.toHaveBeenCalled();
    });

    it("fetches without jitter when version differs", async () => {
      const cached = createMockGameData("15.6.1");
      const fresh = createMockGameData("15.7.1");
      vi.mocked(dataIngest.loadCachedGameData).mockResolvedValue(cached);
      vi.mocked(dataIngest.checkForNewVersion).mockResolvedValue(false);

      const { result } = renderHook(() => useGameData());

      await waitFor(() => {
        expect(result.current.data).not.toBeNull();
      });

      // Manual refresh: version now differs
      vi.mocked(dataIngest.checkForNewVersion).mockResolvedValue(true);
      vi.mocked(dataIngest.fetchAndCache).mockResolvedValue(fresh);

      await act(async () => {
        result.current.refresh();
      });

      await waitFor(() => {
        expect(dataIngest.fetchAndCache).toHaveBeenCalled();
        expect(result.current.data?.version).toBe("15.7.1");
      });
    });

    it("pushes 'already up to date' notification when current", async () => {
      const cached = createMockGameData("15.6.1");
      vi.mocked(dataIngest.loadCachedGameData).mockResolvedValue(cached);
      vi.mocked(dataIngest.checkForNewVersion).mockResolvedValue(false);

      const { result } = renderHook(() => useGameData());

      await waitFor(() => {
        expect(result.current.data).not.toBeNull();
      });

      capturedNotifications = [];
      vi.mocked(dataIngest.checkForNewVersion).mockResolvedValue(false);

      await act(async () => {
        result.current.refresh();
      });

      await waitFor(() => {
        const infoNotif = capturedNotifications.find((n) =>
          n.message.toLowerCase().includes("up to date")
        );
        expect(infoNotif).toBeDefined();
      });
    });
  });

  describe("jitter", () => {
    it("applies delay within 0-300s range", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });
      vi.spyOn(Math, "random").mockReturnValue(0.5); // 150s jitter

      const cached = createMockGameData("15.6.1");
      const fresh = createMockGameData("15.7.1");
      vi.mocked(dataIngest.loadCachedGameData).mockResolvedValue(cached);
      vi.mocked(dataIngest.checkForNewVersion).mockResolvedValue(true);
      vi.mocked(dataIngest.fetchAndCache).mockResolvedValue(fresh);

      renderHook(() => useGameData());

      // Flush the async init (loadCachedGameData + checkForNewVersion)
      await vi.advanceTimersByTimeAsync(0);

      // At 149s: should not have fetched yet
      await vi.advanceTimersByTimeAsync(149_000);
      expect(dataIngest.fetchAndCache).not.toHaveBeenCalled();

      // At 150s: should have fetched
      await vi.advanceTimersByTimeAsync(1_000);
      expect(dataIngest.fetchAndCache).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});

import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock electron-log/renderer for all tests — it requires Electron IPC
// which isn't available in the jsdom test environment.
vi.mock("electron-log/renderer", () => {
  const noop = () => {};
  const scopedLogger = {
    error: noop,
    warn: noop,
    info: noop,
    verbose: noop,
    debug: noop,
    silly: noop,
  };
  return {
    default: {
      scope: () => scopedLogger,
      error: noop,
      warn: noop,
      info: noop,
      verbose: noop,
      debug: noop,
      silly: noop,
    },
  };
});

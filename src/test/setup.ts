import "@testing-library/jest-dom/vitest";

// `electron-log/renderer` is swapped to `src/test/electron-log-stub.ts` via
// `vitest.config.ts`'s `resolve.alias`. The alias supersedes the previous
// per-test `vi.mock("electron-log/renderer", ...)` block (deleted Phase 9).

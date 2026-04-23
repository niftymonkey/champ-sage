import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
  resolve: {
    // Test + eval (vitest, evalite) run in Node. electron-log/renderer's IPC
    // transport assumes a real Electron preload bridge — without one it
    // either errors loudly or hangs. Swapping the import to a no-op stub
    // here means our static `import electronLog from "electron-log/renderer"`
    // in `src/lib/logger.ts` resolves cleanly in test/eval contexts. The
    // production renderer build (Vite, no test config) gets the real module.
    alias: {
      "electron-log/renderer": resolve(
        __dirname,
        "src/test/electron-log-stub.ts"
      ),
    },
  },
});

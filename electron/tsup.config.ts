import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { main: "electron/main.ts" },
    outDir: "dist-electron",
    format: "cjs",
    platform: "node",
    target: "node18",
    sourcemap: true,
    clean: true,
    external: ["electron"],
    noExternal: ["ws"],
  },
  {
    entry: { preload: "electron/preload.ts" },
    outDir: "dist-electron",
    format: "cjs",
    platform: "node",
    target: "node18",
    sourcemap: true,
    external: ["electron"],
  },
]);

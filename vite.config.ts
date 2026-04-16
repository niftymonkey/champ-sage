import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // Relative base so file:// loaded HTML in production can find its assets.
  // Required for `loadFile(...dist/index.html)` from the Electron main process.
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        overlay: resolve(__dirname, "overlay.html"),
        "overlay-strip": resolve(__dirname, "overlay-strip.html"),
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/electron/**", "**/dist-electron/**"],
    },
  },
});

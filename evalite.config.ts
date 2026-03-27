import { defineConfig } from "evalite/config";

export default defineConfig({
  testTimeout: 60_000,
  maxConcurrency: 5,
  setupFiles: ["dotenv/config"],
});

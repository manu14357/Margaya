import os from "node:os";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // jsdom tests with userEvent run many times slower on a busy machine. A slow
    // run must not read as a failure, so only a real hang hits this limit.
    testTimeout: 60_000,
    // One jsdom worker per core can run a big machine out of memory, and then
    // workers fail to start and their test files silently don't run.
    maxWorkers: Math.min(6, Math.max(1, os.availableParallelism() - 1)),
    coverage: {
      enabled: false,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@i18n": path.resolve(__dirname, "../../i18n"),
    },
  },
});

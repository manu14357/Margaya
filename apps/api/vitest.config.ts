import os from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["../../tests/api/**/*.test.ts"],
    // Many tests import most of the API; one worker per core can exhaust memory.
    maxWorkers: Math.min(6, Math.max(1, os.availableParallelism() - 1)),
    testTimeout: 30_000,
    // Unit tests never exercise Better Auth's limiter.
    env: { AUTH_RATE_LIMIT_ENABLED: "false" },
    coverage: {
      enabled: false,
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
    },
  },
  esbuild: {
    target: "node18",
  },
});

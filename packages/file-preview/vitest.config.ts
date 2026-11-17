import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    // The first import of a renderer chunk (the PDF one resolves ~190 asset
    // globs) is slow on a busy machine; a slow run is not a failure.
    testTimeout: 30_000,
  },
});

import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { desktopI18n } from "./scripts/desktop-i18n.ts";

const i18nDir = path.resolve(import.meta.dirname, "../../i18n");

export default defineConfig({
  plugins: [react(), desktopI18n(i18nDir)],
  // Tauri serves the built files from its own origin; relative paths keep the
  // bundle independent of it.
  base: "./",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    testTimeout: 30_000,
    maxWorkers: 2,
  },
});

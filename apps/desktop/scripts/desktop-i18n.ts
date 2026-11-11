import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

// The launcher ships only `desktop.launcher.*` from each locale file in the
// repo's i18n folder, read at build time; the rest of the web copy stays out
// of the bundle. src-tauri/build.rs extracts the same subtree for native menus.

const VIRTUAL_ID = "virtual:desktop-i18n";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

export type LauncherCopy = Record<string, Record<string, unknown>>;

export function extractLauncherCopy(i18nDir: string): LauncherCopy {
  const copy: LauncherCopy = {};
  for (const file of readdirSync(i18nDir)) {
    if (!/^[a-z]{2}-[A-Z]{2}\.json$/.test(file)) continue;
    const data = JSON.parse(readFileSync(path.join(i18nDir, file), "utf8"));
    const launcher = data?.desktop?.launcher;
    if (launcher && typeof launcher === "object") {
      copy[file.slice(0, -".json".length)] = launcher;
    }
  }
  return copy;
}

export function desktopI18n(i18nDir: string): Plugin {
  return {
    name: "margaya-desktop-i18n",
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      for (const file of readdirSync(i18nDir)) {
        this.addWatchFile(path.join(i18nDir, file));
      }
      return `export default ${JSON.stringify(extractLauncherCopy(i18nDir))};`;
    },
  };
}

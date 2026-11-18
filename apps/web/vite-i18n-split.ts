import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { LAZY_NAMESPACES } from "./src/lib/i18n/lazy-namespaces";

const LOADER_ID = "virtual:margaya-i18n";
// virtual:margaya-i18n/<locale>.<core | namespace>; the part after the last
// slash names the emitted chunk.
const PART_PREFIX = `${LOADER_ID}/`;
const LOCALE_FILE = /^[a-z]{2}-[A-Z]{2}\.json$/;

/**
 * Splits each translation file into a core module (every namespace but the
 * lazy ones) and one module per lazy namespace, all loaded on demand through
 * `virtual:margaya-i18n`. The JSON files in i18n/ stay the only source: the
 * i18n scripts and the desktop build read them as they are.
 */
export function i18nSplit(i18nDir: string): Plugin {
  const lazy: ReadonlySet<string> = new Set(LAZY_NAMESPACES);
  const parts = ["core", ...LAZY_NAMESPACES];

  return {
    name: "margaya-i18n-split",
    enforce: "pre",
    resolveId(id) {
      return id === LOADER_ID || id.startsWith(PART_PREFIX) ? id : null;
    },
    load(id) {
      if (id === LOADER_ID) {
        const locales = fs
          .readdirSync(i18nDir)
          .filter((file) => LOCALE_FILE.test(file))
          .map((file) => file.slice(0, -".json".length))
          .sort();
        const table = locales
          .map((locale) => {
            const loaders = parts
              .map(
                (part) =>
                  `${JSON.stringify(part)}: () => import(${JSON.stringify(`${PART_PREFIX}${locale}.${part}`)})`,
              )
              .join(", ");
            return `  ${JSON.stringify(locale)}: { ${loaders} },`;
          })
          .join("\n");
        return [
          `const parts = {\n${table}\n};`,
          "export function loadLocalePart(locale, part) {",
          "  const load = parts[locale]?.[part];",
          "  return load ? load().then((module) => module.default) : Promise.resolve(undefined);",
          "}",
        ].join("\n");
      }
      if (!id.startsWith(PART_PREFIX)) return null;

      const name = id.slice(PART_PREFIX.length);
      const dot = name.indexOf(".");
      const locale = name.slice(0, dot);
      const part = name.slice(dot + 1);
      const file = path.join(i18nDir, `${locale}.json`);
      this.addWatchFile(file);
      const all = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
        string,
        unknown
      >;
      const data =
        part === "core"
          ? Object.fromEntries(
              Object.entries(all).filter(([namespace]) => !lazy.has(namespace)),
            )
          : (all[part] ?? {});
      // JSON.parse of a string literal parses faster than an object literal.
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(data))});`;
    },
  };
}

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractLauncherCopy } from "../../scripts/desktop-i18n";
import { createTranslator, resolveLocale } from "./i18n";

const copy = {
  "en-US": {
    servers: {
      open: "Open",
      unread_one: "{{count}} unread",
      unread_other: "{{count}} unread",
    },
    add: { found: "Found Margaya {{version}} at {{url}}" },
  },
  "ru-RU": {
    servers: {
      open: "Открыть",
      unread_one: "{{count}} непрочитанное",
      unread_few: "{{count}} непрочитанных (few)",
      unread_many: "{{count}} непрочитанных",
      unread_other: "{{count}} непрочитанных (other)",
    },
  },
};

describe("resolveLocale", () => {
  const available = ["en-US", "de-DE", "pt-BR", "zh-CN"];

  it("prefers an exact match, ignoring case", () => {
    expect(resolveLocale(available, ["pt-br"])).toBe("pt-BR");
  });

  it("falls back to the same language", () => {
    expect(resolveLocale(available, ["de-AT"])).toBe("de-DE");
    expect(resolveLocale(available, ["zh"])).toBe("zh-CN");
  });

  it("walks the preference list, then uses English", () => {
    expect(resolveLocale(available, ["xx-XX", "de-CH"])).toBe("de-DE");
    expect(resolveLocale(available, ["xx-XX"])).toBe("en-US");
    expect(resolveLocale(available, [])).toBe("en-US");
  });
});

describe("createTranslator", () => {
  it("interpolates values", () => {
    const t = createTranslator(copy, "en-US");
    expect(t("add.found", { version: "1.2.0", url: "https://m.example" })).toBe(
      "Found Margaya 1.2.0 at https://m.example",
    );
  });

  it("selects plural forms with the locale's rules", () => {
    const t = createTranslator(copy, "ru-RU");
    expect(t("servers.unread", { count: 1 })).toBe("1 непрочитанное");
    expect(t("servers.unread", { count: 3 })).toBe("3 непрочитанных (few)");
    expect(t("servers.unread", { count: 5 })).toBe("5 непрочитанных");
  });

  it("falls back to English, then to the key", () => {
    const t = createTranslator(copy, "ru-RU");
    expect(t("add.found", { version: "1", url: "u" })).toBe(
      "Found Margaya 1 at u",
    );
    expect(t("missing.key")).toBe("missing.key");
  });
});

describe("launcher copy", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const english = extractLauncherCopy(path.resolve(root, "../../i18n"))[
    "en-US"
  ];

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")
        ? [full]
        : [];
    });
  }

  it("has an English string for every static key the launcher uses", () => {
    const t = createTranslator({ "en-US": english ?? {} }, "en-US");
    const keys = new Set<string>();
    for (const file of sourceFiles(path.join(root, "src"))) {
      for (const match of readFileSync(file, "utf8").matchAll(
        /\bt\(\s*"([\w.]+)"/g,
      )) {
        if (match[1]) keys.add(match[1]);
      }
    }
    expect(keys.size).toBeGreaterThan(20);
    const missing = [...keys].filter((key) => t(key, { count: 2 }) === key);
    expect(missing).toEqual([]);
  });
});

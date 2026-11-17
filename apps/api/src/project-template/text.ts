import azAZ from "../../../../i18n/az-AZ.json";
import deDE from "../../../../i18n/de-DE.json";
import elGR from "../../../../i18n/el-GR.json";
import enUS from "../../../../i18n/en-US.json";
import esES from "../../../../i18n/es-ES.json";
import frFR from "../../../../i18n/fr-FR.json";
import hiIN from "../../../../i18n/hi-IN.json";
import idID from "../../../../i18n/id-ID.json";
import itIT from "../../../../i18n/it-IT.json";
import jaJP from "../../../../i18n/ja-JP.json";
import koKR from "../../../../i18n/ko-KR.json";
import mkMK from "../../../../i18n/mk-MK.json";
import nlNL from "../../../../i18n/nl-NL.json";
import plPL from "../../../../i18n/pl-PL.json";
import ptBR from "../../../../i18n/pt-BR.json";
import ruRU from "../../../../i18n/ru-RU.json";
import trTR from "../../../../i18n/tr-TR.json";
import ukUA from "../../../../i18n/uk-UA.json";
import viVN from "../../../../i18n/vi-VN.json";
import zhCN from "../../../../i18n/zh-CN.json";
import { LOCALE_FRAGMENTS } from "./locales";

// Seeded template text. Keys are "projectTemplates:<path>" (and the
// whiteboard board labels, "whiteboards:templates.labels.<path>"). The text
// comes from the projectTemplates slice of the 20 locale files, merged with
// the per-template locale fragments in locales/<id>.json. A fragment is
// shaped { "<locale>": { "catalog": {...}, "content": {...} } }, so its key
// paths are the namespace's own and merging it into i18n/*.json later is
// mechanical.

export const APP_LOCALES = [
  "en-US",
  "az-AZ",
  "de-DE",
  "el-GR",
  "es-ES",
  "fr-FR",
  "hi-IN",
  "id-ID",
  "it-IT",
  "ja-JP",
  "ko-KR",
  "mk-MK",
  "nl-NL",
  "pl-PL",
  "pt-BR",
  "ru-RU",
  "tr-TR",
  "uk-UA",
  "vi-VN",
  "zh-CN",
] as const;
export type AppLocale = (typeof APP_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "en-US";

export type TextTree = { [key: string]: string | TextTree };

/** A per-locale fragment file: { "<locale>": { <projectTemplates paths> } }. */
export type LocaleFragment = Partial<Record<string, TextTree>>;

/** Text per locale and namespace: trees[locale][namespace] is a tree. */
export type TextSource = {
  /** The text at "namespace:dotted.path" in exactly this locale. */
  lookup(locale: string, key: string): string | undefined;
};

const LOCALE_FILES: Record<AppLocale, unknown> = {
  "en-US": enUS,
  "az-AZ": azAZ,
  "de-DE": deDE,
  "el-GR": elGR,
  "es-ES": esES,
  "fr-FR": frFR,
  "hi-IN": hiIN,
  "id-ID": idID,
  "it-IT": itIT,
  "ja-JP": jaJP,
  "ko-KR": koKR,
  "mk-MK": mkMK,
  "nl-NL": nlNL,
  "pl-PL": plPL,
  "pt-BR": ptBR,
  "ru-RU": ruRU,
  "tr-TR": trTR,
  "uk-UA": ukUA,
  "vi-VN": viVN,
  "zh-CN": zhCN,
};

function isTree(value: unknown): value is TextTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `over` wins on conflicts; neither input is changed. */
export function mergeTrees(base: TextTree, over: TextTree): TextTree {
  const merged: TextTree = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const current = merged[key];
    merged[key] =
      isTree(current) && isTree(value) ? mergeTrees(current, value) : value;
  }
  return merged;
}

function pathIn(tree: TextTree | undefined, path: string): string | undefined {
  let node: string | TextTree | undefined = tree;
  for (const part of path.split(".")) {
    if (!isTree(node)) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** namespace -> tree, per locale. */
export type NamespacedTrees = Partial<
  Record<string, Partial<Record<string, TextTree>>>
>;

export function createTextSource(trees: NamespacedTrees): TextSource {
  return {
    lookup(locale, key) {
      const colon = key.indexOf(":");
      if (colon < 1) return undefined;
      const namespace = key.slice(0, colon);
      return pathIn(trees[locale]?.[namespace], key.slice(colon + 1));
    },
  };
}

/** The i18n slices the engine reads, per locale (no fragments). */
export function i18nTrees(): NamespacedTrees {
  const trees: NamespacedTrees = {};
  for (const locale of APP_LOCALES) {
    const file = LOCALE_FILES[locale] as Record<string, unknown>;
    const whiteboards = file.whiteboards as Record<string, unknown> | undefined;
    const templates = whiteboards?.templates as
      | Record<string, unknown>
      | undefined;
    trees[locale] = {
      projectTemplates: isTree(file.projectTemplates)
        ? file.projectTemplates
        : {},
      whiteboards: {
        templates: {
          labels: isTree(templates?.labels) ? templates.labels : {},
        },
      },
    };
  }
  return trees;
}

/** Adds locale fragments to the projectTemplates namespace of `trees`. */
export function withFragments(
  trees: NamespacedTrees,
  fragments: readonly LocaleFragment[],
): NamespacedTrees {
  const merged: NamespacedTrees = { ...trees };
  for (const fragment of fragments) {
    for (const [locale, tree] of Object.entries(fragment)) {
      if (!tree) continue;
      const current = merged[locale] ?? {};
      merged[locale] = {
        ...current,
        projectTemplates: mergeTrees(current.projectTemplates ?? {}, tree),
      };
    }
  }
  return merged;
}

let defaultSource: TextSource | null = null;

/** The text the running server uses: i18n plus the registered fragments. */
export function templateTextSource(): TextSource {
  defaultSource ??= createTextSource(
    withFragments(i18nTrees(), LOCALE_FRAGMENTS),
  );
  return defaultSource;
}

/** The text in `locale`, else en-US; undefined when neither has it. */
export function textOrFallback(
  source: TextSource,
  locale: string,
  key: string,
): string | undefined {
  return source.lookup(locale, key) ?? source.lookup(DEFAULT_LOCALE, key);
}

// ---------------------------------------------------------------------------
// Locale choice

const BY_LANGUAGE = new Map<string, AppLocale>(
  APP_LOCALES.map((locale) => [locale.split("-")[0] as string, locale]),
);

/** The app locale for a BCP 47 tag, matched by language code. */
export function matchLocale(tag: string | null | undefined): AppLocale | null {
  const language = tag?.trim().toLowerCase().split(/[-_]/)[0];
  return (language && BY_LANGUAGE.get(language)) || null;
}

/** Tags of an Accept-Language header, highest quality first. */
export function acceptedLanguages(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params
        .map((param) => param.trim())
        .find((param) => param.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return {
        tag: tag.trim(),
        quality: Number.isFinite(quality) ? quality : 0,
        index,
      };
    })
    .filter((entry) => entry.tag && entry.tag !== "*" && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .map((entry) => entry.tag);
}

/**
 * The locale seeded text is written in. First match wins: the request's
 * explicit locale, the user's saved locale, the Accept-Language header,
 * then en-US.
 */
export function pickLocale({
  requested,
  userLocale,
  acceptLanguage,
}: {
  requested?: string | null;
  userLocale?: string | null;
  acceptLanguage?: string | null;
}): AppLocale {
  return (
    matchLocale(requested) ??
    matchLocale(userLocale) ??
    acceptedLanguages(acceptLanguage)
      .map(matchLocale)
      .find((locale): locale is AppLocale => locale !== null) ??
    DEFAULT_LOCALE
  );
}

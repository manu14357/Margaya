// Loaders for each translated `landing` namespace, keyed by locale. English
// is bundled with the pages, so it is not here. Server-only: the route
// app/landing-copy/[file] turns each into a static JSON file at build time.
// Keep the keys in step with LANDING_LOCALES (see landing-prefs.test.ts).
export const LANDING_COPY_LOADERS: Record<
  string,
  () => Promise<{ default: { landing: unknown } }>
> = {
  "az-AZ": () => import("../../../i18n/az-AZ.json"),
  "de-DE": () => import("../../../i18n/de-DE.json"),
  "el-GR": () => import("../../../i18n/el-GR.json"),
  "es-ES": () => import("../../../i18n/es-ES.json"),
  "fr-FR": () => import("../../../i18n/fr-FR.json"),
  "hi-IN": () => import("../../../i18n/hi-IN.json"),
  "id-ID": () => import("../../../i18n/id-ID.json"),
  "it-IT": () => import("../../../i18n/it-IT.json"),
  "ja-JP": () => import("../../../i18n/ja-JP.json"),
  "ko-KR": () => import("../../../i18n/ko-KR.json"),
  "mk-MK": () => import("../../../i18n/mk-MK.json"),
  "nl-NL": () => import("../../../i18n/nl-NL.json"),
  "pl-PL": () => import("../../../i18n/pl-PL.json"),
  "pt-BR": () => import("../../../i18n/pt-BR.json"),
  "ru-RU": () => import("../../../i18n/ru-RU.json"),
  "tr-TR": () => import("../../../i18n/tr-TR.json"),
  "uk-UA": () => import("../../../i18n/uk-UA.json"),
  "vi-VN": () => import("../../../i18n/vi-VN.json"),
  "zh-CN": () => import("../../../i18n/zh-CN.json"),
};

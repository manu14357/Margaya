import type { AppLocale } from "@i18n/resources";
import { useEffect, useState } from "react";
import type { DayPickerLocale } from "react-day-picker";

// The date picker names months and weekdays, and labels its days and buttons,
// through a date-fns locale carrying its own translations. Each language is a
// separate chunk, so only the active one is downloaded; English is built in.
const loaders: Record<
  Exclude<AppLocale, "en-US">,
  () => Promise<DayPickerLocale>
> = {
  "az-AZ": () => import("react-day-picker/locale/az").then((m) => m.az),
  "de-DE": () => import("react-day-picker/locale/de").then((m) => m.de),
  "el-GR": () => import("react-day-picker/locale/el").then((m) => m.el),
  "es-ES": () => import("react-day-picker/locale/es").then((m) => m.es),
  "fr-FR": () => import("react-day-picker/locale/fr").then((m) => m.fr),
  "hi-IN": () => import("react-day-picker/locale/hi").then((m) => m.hi),
  "id-ID": () => import("react-day-picker/locale/id").then((m) => m.id),
  "it-IT": () => import("react-day-picker/locale/it").then((m) => m.it),
  "ja-JP": () => import("react-day-picker/locale/ja").then((m) => m.ja),
  "ko-KR": () => import("react-day-picker/locale/ko").then((m) => m.ko),
  "mk-MK": () => import("react-day-picker/locale/mk").then((m) => m.mk),
  "nl-NL": () => import("react-day-picker/locale/nl").then((m) => m.nl),
  "pl-PL": () => import("react-day-picker/locale/pl").then((m) => m.pl),
  "pt-BR": () => import("react-day-picker/locale/pt-BR").then((m) => m.ptBR),
  "ru-RU": () => import("react-day-picker/locale/ru").then((m) => m.ru),
  "tr-TR": () => import("react-day-picker/locale/tr").then((m) => m.tr),
  "uk-UA": () => import("react-day-picker/locale/uk").then((m) => m.uk),
  "vi-VN": () => import("react-day-picker/locale/vi").then((m) => m.vi),
  "zh-CN": () => import("react-day-picker/locale/zh-CN").then((m) => m.zhCN),
};

type LocaleKey = keyof typeof loaders;

const loaded = new Map<LocaleKey, DayPickerLocale>();
const pending = new Map<LocaleKey, Promise<DayPickerLocale | undefined>>();

/** The app language's own locale key, matched by language code too ("de"). */
function localeKey(language: string | undefined): LocaleKey | null {
  if (!language) return null;
  const lower = language.toLowerCase();
  const keys = Object.keys(loaders) as LocaleKey[];
  return (
    keys.find((key) => key.toLowerCase() === lower) ??
    keys.find((key) => key.split("-")[0] === lower.split("-")[0]) ??
    null
  );
}

/** Starts loading a language's date-picker locale; English needs none. */
export function loadDayPickerLocale(
  language: string | undefined,
): Promise<DayPickerLocale | undefined> {
  const key = localeKey(language);
  if (!key) return Promise.resolve(undefined);
  const ready = loaded.get(key);
  if (ready) return Promise.resolve(ready);
  let request = pending.get(key);
  if (!request) {
    request = loaders[key]()
      .then((locale) => {
        loaded.set(key, locale);
        return locale;
      })
      // A failed chunk leaves the picker in English; the next use retries.
      .catch(() => undefined)
      .finally(() => pending.delete(key));
    pending.set(key, request);
  }
  return request;
}

/**
 * The date-picker locale of the app language, or undefined (English) until it
 * has loaded. The component re-renders once it arrives.
 */
export function useDayPickerLocale(
  language: string | undefined,
): DayPickerLocale | undefined {
  const key = localeKey(language);
  const [, setLoadedKey] = useState<LocaleKey | null>(null);

  useEffect(() => {
    if (!key || loaded.has(key)) return;
    let active = true;
    void loadDayPickerLocale(key).then(() => {
      if (active) setLoadedKey(key);
    });
    return () => {
      active = false;
    };
  }, [key]);

  return key ? loaded.get(key) : undefined;
}

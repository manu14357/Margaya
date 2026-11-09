import { isSupportedLocale } from "@i18n/resources";
import { useTranslation } from "react-i18next";
import type { AiUiLocale } from "@/fetchers/ai/writing";

// Apart from the editor AI hook so that pages without an editor (Home's
// brief) can ask for the language without loading the editor's model code.

/** The caller's UI language, when it is one the API answers in. */
export function useAiLocale(): AiUiLocale | undefined {
  const { i18n } = useTranslation();
  const language = i18n?.resolvedLanguage ?? i18n?.language;
  return language && isSupportedLocale(language)
    ? (language as AiUiLocale)
    : undefined;
}

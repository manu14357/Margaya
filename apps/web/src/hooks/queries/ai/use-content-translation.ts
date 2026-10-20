import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type TranslateKind, translateContent } from "@/fetchers/ai/translate";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { shouldOfferTranslation } from "@/lib/ai/detect-language";

/** A short, stable fingerprint of the text: a new key after any edit. */
export function textFingerprint(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

export const translationKeys = {
  one: (kind: TranslateKind, id: string, locale: string, text: string) =>
    ["ai", "translation", kind, id, locale, textFingerprint(text)] as const,
};

/**
 * Translate-on-read for one text. "Translate" is only offered when AI is
 * available and the cheap local check says the text is in another
 * language than the reader's UI; the model runs only after a click (or at
 * once with the workspace's auto-translate, when `auto` is set).
 */
export function useContentTranslation({
  kind,
  id,
  text,
  projectId,
  auto = false,
}: {
  kind: TranslateKind;
  id: string;
  text: string;
  projectId?: string | null;
  /** Follow the workspace's "auto-translate comments" setting. */
  auto?: boolean;
}) {
  const { i18n } = useTranslation();
  const locale = i18n?.resolvedLanguage ?? i18n?.language ?? "en-US";
  const { data: workspace } = useActiveWorkspace();
  const availability = useAiAvailability(projectId ?? undefined);
  const [requested, setRequested] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  const offer = useMemo(
    () => availability.available && shouldOfferTranslation(text, locale),
    [availability.available, text, locale],
  );
  const automatic = auto && availability.data?.autoTranslateComments === true;
  const enabled = Boolean(workspace?.id) && offer && (requested || automatic);

  const query = useQuery({
    queryKey: translationKeys.one(kind, id, locale, text),
    queryFn: () =>
      translateContent({
        workspaceId: workspace?.id ?? "",
        kind,
        id,
        targetLocale: locale,
      }),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60_000,
    retry: false,
  });

  const translated =
    query.data?.status === "translated" ? (query.data.text ?? null) : null;

  return {
    /** Show the Translate action at all. */
    offer: offer && query.data?.status !== "same_language",
    isTranslating: enabled && query.isFetching,
    error: query.error,
    sourceLanguage: query.data?.sourceLanguage ?? null,
    locale,
    /** The translation, while it is showing. */
    text: translated !== null && !showOriginal ? translated : null,
    hasTranslation: translated !== null,
    translate: () => {
      setRequested(true);
      setShowOriginal(false);
      if (query.isError) void query.refetch();
    },
    showOriginal: () => setShowOriginal(true),
  };
}

export type ContentTranslation = ReturnType<typeof useContentTranslation>;

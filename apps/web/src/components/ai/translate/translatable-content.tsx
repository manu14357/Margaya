import { Languages } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/components/ui/spinner";
import type { TranslateKind } from "@/fetchers/ai/translate";
import {
  type ContentTranslation,
  useContentTranslation,
} from "@/hooks/queries/ai/use-content-translation";
import { aiErrorKey } from "@/lib/ai/format";
import { cn } from "@/lib/cn";

/** "German" for "de", in the reader's language. */
function languageLabel(code: string, locale: string): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code
    );
  } catch {
    return code;
  }
}

const linkClass =
  "rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The quiet "Translate / Translated from X · Show original" line. */
export function TranslationToggle({
  translation,
  className,
}: {
  translation: ContentTranslation;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!translation.offer) return null;
  const { sourceLanguage, locale } = translation;
  return (
    <div
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs",
        className,
      )}
    >
      <Languages aria-hidden className="size-3.5 shrink-0" />
      {translation.isTranslating ? (
        <span className="inline-flex items-center gap-1.5">
          <Spinner className="size-3" />
          {t("ai:translate.translating")}
        </span>
      ) : translation.text !== null ? (
        <>
          <span>
            {sourceLanguage
              ? t("ai:translate.translatedFrom", {
                  language: languageLabel(sourceLanguage, locale),
                })
              : t("ai:translate.translated")}
          </span>
          <span aria-hidden>·</span>
          <button
            type="button"
            className={linkClass}
            onClick={translation.showOriginal}
          >
            {t("ai:translate.showOriginal")}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className={linkClass}
            onClick={translation.translate}
          >
            {translation.hasTranslation
              ? t("ai:translate.showTranslation")
              : t("ai:translate.action")}
          </button>
          {translation.error ? (
            <span className="text-destructive-foreground">
              {t(aiErrorKey(translation.error))}
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}

type TranslatableContentProps = {
  kind: TranslateKind;
  id: string;
  text: string;
  projectId?: string | null;
  /** Follow the workspace's "auto-translate comments" setting. */
  auto?: boolean;
  /** Renders the original or the translation (same Markdown renderer). */
  children: (text: string, translated: boolean) => ReactNode;
  /** While editing: the original only, no toggle. */
  hideToggle?: boolean;
  toggleClassName?: string;
};

/** Content with translate-on-read: the text, then the toggle line. */
export default function TranslatableContent({
  kind,
  id,
  text,
  projectId,
  auto,
  children,
  hideToggle = false,
  toggleClassName,
}: TranslatableContentProps) {
  const translation = useContentTranslation({
    kind,
    id,
    text,
    projectId,
    auto,
  });
  const shown = hideToggle ? null : translation.text;
  return (
    <>
      {children(shown ?? text, shown !== null)}
      {!hideToggle && (
        <TranslationToggle
          translation={translation}
          className={toggleClassName}
        />
      )}
    </>
  );
}

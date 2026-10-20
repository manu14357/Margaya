import AiMarkdown from "@/components/ai/ai-markdown";
import type { TranslateKind } from "@/fetchers/ai/translate";
import { useContentTranslation } from "@/hooks/queries/ai/use-content-translation";
import { cn } from "@/lib/cn";
import { TranslationToggle } from "./translatable-content";

type DescriptionTranslationProps = {
  kind: Extract<TranslateKind, "task" | "page">;
  id: string;
  /** The description or page as Markdown. */
  text: string;
  projectId?: string | null;
  className?: string;
};

/**
 * Translate-on-read for a task description or a page, which stay editable:
 * the translation shows inline below the toggle, read-only, until "Show
 * original". Renders nothing unless the text looks like another language.
 */
export default function DescriptionTranslation({
  kind,
  id,
  text,
  projectId,
  className,
}: DescriptionTranslationProps) {
  const translation = useContentTranslation({ kind, id, text, projectId });
  if (!translation.offer) return null;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <TranslationToggle translation={translation} />
      {translation.text !== null && (
        <div
          lang={translation.locale}
          className="rounded-md border border-border bg-muted/30 px-3 py-2"
        >
          <AiMarkdown text={translation.text} />
        </div>
      )}
    </div>
  );
}

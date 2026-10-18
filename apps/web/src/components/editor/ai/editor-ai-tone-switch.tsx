import { useTranslation } from "react-i18next";
import type { EditorAiTone } from "@/fetchers/ai/writing";
import { cn } from "@/lib/cn";
import { editorAiToneKey } from "./editor-ai-menu";
import { EDITOR_AI_TONES } from "./use-editor-ai";

/**
 * Default / Professional / Casual as a small segmented control. Picking a
 * tone remembers it and rewrites the current suggestion in that tone.
 */
export function EditorAiToneSwitch({
  value,
  onChange,
  disabled,
  className,
}: {
  value: EditorAiTone;
  onChange: (tone: EditorAiTone) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <fieldset
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      disabled={disabled}
    >
      <legend className="sr-only">{t("ai:writing.tone.legend")}</legend>
      <span aria-hidden className="text-muted-foreground text-xs">
        {t("ai:writing.tone.legend")}
      </span>
      <span className="inline-flex rounded-md border bg-background p-0.5">
        {EDITOR_AI_TONES.map((tone) => (
          <button
            key={tone}
            type="button"
            aria-pressed={value === tone}
            onClick={() => {
              if (value !== tone) onChange(tone);
            }}
            className={cn(
              "rounded-sm px-2 py-0.5 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              value === tone
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(editorAiToneKey(tone))}
          </button>
        ))}
      </span>
    </fieldset>
  );
}

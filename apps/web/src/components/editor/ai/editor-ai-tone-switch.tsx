import { useTranslation } from "react-i18next";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
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
      <ToggleGroup
        size="sm"
        variant="outline"
        disabled={disabled}
        value={[value]}
        onValueChange={(values) => {
          const next = EDITOR_AI_TONES.find((tone) => tone === values[0]);
          if (next) onChange(next);
        }}
      >
        {EDITOR_AI_TONES.map((tone) => (
          <Toggle key={tone} value={tone}>
            {t(editorAiToneKey(tone))}
          </Toggle>
        ))}
      </ToggleGroup>
    </fieldset>
  );
}

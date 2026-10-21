import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAiLocale } from "@/components/editor/ai/use-editor-ai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { parseTaskFilter } from "@/fetchers/ai/filters";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { aiErrorKey } from "@/lib/ai/format";
import type { FilterNode, TaskQueryScope } from "@/lib/task-query/model";

type AiFilterButtonProps = {
  workspaceId: string;
  scope: TaskQueryScope;
  /** Applies the understood filter (it replaces the current one). */
  onApply: (filters: FilterNode) => void;
  disabled?: boolean;
};

/**
 * "✦ Describe a filter…": a sentence such as "my overdue bugs" becomes
 * the filter chips, which stay editable like any other. Words that matched
 * nothing are listed as not understood. Hidden while AI is off.
 */
export default function AiFilterButton({
  workspaceId,
  scope,
  onApply,
  disabled,
}: AiFilterButtonProps) {
  const { t } = useTranslation();
  const locale = useAiLocale();
  const projectId = scope.kind === "project" ? scope.projectId : null;
  const { available } = useAiAvailability(projectId);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [dropped, setDropped] = useState<string[]>([]);
  const parse = useMutation({ mutationFn: parseTaskFilter });

  if (!available || !workspaceId) return null;

  const submit = () => {
    const value = text.trim();
    if (value.length < 2 || parse.isPending) return;
    setDropped([]);
    parse.mutate(
      {
        workspaceId,
        text: value.slice(0, 300),
        ...(projectId ? { projectId } : {}),
        ...(locale ? { locale } : {}),
      },
      {
        onSuccess: (result) => {
          setDropped(result.dropped);
          if (!result.filters) return;
          onApply(result.filters as FilterNode);
          if (result.dropped.length === 0) {
            setOpen(false);
            setText("");
          }
        },
      },
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          parse.reset();
          setDropped([]);
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="shrink-0 gap-1 text-muted-foreground"
            disabled={disabled}
          />
        }
        aria-label={t("ai:filters.button")}
        title={t("ai:filters.button")}
      >
        <Sparkles aria-hidden className="size-3.5" />
        <span className="hidden lg:inline">{t("ai:filters.short")}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label
            htmlFor="ai-filter-text"
            className="font-medium text-foreground text-sm"
          >
            {t("ai:filters.label")}
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="ai-filter-text"
              size="sm"
              autoFocus
              value={text}
              maxLength={300}
              onChange={(event) => setText(event.target.value)}
              placeholder={t("ai:filters.placeholder")}
            />
            <Button
              type="submit"
              size="xs"
              disabled={text.trim().length < 2 || parse.isPending}
            >
              {parse.isPending ? (
                <Spinner className="size-3" />
              ) : (
                t("ai:filters.apply")
              )}
            </Button>
          </div>
          <div aria-live="polite" className="text-xs">
            {parse.isError && (
              <p className="text-destructive-foreground">
                {t(aiErrorKey(parse.error))}
              </p>
            )}
            {parse.data && !parse.data.filters && (
              <p className="text-muted-foreground">{t("ai:filters.none")}</p>
            )}
            {parse.data?.filters && (
              <p className="text-muted-foreground">{t("ai:filters.applied")}</p>
            )}
            {dropped.length > 0 && (
              <p className="mt-1 text-muted-foreground">
                {t("ai:filters.dropped", { words: dropped.join(", ") })}
              </p>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            {t("ai:filters.hint")}
          </p>
        </form>
      </PopoverContent>
    </Popover>
  );
}

import { Check, RotateCw, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAiLocale } from "@/components/editor/ai/use-editor-ai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { type EditorAiAction, streamEditorAssist } from "@/fetchers/ai/writing";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { useAiTextStream } from "@/hooks/use-ai-text-stream";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import AiMarkdown from "./ai-markdown";

type AiTaskWriterProps = {
  workspaceId: string;
  projectId: string | null;
  title: string;
  description: string;
  /** Replaces the description with the reviewed text. */
  onUse: (markdown: string) => void;
};

/**
 * "✦ Write with AI" above a new task's description: drafts one from the
 * title (and any notes), or improves what is there. The answer streams into
 * a preview; nothing changes until "Use this". Hidden while AI is off for the
 * project or without task:create.
 */
export function AiTaskWriter({
  workspaceId,
  projectId,
  title,
  description,
  onUse,
}: AiTaskWriterProps) {
  const { t } = useTranslation();
  const { available } = useAiAvailability(projectId);
  const { canCreateTasks } = useWorkspacePermission();
  const locale = useAiLocale();
  const stream = useAiTextStream();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [lastAction, setLastAction] = useState<EditorAiAction>("draft");

  if (!available || !projectId || !canCreateTasks()) return null;

  const run = (action: EditorAiAction) => {
    const text =
      action === "draft"
        ? [title.trim(), description.trim()].filter(Boolean).join("\n\n")
        : description.trim();
    if (!text) return;
    setLastAction(action);
    void stream.start((handlers) =>
      streamEditorAssist(
        {
          workspaceId,
          target: { kind: "new_task", id: projectId },
          action,
          text,
          ...(instruction.trim()
            ? { instruction: instruction.trim().slice(0, 500) }
            : {}),
          ...(locale ? { locale } : {}),
        },
        handlers,
      ),
    );
  };

  const close = () => {
    stream.reset();
    setOpen(false);
  };

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Sparkles className="size-3.5" aria-hidden />
        {t("ai:writing.taskWriter.button")}
      </Button>
    );
  }

  const { status, text, errorKey } = stream;
  const busy = status === "streaming";
  const ready = status === "done" && text.trim().length > 0;

  return (
    <div className="space-y-2 rounded-lg border border-border/80 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-3.5 text-muted-foreground" aria-hidden />
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={busy || !title.trim()}
          onClick={() => run("draft")}
        >
          {t("ai:writing.taskWriter.draft")}
        </Button>
        {description.trim() && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => run("improve")}
          >
            {t("ai:writing.taskWriter.improve")}
          </Button>
        )}
        <Input
          value={instruction}
          maxLength={500}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder={t("ai:writing.taskWriter.instruction")}
          aria-label={t("ai:writing.taskWriter.instruction")}
          className="h-7 min-w-40 flex-1 text-xs"
        />
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={t("ai:writing.taskWriter.close")}
          onClick={close}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {status === "idle" && (
        <p className="text-muted-foreground text-xs">
          {t("ai:writing.taskWriter.hint")}
        </p>
      )}
      {(busy || text) && (
        <div className="max-h-72 overflow-y-auto rounded-md border border-border/70 bg-background px-3 py-2">
          {text ? (
            <AiMarkdown text={text} />
          ) : (
            <p className="flex items-center gap-2 text-muted-foreground text-xs">
              <Spinner className="size-3.5" />
              {t("ai:writing.taskWriter.writing")}
            </p>
          )}
        </div>
      )}
      {status === "error" && errorKey && (
        <p className="text-destructive text-xs" role="alert">
          {t(errorKey)}
        </p>
      )}
      {(ready || status === "error") && (
        <div className="flex flex-wrap items-center gap-2">
          {ready && (
            <Button
              type="button"
              size="xs"
              onClick={() => {
                onUse(text.trim());
                close();
              }}
            >
              <Check className="size-3.5" aria-hidden />
              {t("ai:writing.taskWriter.use")}
            </Button>
          )}
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => run(lastAction)}
          >
            <RotateCw className="size-3.5" aria-hidden />
            {t("ai:writing.taskWriter.retry")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => stream.reset()}
          >
            {t("ai:writing.taskWriter.discard")}
          </Button>
        </div>
      )}
    </div>
  );
}

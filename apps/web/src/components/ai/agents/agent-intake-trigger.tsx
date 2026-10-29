import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Agent } from "@/fetchers/ai/agents";
import { useSetAgentIntakeTrigger } from "@/hooks/mutations/ai/use-agent-mutations";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";

/** The translation key for a failed save. */
export function intakeTriggerErrorKey(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 403) return "ai:agents.intakeTrigger.errors.forbidden";
    try {
      const { code } = JSON.parse(error.message) as { code?: unknown };
      if (code === "AGENT_CANT_READ_INTAKE") {
        return "ai:agents.intakeTrigger.errors.AGENT_CANT_READ_INTAKE";
      }
    } catch {
      // A plain-text error: the generic message.
    }
  }
  return "ai:agents.intakeTrigger.saveError";
}

/** Settings → Agents → run an agent on new intake requests. */
export function AgentIntakeTriggerDialog({
  workspaceId,
  agent,
  onClose,
}: {
  workspaceId: string;
  agent: Agent;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const save = useSetAgentIntakeTrigger();
  const current = agent.intakeTrigger;
  const [enabled, setEnabled] = useState(current?.enabled ?? false);
  const [prompt, setPrompt] = useState(current?.prompt ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await save.mutateAsync({
        agentId: agent.id,
        trigger: { workspaceId, enabled, prompt: prompt.trim() || null },
      });
      toast.success(t("ai:agents.intakeTrigger.saved"));
      onClose();
    } catch (failure) {
      setError(intakeTriggerErrorKey(failure));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader className="border-border border-b px-6 py-5">
            <DialogTitle>
              {t("ai:agents.intakeTrigger.title", { name: agent.name })}
            </DialogTitle>
            <DialogDescription>
              {t("ai:agents.intakeTrigger.hint")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${ids}-enabled`}>
                  {t("ai:agents.intakeTrigger.enabled")}
                </Label>
                <p
                  id={`${ids}-enabled-hint`}
                  className="text-muted-foreground text-xs"
                >
                  {t("ai:agents.intakeTrigger.enabledHint")}
                </p>
              </div>
              <Switch
                id={`${ids}-enabled`}
                checked={enabled}
                aria-describedby={`${ids}-enabled-hint`}
                onCheckedChange={setEnabled}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${ids}-prompt`}>
                {t("ai:agents.intakeTrigger.prompt")}
              </Label>
              <Textarea
                id={`${ids}-prompt`}
                value={prompt}
                maxLength={4000}
                rows={4}
                placeholder={t("ai:agents.intakeTrigger.promptPlaceholder")}
                aria-describedby={`${ids}-prompt-hint`}
                onChange={(event) => setPrompt(event.target.value)}
              />
              <p
                id={`${ids}-prompt-hint`}
                className="text-muted-foreground text-xs"
              >
                {t("ai:agents.intakeTrigger.promptHint")}
              </p>
            </div>
            <ul className="flex list-disc flex-col gap-1 ps-4 text-muted-foreground text-xs">
              <li>
                {current?.runsAs
                  ? t("ai:agents.intakeTrigger.runsAs", {
                      name: current.runsAs.name,
                    })
                  : t("ai:agents.intakeTrigger.runsAsYou")}
              </li>
              <li>{t("ai:agents.intakeTrigger.outsideNote")}</li>
              <li>{t("ai:agents.intakeTrigger.limitNote")}</li>
            </ul>
            {error && (
              <p role="alert" className="text-destructive text-xs">
                {t(error)}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 border-border border-t px-6 py-4 sm:gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("ai:agents.cancel")}
            </Button>
            <Button type="submit" loading={save.isPending}>
              {t("ai:agents.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

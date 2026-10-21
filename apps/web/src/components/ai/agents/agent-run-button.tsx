import { Link } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useStartAgentRun } from "@/hooks/mutations/ai/use-agent-mutations";
import { useAgentRuns, useAgents } from "@/hooks/queries/ai/use-agents";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { RUN_STATUS_KEYS } from "@/lib/ai/agents";
import { aiErrorKey } from "@/lib/ai/format";
import { formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";

/**
 * "Run agent" in the task detail: pick an agent, say what to do. Shows
 * only where AI is available and the workspace has an enabled agent.
 */
export function AgentRunButton({
  taskId,
  projectId,
  workspaceId,
}: {
  taskId: string;
  projectId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const { available } = useAiAvailability(projectId);
  const agents = useAgents(available ? workspaceId : undefined);
  const enabled = (agents.data ?? []).filter((agent) => agent.enabled);
  const [open, setOpen] = useState(false);
  if (!available || enabled.length === 0) return null;
  return (
    <>
      <Button variant="outline" size="xs" onClick={() => setOpen(true)}>
        <Bot aria-hidden />
        {t("ai:agents.run.button")}
      </Button>
      {open && (
        <RunAgentDialog
          taskId={taskId}
          workspaceId={workspaceId}
          agents={enabled}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function RunAgentDialog({
  taskId,
  workspaceId,
  agents,
  onClose,
}: {
  taskId: string;
  workspaceId: string;
  agents: { id: string; name: string; description: string | null }[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const start = useStartAgentRun();
  const recent = useAgentRuns(workspaceId, { taskId });
  const agent = agents.find((item) => item.id === agentId);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!agentId || !prompt.trim()) return;
    try {
      await start.mutateAsync({
        workspaceId,
        agentId,
        taskId,
        prompt: prompt.trim(),
      });
      toast.success(t("ai:agents.run.started", { name: agent?.name ?? "" }));
      setPrompt("");
    } catch (error) {
      const key = aiErrorKey(error);
      toast.error(t(key === "ai:errors.unknown" ? "ai:agents.run.error" : key));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader className="border-border border-b px-6 py-5">
            <DialogTitle>{t("ai:agents.run.title")}</DialogTitle>
            <DialogDescription>{t("ai:agents.run.hint")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 px-6 py-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-run-agent">
                {t("ai:agents.run.agent")}
              </Label>
              <Select value={agentId} onValueChange={(v) => v && setAgentId(v)}>
                <SelectTrigger id="agent-run-agent">
                  <SelectValue>{agent?.name ?? ""}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {agents.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {agent?.description && (
                <p className="text-muted-foreground text-xs">
                  {agent.description}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-run-prompt">
                {t("ai:agents.run.prompt")}
              </Label>
              <Textarea
                id="agent-run-prompt"
                value={prompt}
                rows={3}
                maxLength={4000}
                placeholder={t("ai:agents.run.promptPlaceholder")}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </div>
            {(recent.data ?? []).length > 0 && (
              <section
                aria-label={t("ai:agents.run.recent")}
                className="flex flex-col gap-1.5"
                aria-live="polite"
              >
                <h3 className="font-medium text-muted-foreground text-xs">
                  {t("ai:agents.run.recent")}
                </h3>
                <ul className="flex flex-col gap-1 text-xs">
                  {(recent.data ?? []).slice(0, 5).map((run) => (
                    <li key={run.id} className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {run.agent?.name ?? ""}
                      </span>
                      <span className="text-muted-foreground">
                        {t(RUN_STATUS_KEYS[run.status])}
                      </span>
                      <span className="text-muted-foreground/70">
                        {formatRelativeTime(run.createdAt)}
                      </span>
                      <Link
                        to="/dashboard/workspace/$workspaceId/agents"
                        params={{ workspaceId }}
                        search={{ runId: run.id }}
                        className="ms-auto text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      >
                        {t("ai:agents.run.viewInDesk")}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <DialogFooter className="gap-2 border-border border-t px-6 py-4 sm:gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("ai:agents.cancel")}
            </Button>
            <Button
              type="submit"
              loading={start.isPending}
              disabled={!agentId || !prompt.trim()}
            >
              {t("ai:agents.run.start")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

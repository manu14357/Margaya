import { Bot, RotateCw, Sparkles } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAiLocale } from "@/components/editor/ai/use-editor-ai";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type {
  CodingAgentProfile,
  CodingAgentRepository,
} from "@/fetchers/coding-agent/coding-agent";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import {
  usePrepareCodingAgentBrief,
  useSendToCodingAgent,
  useTaskCodingAgents,
} from "@/hooks/queries/coding-agent/use-coding-agent";
import { aiErrorCode, aiErrorKey } from "@/lib/ai/format";
import { toast } from "@/lib/toast";

type Props = { taskId: string; projectId: string };

/** Profiles that can drive an issue on this repository's forge. */
export function profilesFor(
  profiles: CodingAgentProfile[],
  repository: CodingAgentRepository | undefined,
): CodingAgentProfile[] {
  if (!repository) return [];
  return profiles.filter((profile) =>
    profile.providers.includes(repository.provider),
  );
}

/**
 * "Send to coding agent" in the task's quick actions. Shown to people who
 * may update the task, when its project has a GitHub or Gitea repository.
 */
export function SendToCodingAgentButton({ taskId, projectId }: Props) {
  const { t } = useTranslation();
  const { data } = useTaskCodingAgents(taskId);
  const [open, setOpen] = useState(false);
  if (!data?.canSend || data.repositories.length === 0) return null;
  return (
    <>
      <Button variant="outline" size="xs" onClick={() => setOpen(true)}>
        <Bot className="size-3.5" />
        {t("ai:codingAgent.button")}
      </Button>
      {open && (
        <SendDialog
          taskId={taskId}
          projectId={projectId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function SendDialog({
  taskId,
  projectId,
  onClose,
}: Props & { onClose: () => void }) {
  const { t } = useTranslation();
  const ids = {
    repository: useId(),
    profile: useId(),
    ai: useId(),
    title: useId(),
    brief: useId(),
  };
  const locale = useAiLocale();
  const { data } = useTaskCodingAgents(taskId);
  const { available: aiAvailable } = useAiAvailability(projectId);
  const prepare = usePrepareCodingAgentBrief();
  const send = useSendToCodingAgent();

  const repositories = data?.repositories ?? [];
  const [repositoryId, setRepositoryId] = useState(
    () =>
      (repositories.find((repo) => repo.ready) ?? repositories[0])
        ?.integrationId ?? "",
  );
  const repository = repositories.find(
    (repo) => repo.integrationId === repositoryId,
  );
  const profiles = useMemo(
    () => profilesFor(data?.profiles ?? [], repository),
    [data?.profiles, repository],
  );
  const [profileId, setProfileId] = useState("");
  const profile =
    profiles.find((item) => item.id === profileId) ?? profiles[0] ?? null;
  const [useAi, setUseAi] = useState(false);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [prepared, setPrepared] = useState(false);

  const run = (withAi: boolean) => {
    if (!repositoryId) return;
    prepare.mutate(
      {
        taskId,
        integrationId: repositoryId,
        useAi: withAi,
        ...(locale ? { locale } : {}),
      },
      {
        onSuccess: (result) => {
          setTitle(result.title);
          setBrief(result.brief);
          setPrepared(true);
        },
      },
    );
  };

  // The plain brief is ready as soon as the dialog opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per open
  useEffect(() => {
    run(false);
  }, []);

  const submit = () => {
    if (!profile || !repository) return;
    send.mutate(
      {
        taskId,
        integrationId: repository.integrationId,
        profileId: profile.id,
        title: title.trim(),
        brief: brief.trim(),
      },
      {
        onSuccess: (result) => {
          const issueUrl = result.handoff.issueUrl;
          const action = {
            label: t("ai:codingAgent.openIssue"),
            onClick: () => window.open(issueUrl, "_blank", "noopener"),
          };
          if (result.assigned === false) {
            toast.warning(t("ai:codingAgent.sentNotAssigned"), { action });
          } else {
            toast.success(t("ai:codingAgent.sent"), { action });
          }
          onClose();
        },
        onError: () => toast.error(t("ai:codingAgent.sendError")),
      },
    );
  };

  const prepareError = prepare.error
    ? aiErrorCode(prepare.error)
      ? t(aiErrorKey(prepare.error))
      : t("ai:codingAgent.error")
    : null;
  const canSend =
    prepared &&
    Boolean(profile) &&
    Boolean(repository?.ready) &&
    title.trim().length > 0 &&
    brief.trim().length > 0 &&
    !prepare.isPending;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot aria-hidden="true" className="size-4 text-muted-foreground" />
            {t("ai:codingAgent.dialogTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("ai:codingAgent.dialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={ids.repository}>
                {t("ai:codingAgent.repository")}
              </Label>
              <Select
                value={repositoryId}
                onValueChange={(value) => {
                  if (!value) return;
                  setRepositoryId(value as string);
                  setProfileId("");
                }}
              >
                <SelectTrigger id={ids.repository} className="w-full">
                  <SelectValue>{repository?.name ?? ""}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {repositories.map((repo) => (
                    <SelectItem
                      key={repo.integrationId}
                      value={repo.integrationId}
                    >
                      {repo.name}
                      <span className="ms-1 text-muted-foreground text-xs">
                        {repo.provider === "github"
                          ? t("ai:codingAgent.github")
                          : t("ai:codingAgent.gitea")}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={ids.profile}>{t("ai:codingAgent.profile")}</Label>
              <Select
                value={profile?.id ?? ""}
                onValueChange={(value) =>
                  value && setProfileId(value as string)
                }
                disabled={profiles.length === 0}
              >
                <SelectTrigger id={ids.profile} className="w-full">
                  <SelectValue>{profile?.name ?? ""}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {repository && !repository.ready && (
            <p role="alert" className="text-destructive-foreground text-sm">
              {t("ai:codingAgent.notReady")}
            </p>
          )}
          {repository && profiles.length === 0 && (
            <p role="alert" className="text-muted-foreground text-sm">
              {t("ai:codingAgent.noProfiles")}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            {aiAvailable ? (
              <div className="flex items-center gap-2">
                <Switch
                  id={ids.ai}
                  checked={useAi}
                  onCheckedChange={(checked) => setUseAi(Boolean(checked))}
                />
                <Label htmlFor={ids.ai} className="flex items-center gap-1.5">
                  <Sparkles
                    aria-hidden="true"
                    className="size-3.5 text-muted-foreground"
                  />
                  {t("ai:codingAgent.useAi")}
                </Label>
              </div>
            ) : (
              <span />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={prepare.isPending || !repositoryId}
              onClick={() => run(aiAvailable && useAi)}
            >
              <RotateCw />
              {t("ai:codingAgent.regenerate")}
            </Button>
          </div>

          {prepare.isPending ? (
            <p
              aria-live="polite"
              className="inline-flex items-center gap-2 text-muted-foreground text-sm"
            >
              <Spinner className="size-3.5" />
              {t("ai:codingAgent.preparing")}
            </p>
          ) : prepareError ? (
            <p role="alert" className="text-destructive-foreground text-sm">
              {prepareError}
            </p>
          ) : null}

          {prepared && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={ids.title}>
                  {t("ai:codingAgent.titleLabel")}
                </Label>
                <Input
                  id={ids.title}
                  value={title}
                  maxLength={250}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={ids.brief}>
                  {t("ai:codingAgent.briefLabel")}
                </Label>
                <Textarea
                  id={ids.brief}
                  className="min-h-64 font-mono text-xs"
                  value={brief}
                  maxLength={30_000}
                  onChange={(event) => setBrief(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  {t("ai:codingAgent.briefNote")}
                </p>
              </div>
            </>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!canSend || send.isPending}
            onClick={submit}
          >
            {send.isPending && <Spinner className="size-3.5" />}
            {send.isPending
              ? t("ai:codingAgent.sending")
              : t("ai:codingAgent.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

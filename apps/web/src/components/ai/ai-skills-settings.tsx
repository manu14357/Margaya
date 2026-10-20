import { Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsGroup,
  SettingsGroupMessage,
  SettingsPage,
  SettingsSection,
} from "@/components/settings-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AiSkill } from "@/fetchers/ai/skills";
import {
  useCreateAiSkill,
  useDeleteAiSkill,
  useUpdateAiSkill,
} from "@/hooks/mutations/ai/use-ai-assistant-mutations";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { useAiSkills } from "@/hooks/queries/ai/use-ai-assistant";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { toast } from "@/lib/toast";

const MAX_NAME = 80;
const MAX_DESCRIPTION = 300;
const MAX_PROMPT = 4000;

type Draft = {
  name: string;
  description: string;
  prompt: string;
  shared: boolean;
};

/**
 * Settings → Workspace → AI skills: saved prompts used from "/" in Ask.
 * Shared skills are seen by everyone who uses AI; personal ones by their
 * author. Their author or an AI admin edits them.
 */
export function AiSkillsSettingsPage() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const { available, canUse } = useAiAvailability();
  const skills = useAiSkills(workspaceId, canUse);
  const remove = useDeleteAiSkill(workspaceId);
  const [editing, setEditing] = useState<AiSkill | "new" | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const deleteSkill = (id: string) => {
    remove.mutate(id, {
      onSuccess: () => {
        setConfirming(null);
        toast.success(t("ai:skills.deleted"));
      },
      onError: () => toast.error(t("ai:skills.saveError")),
    });
  };

  return (
    <SettingsPage
      title={t("ai:skills.title")}
      description={t("ai:skills.subtitle")}
      actions={
        canUse ? (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus aria-hidden />
            {t("ai:skills.new")}
          </Button>
        ) : undefined
      }
    >
      <SettingsSection title={t("ai:skills.listTitle")}>
        {skills.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : !canUse || !available ? (
          <SettingsGroup>
            <SettingsGroupMessage>
              {t("ai:skills.noAccess")}
            </SettingsGroupMessage>
          </SettingsGroup>
        ) : skills.isError ? (
          <SettingsGroup>
            <div className="flex items-center gap-3 px-4 py-4 text-muted-foreground text-xs">
              <span>{t("ai:skills.loadError")}</span>
              <Button
                variant="outline"
                size="xs"
                onClick={() => void skills.refetch()}
              >
                {t("ai:usage.retry")}
              </Button>
            </div>
          </SettingsGroup>
        ) : (skills.data ?? []).length === 0 ? (
          <SettingsGroup>
            <SettingsGroupMessage>{t("ai:skills.empty")}</SettingsGroupMessage>
          </SettingsGroup>
        ) : (
          <SettingsGroup>
            <ul className="divide-y">
              {(skills.data ?? []).map((skill) => (
                <li key={skill.id} className="flex items-start gap-3 px-4 py-3">
                  <Wand2
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm">/{skill.name}</span>
                      <Badge variant="outline">
                        {skill.shared
                          ? t("ai:skills.shared")
                          : t("ai:skills.personal")}
                      </Badge>
                    </div>
                    {skill.description && (
                      <p className="text-muted-foreground text-xs">
                        {skill.description}
                      </p>
                    )}
                    <p className="line-clamp-2 whitespace-pre-wrap text-muted-foreground text-xs">
                      {skill.prompt}
                    </p>
                    {confirming === skill.id && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className="text-xs">
                          {t("ai:skills.deleteConfirm", { name: skill.name })}
                        </span>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => setConfirming(null)}
                        >
                          {t("common:actions.cancel")}
                        </Button>
                        <Button
                          size="xs"
                          variant="destructive"
                          loading={remove.isPending}
                          onClick={() => deleteSkill(skill.id)}
                        >
                          {t("common:actions.delete")}
                        </Button>
                      </div>
                    )}
                  </div>
                  {skill.canEdit && confirming !== skill.id && (
                    <div className="flex shrink-0 gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("ai:skills.edit", { name: skill.name })}
                        title={t("ai:skills.edit", { name: skill.name })}
                        onClick={() => setEditing(skill)}
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("ai:skills.delete", { name: skill.name })}
                        title={t("ai:skills.delete", { name: skill.name })}
                        onClick={() => setConfirming(skill.id)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </SettingsGroup>
        )}
      </SettingsSection>
      {editing && workspaceId && (
        <SkillDialog
          workspaceId={workspaceId}
          skill={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </SettingsPage>
  );
}

function SkillDialog({
  workspaceId,
  skill,
  onClose,
}: {
  workspaceId: string;
  skill: AiSkill | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const create = useCreateAiSkill();
  const update = useUpdateAiSkill(workspaceId);
  const [draft, setDraft] = useState<Draft>({
    name: skill?.name ?? "",
    description: skill?.description ?? "",
    prompt: skill?.prompt ?? "",
    shared: skill?.shared ?? true,
  });
  const valid = draft.name.trim() && draft.prompt.trim();
  const pending = create.isPending || update.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const body = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      prompt: draft.prompt.trim(),
      shared: draft.shared,
    };
    const done = {
      onSuccess: () => {
        toast.success(t("ai:skills.saved"));
        onClose();
      },
      onError: () => toast.error(t("ai:skills.saveError")),
    };
    if (skill) update.mutate({ id: skill.id, patch: body }, done);
    else create.mutate({ workspaceId, ...body }, done);
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle>
              {skill ? t("ai:skills.editTitle") : t("ai:skills.newTitle")}
            </DialogTitle>
            <DialogDescription>{t("ai:skills.dialogHint")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 px-6 py-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ai-skill-name">{t("ai:skills.name")}</Label>
              <Input
                id="ai-skill-name"
                value={draft.name}
                maxLength={MAX_NAME}
                placeholder={t("ai:skills.namePlaceholder")}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ai-skill-description">
                {t("ai:skills.description")}
              </Label>
              <Input
                id="ai-skill-description"
                value={draft.description}
                maxLength={MAX_DESCRIPTION}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ai-skill-prompt">{t("ai:skills.prompt")}</Label>
              <Textarea
                id="ai-skill-prompt"
                value={draft.prompt}
                rows={6}
                maxLength={MAX_PROMPT}
                placeholder={t("ai:skills.promptPlaceholder")}
                onChange={(event) =>
                  setDraft({ ...draft, prompt: event.target.value })
                }
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor="ai-skill-shared">
                  {t("ai:skills.shareLabel")}
                </Label>
                <p className="text-muted-foreground text-xs">
                  {t("ai:skills.shareHint")}
                </p>
              </div>
              <Switch
                id="ai-skill-shared"
                checked={draft.shared}
                onCheckedChange={(shared) => setDraft({ ...draft, shared })}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 border-t px-6 py-4 sm:gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" loading={pending} disabled={!valid}>
              {t("ai:skills.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

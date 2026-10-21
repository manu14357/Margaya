import { Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { CodingAgentProfile } from "@/fetchers/coding-agent/coding-agent";
import {
  useCodingAgentProfiles,
  useCreateCodingAgentProfile,
  useDeleteCodingAgentProfile,
  useUpdateCodingAgentProfile,
} from "@/hooks/queries/coding-agent/use-coding-agent";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";

type Draft = { name: string; mention: string; assignee: string };

function ProfileForm({
  initial,
  pending,
  onSave,
  onCancel,
}: {
  initial: Draft;
  pending: boolean;
  onSave: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const ids = { name: useId(), mention: useId(), assignee: useId() };
  const [draft, setDraft] = useState(initial);
  const hasTarget = Boolean(draft.mention.trim() || draft.assignee.trim());
  return (
    <form
      className="space-y-3 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.name.trim() && hasTarget) onSave(draft);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={ids.name}>{t("ai:codingAgent.settings.name")}</Label>
          <Input
            id={ids.name}
            value={draft.name}
            maxLength={80}
            placeholder={t("ai:codingAgent.settings.namePlaceholder")}
            onChange={(event) =>
              setDraft((d) => ({ ...d, name: event.target.value }))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={ids.mention}>
            {t("ai:codingAgent.settings.mention")}
          </Label>
          <Input
            id={ids.mention}
            value={draft.mention}
            maxLength={300}
            placeholder={t("ai:codingAgent.settings.mentionPlaceholder")}
            onChange={(event) =>
              setDraft((d) => ({ ...d, mention: event.target.value }))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={ids.assignee}>
            {t("ai:codingAgent.settings.assignee")}
          </Label>
          <Input
            id={ids.assignee}
            value={draft.assignee}
            maxLength={60}
            placeholder={t("ai:codingAgent.settings.assigneePlaceholder")}
            onChange={(event) =>
              setDraft((d) => ({ ...d, assignee: event.target.value }))
            }
          />
        </div>
      </div>
      {!hasTarget && (
        <p className="text-muted-foreground text-xs">
          {t("ai:codingAgent.settings.needsTarget")}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={pending || !draft.name.trim() || !hasTarget}
        >
          {t("ai:codingAgent.settings.save")}
        </Button>
      </div>
    </form>
  );
}

function ProfileRow({
  profile,
  workspaceId,
  canManage,
}: {
  profile: CodingAgentProfile;
  workspaceId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const switchId = useId();
  const update = useUpdateCodingAgentProfile();
  const remove = useDeleteCodingAgentProfile();
  const [editing, setEditing] = useState(false);
  const fail = () => toast.error(t("ai:codingAgent.settings.error"));

  if (editing) {
    return (
      <li>
        <ProfileForm
          initial={{
            name: profile.name,
            mention: profile.mention,
            assignee: profile.assignee ?? "",
          }}
          pending={update.isPending}
          onCancel={() => setEditing(false)}
          onSave={(draft) =>
            update.mutate(
              {
                workspaceId,
                id: profile.id,
                name: draft.name.trim(),
                mention: draft.mention.trim(),
                assignee: draft.assignee.trim() || null,
              },
              {
                onSuccess: () => {
                  setEditing(false);
                  toast.success(t("ai:codingAgent.settings.saved"));
                },
                onError: fail,
              },
            )
          }
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm">{profile.name}</span>
          {profile.builtin && (
            <Badge variant="outline">
              {t("ai:codingAgent.settings.builtin")}
            </Badge>
          )}
          {!profile.providers.includes("gitea") && (
            <Badge variant="outline">
              {t("ai:codingAgent.settings.githubOnly")}
            </Badge>
          )}
        </div>
        <p className="truncate text-muted-foreground text-xs">
          {[profile.mention, profile.assignee ? `→ ${profile.assignee}` : ""]
            .filter(Boolean)
            .join("  ")}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor={switchId} className="sr-only">
          {t("ai:codingAgent.settings.enabled")}
        </Label>
        <Switch
          id={switchId}
          checked={profile.enabled}
          disabled={!canManage || update.isPending}
          onCheckedChange={(checked) =>
            update.mutate(
              { workspaceId, id: profile.id, enabled: Boolean(checked) },
              { onError: fail },
            )
          }
        />
        {canManage && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("ai:codingAgent.settings.edit")}
            title={t("ai:codingAgent.settings.edit")}
            onClick={() => setEditing(true)}
          >
            <Pencil />
          </Button>
        )}
        {canManage && !profile.builtin && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("ai:codingAgent.settings.delete")}
            title={t("ai:codingAgent.settings.delete")}
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(
                { workspaceId, id: profile.id },
                {
                  onSuccess: () =>
                    toast.success(t("ai:codingAgent.settings.deleted")),
                  onError: fail,
                },
              )
            }
          >
            <Trash2 />
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * Settings → project → Integrations → Coding agents: the workspace's
 * profiles for "Send to coding agent" (workspace:manage_settings to edit).
 */
export function CodingAgentProfilesSettings() {
  const { t } = useTranslation();
  const { workspace } = useWorkspacePermission();
  const workspaceId = workspace?.id ?? "";
  const { data, isLoading } = useCodingAgentProfiles(workspaceId);
  const create = useCreateCodingAgentProfile();
  const [adding, setAdding] = useState(false);
  const canManage = Boolean(data?.canManage);

  if (isLoading || !data) {
    return <Skeleton className="h-24 w-full" />;
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        {t("ai:codingAgent.settings.sharedNote")}
      </p>
      <ul className="divide-y divide-border">
        {data.profiles.map((profile) => (
          <ProfileRow
            key={profile.id}
            profile={profile}
            workspaceId={workspaceId}
            canManage={canManage}
          />
        ))}
      </ul>
      {!canManage ? (
        <p className="text-muted-foreground text-xs">
          {t("ai:codingAgent.settings.readOnly")}
        </p>
      ) : adding ? (
        <ProfileForm
          initial={{ name: "", mention: "", assignee: "" }}
          pending={create.isPending}
          onCancel={() => setAdding(false)}
          onSave={(draft) =>
            create.mutate(
              {
                workspaceId,
                name: draft.name.trim(),
                mention: draft.mention.trim(),
                assignee: draft.assignee.trim() || null,
              },
              {
                onSuccess: () => {
                  setAdding(false);
                  toast.success(t("ai:codingAgent.settings.saved"));
                },
                onError: () => toast.error(t("ai:codingAgent.settings.error")),
              },
            )
          }
        />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus />
          {t("ai:codingAgent.settings.add")}
        </Button>
      )}
    </div>
  );
}

import { Check, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsGroup,
  SettingsGroupMessage,
  SettingsPage,
  SettingsSection,
} from "@/components/settings-layout";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { AiMemoryNote, AiMemoryScope } from "@/fetchers/ai/memory";
import {
  useCreateAiMemory,
  useDeleteAiMemory,
  useUpdateAiMemory,
} from "@/hooks/mutations/ai/use-ai-assistant-mutations";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { useAiMemory } from "@/hooks/queries/ai/use-ai-assistant";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { toast } from "@/lib/toast";

const MAX_NOTE = 500;
const SCOPES: readonly AiMemoryScope[] = ["workspace", "project", "user"];

/**
 * Settings → Workspace → AI memory: short facts AI keeps in mind ("our
 * release day is Thursday") for the workspace, a project or just you.
 * Workspace and project notes are edited by AI admins; personal notes are
 * private.
 */
export function AiMemorySettingsPage() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const { available, canUse, canManage } = useAiAvailability();
  const notes = useAiMemory(workspaceId, canUse);
  const { data: projects } = useGetProjects({ workspaceId });
  const [scope, setScope] = useState<AiMemoryScope>("workspace");
  const [projectId, setProjectId] = useState<string>("");
  const currentProject = projectId || (projects?.[0]?.id ?? "");

  const shown = (notes.data ?? []).filter(
    (note) =>
      note.scope === scope &&
      (scope !== "project" || note.projectId === currentProject),
  );
  const canAdd = scope === "user" || canManage;

  return (
    <SettingsPage
      title={t("ai:memory.title")}
      description={t("ai:memory.subtitle")}
    >
      {!canUse || !available ? (
        <SettingsGroup>
          <SettingsGroupMessage>{t("ai:memory.noAccess")}</SettingsGroupMessage>
        </SettingsGroup>
      ) : (
        <Tabs
          value={scope}
          onValueChange={(value) => setScope(value as AiMemoryScope)}
        >
          <TabsList>
            {SCOPES.map((item) => (
              <TabsTab key={item} value={item}>
                {t(`ai:memory.scopes.${item}`)}
              </TabsTab>
            ))}
          </TabsList>
          {SCOPES.map((item) => (
            <TabsPanel key={item} value={item} className="pt-4">
              <SettingsSection
                title={t(`ai:memory.scopes.${item}`)}
                description={t(`ai:memory.scopeHints.${item}`)}
                actions={
                  item === "project" && (projects ?? []).length > 0 ? (
                    <Select
                      value={currentProject}
                      onValueChange={(value) => value && setProjectId(value)}
                    >
                      <SelectTrigger
                        size="sm"
                        className="w-48"
                        aria-label={t("ai:memory.project")}
                      >
                        <SelectValue>
                          {projects?.find((p) => p.id === currentProject)
                            ?.name ?? ""}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {(projects ?? []).map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : undefined
                }
              >
                {notes.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : notes.isError ? (
                  <SettingsGroup>
                    <div className="flex items-center gap-3 px-4 py-4 text-muted-foreground text-xs">
                      <span>{t("ai:memory.loadError")}</span>
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => void notes.refetch()}
                      >
                        {t("ai:usage.retry")}
                      </Button>
                    </div>
                  </SettingsGroup>
                ) : (
                  <SettingsGroup>
                    {shown.length === 0 ? (
                      <SettingsGroupMessage>
                        {t("ai:memory.empty")}
                      </SettingsGroupMessage>
                    ) : (
                      <ul className="divide-y">
                        {shown.map((note) => (
                          <NoteRow
                            key={note.id}
                            note={note}
                            workspaceId={workspaceId}
                          />
                        ))}
                      </ul>
                    )}
                    {canAdd && (item !== "project" || currentProject) && (
                      <AddNote
                        workspaceId={workspaceId}
                        scope={item}
                        projectId={item === "project" ? currentProject : null}
                      />
                    )}
                    {!canAdd && (
                      <p className="border-t px-4 py-3 text-muted-foreground text-xs">
                        {t("ai:memory.adminsOnly")}
                      </p>
                    )}
                  </SettingsGroup>
                )}
              </SettingsSection>
            </TabsPanel>
          ))}
        </Tabs>
      )}
    </SettingsPage>
  );
}

function AddNote({
  workspaceId,
  scope,
  projectId,
}: {
  workspaceId: string;
  scope: AiMemoryScope;
  projectId: string | null;
}) {
  const { t } = useTranslation();
  const create = useCreateAiMemory();
  const [content, setContent] = useState("");
  const add = () => {
    const text = content.trim();
    if (!text) return;
    create.mutate(
      {
        workspaceId,
        scope,
        content: text,
        ...(projectId ? { projectId } : {}),
      },
      {
        onSuccess: () => {
          setContent("");
          toast.success(t("ai:memory.saved"));
        },
        onError: () => toast.error(t("ai:memory.saveError")),
      },
    );
  };
  return (
    <div className="flex flex-col gap-2 border-t px-4 py-3">
      <Textarea
        value={content}
        rows={2}
        maxLength={MAX_NOTE}
        aria-label={t("ai:memory.newNote")}
        placeholder={t("ai:memory.placeholder")}
        onChange={(event) => setContent(event.target.value)}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!content.trim()}
          loading={create.isPending}
          onClick={add}
        >
          {t("ai:memory.add")}
        </Button>
      </div>
    </div>
  );
}

function NoteRow({
  note,
  workspaceId,
}: {
  note: AiMemoryNote;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const update = useUpdateAiMemory(workspaceId);
  const remove = useDeleteAiMemory(workspaceId);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(note.content);

  const save = () => {
    const text = value.trim();
    if (!text) return;
    update.mutate(
      { id: note.id, patch: { content: text } },
      {
        onSuccess: () => {
          setEditing(false);
          toast.success(t("ai:memory.saved"));
        },
        onError: () => toast.error(t("ai:memory.saveError")),
      },
    );
  };

  return (
    <li className="flex items-start gap-2 px-4 py-3">
      {editing ? (
        <Textarea
          value={value}
          rows={2}
          maxLength={MAX_NOTE}
          aria-label={t("ai:memory.editNote")}
          onChange={(event) => setValue(event.target.value)}
          className="min-w-0 flex-1"
        />
      ) : (
        <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm">
          {note.content}
        </p>
      )}
      {note.canEdit && (
        <div className="flex shrink-0 gap-0.5">
          {editing ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("ai:memory.save")}
                title={t("ai:memory.save")}
                disabled={!value.trim() || update.isPending}
                onClick={save}
              >
                <Check aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("common:actions.cancel")}
                title={t("common:actions.cancel")}
                onClick={() => {
                  setValue(note.content);
                  setEditing(false);
                }}
              >
                <X aria-hidden />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("ai:memory.editNote")}
                title={t("ai:memory.editNote")}
                onClick={() => setEditing(true)}
              >
                <Pencil aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("ai:memory.deleteNote")}
                title={t("ai:memory.deleteNote")}
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(note.id, {
                    onSuccess: () => toast.success(t("ai:memory.deleted")),
                    onError: () => toast.error(t("ai:memory.saveError")),
                  })
                }
              >
                <Trash2 aria-hidden />
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

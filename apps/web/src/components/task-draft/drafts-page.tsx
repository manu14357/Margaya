import { useNavigate } from "@tanstack/react-router";
import { FilePen, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import CreateTaskModal from "@/components/shared/modals/create-task-modal";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useTaskDrafts } from "@/hooks/queries/task-draft/use-task-drafts";
import { useAssigneePeople } from "@/hooks/use-task-assignees";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import type { TaskDraftSummary } from "@/types/task-draft";
import DeleteDraftDialog from "./delete-draft-dialog";
import DraftEditor from "./draft-editor";
import DraftRow from "./draft-row";
import { usePublishDraftFlow } from "./use-publish-draft-flow";

const ALL_PROJECTS = "all";
const NO_PROJECT = "none";
const SEARCH_DEBOUNCE_MS = 250;

type DraftsPageProps = {
  workspaceId: string;
  q?: string;
  /** A project id, or "none" for drafts without a project. */
  projectId?: string;
};

function DraftRowsSkeleton() {
  return (
    <div className="divide-y divide-border/50">
      {Array.from({ length: 6 }, (_, index) => `draft-skeleton-${index}`).map(
        (key) => (
          <div key={key} className="flex h-12 items-center gap-3 px-4">
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-20" />
          </div>
        ),
      )}
    </div>
  );
}

/** "Drafts": the caller's private drafts in this workspace (B11 §1.3). */
export default function DraftsPage({
  workspaceId,
  q = "",
  projectId,
}: DraftsPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canCreateTasks, isCheckingPermissions } = useWorkspacePermission();
  const canCreate = !isCheckingPermissions && canCreateTasks();
  const { people } = useAssigneePeople(workspaceId);
  const { data: projects } = useGetProjects({ workspaceId });
  const filters = useMemo(() => ({ q, projectId }), [q, projectId]);
  const drafts = useTaskDrafts(workspaceId, filters);
  const publish = usePublishDraftFlow(workspaceId);

  const [query, setQuery] = useState(q);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TaskDraftSummary | null>(null);
  const [createMode, setCreateMode] = useState<"draft" | "create" | null>(null);

  const updateSearch = useCallback(
    (patch: { q?: string; projectId?: string }) =>
      navigate({
        to: ".",
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          ...patch,
        }),
        replace: true,
      }),
    [navigate],
  );

  // The URL follows the search box after a short pause.
  useEffect(() => {
    if (query.trim() === q.trim()) return;
    const timeout = setTimeout(
      () => updateSearch({ q: query.trim() || undefined }),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timeout);
  }, [query, q, updateSearch]);

  const rows = useMemo(
    () => drafts.data?.pages.flatMap((page) => page.drafts) ?? [],
    [drafts.data],
  );
  const isFiltered = Boolean(q.trim() || projectId);

  const handlePublish = async (draft: TaskDraftSummary) => {
    const outcome = await publish(draft.id);
    if (outcome === "refused" && canCreate) setEditingId(draft.id);
  };

  const closeEditor = useCallback(() => setEditingId(null), []);

  const clearFilters = () => {
    setQuery("");
    updateSearch({ q: undefined, projectId: undefined });
  };

  let content: React.ReactNode;
  if (drafts.isPending) {
    content = <DraftRowsSkeleton />;
  } else if (drafts.isError) {
    content = (
      <div className="flex items-center gap-3 px-4 py-6 text-muted-foreground text-sm">
        <span>{t("tasks:drafts.loadError")}</span>
        <Button variant="outline" size="xs" onClick={() => drafts.refetch()}>
          {t("tasks:drafts.retry")}
        </Button>
      </div>
    );
  } else if (rows.length === 0 && isFiltered) {
    content = (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{t("tasks:drafts.noResults")}</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            {t("tasks:drafts.clearFilters")}
          </Button>
        </EmptyContent>
      </Empty>
    );
  } else if (rows.length === 0) {
    content = (
      <Empty className="min-h-[50vh]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FilePen />
          </EmptyMedia>
          <EmptyTitle>{t("tasks:drafts.empty.title")}</EmptyTitle>
          <EmptyDescription>
            {t("tasks:drafts.empty.description")}
          </EmptyDescription>
        </EmptyHeader>
        {canCreate && (
          <EmptyContent>
            <Button size="sm" onClick={() => setCreateMode("create")}>
              <Plus />
              {t("tasks:drafts.empty.newTask")}
            </Button>
          </EmptyContent>
        )}
      </Empty>
    );
  } else {
    content = (
      <div>
        {rows.map((draft) => (
          <DraftRow
            key={draft.id}
            draft={draft}
            people={people}
            canEdit={canCreate}
            onOpen={() => setEditingId(draft.id)}
            onPublish={() => void handlePublish(draft)}
            onDelete={() => setDeleting(draft)}
          />
        ))}
        {drafts.hasNextPage && (
          <div className="px-4 py-2">
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              loading={drafts.isFetchingNextPage}
              onClick={() => void drafts.fetchNextPage()}
            >
              {t("tasks:drafts.loadMore")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const projectFilter = projectId ?? ALL_PROJECTS;
  const projectFilterLabel =
    projectFilter === ALL_PROJECTS
      ? t("tasks:drafts.projectFilter.all")
      : projectFilter === NO_PROJECT
        ? t("tasks:drafts.projectFilter.none")
        : (projects?.find((project) => project.id === projectFilter)?.name ??
          t("tasks:drafts.projectFilter.all"));

  return (
    <>
      <PageTitle title={t("tasks:drafts.pageTitle")} />
      <WorkspaceLayout
        title={t("tasks:drafts.title")}
        headerActions={
          canCreate ? (
            <Button
              variant="outline"
              size="xs"
              className="gap-1"
              onClick={() => setCreateMode("draft")}
            >
              <Plus className="size-3" />
              {t("tasks:drafts.newDraft")}
            </Button>
          ) : null
        }
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 border-border/80 border-b bg-card px-4 py-2">
            <p className="text-muted-foreground text-xs">
              {t("tasks:drafts.subtitle")}
            </p>
            <div className="flex items-center gap-1.5">
              <div className="relative w-48 sm:w-60">
                <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 text-muted-foreground" />
                <Input
                  value={query}
                  maxLength={100}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("tasks:drafts.searchPlaceholder")}
                  aria-label={t("tasks:drafts.searchPlaceholder")}
                  className="h-7.5 [&_[data-slot=input]]:h-7 [&_[data-slot=input]]:pl-8 [&_[data-slot=input]]:text-xs"
                />
              </div>
              <Select
                value={projectFilter}
                onValueChange={(value) =>
                  updateSearch({
                    projectId:
                      !value || value === ALL_PROJECTS
                        ? undefined
                        : String(value),
                  })
                }
              >
                <SelectTrigger
                  size="sm"
                  className="h-7.5 w-40 text-xs"
                  aria-label={t("tasks:drafts.projectFilter.all")}
                >
                  <SelectValue>{projectFilterLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_PROJECTS}>
                    {t("tasks:drafts.projectFilter.all")}
                  </SelectItem>
                  <SelectItem value={NO_PROJECT}>
                    {t("tasks:drafts.projectFilter.none")}
                  </SelectItem>
                  {projects?.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">{content}</div>
        </div>
      </WorkspaceLayout>

      <DraftEditor
        workspaceId={workspaceId}
        draftId={editingId}
        onClose={closeEditor}
      />
      <CreateTaskModal
        open={createMode !== null}
        primaryAction={createMode ?? "create"}
        onClose={() => setCreateMode(null)}
      />
      <DeleteDraftDialog
        draft={deleting}
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      />
    </>
  );
}

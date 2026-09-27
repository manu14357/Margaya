import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import useCreateTaskRelation from "@/hooks/mutations/task-relation/use-create-task-relation";
import useGetProject from "@/hooks/queries/project/use-get-project";
import useGlobalSearch from "@/hooks/queries/search/use-global-search";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { HttpError } from "@/lib/http-error";
import { formatTaskKey } from "@/lib/task-key";
import {
  boardTaskList,
  DEFAULT_RELATION_KEY,
  matchesTaskQuery,
  type RelationDisplayKey,
  type RelationLike,
  relatedTaskIds,
  relationCandidates,
} from "@/lib/task-relations";
import { toast } from "@/lib/toast";
import RelationTypeSelect from "./relation-type-select";
import TaskPickerDialog, {
  type PickerGroup,
  type PickerTask,
} from "./task-picker-dialog";

// The relation type picked last, kept while the app stays open.
let rememberedRelationKey: RelationDisplayKey = DEFAULT_RELATION_KEY;

const OTHER_PROJECTS_MIN_QUERY = 2;
const SEARCH_DEBOUNCE_MS = 250;

type SearchResult = {
  id: string;
  type: string;
  title: string;
  projectId?: string;
  projectName?: string;
  projectSlug?: string;
  taskNumber?: number;
  status?: string;
};

type TaskRelationPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  projectId: string;
  workspaceId: string;
  relations: readonly RelationLike[];
};

/**
 * Links another task to this one: tasks of this project from the board
 * cache, plus tasks of other projects found by the workspace search.
 */
export default function TaskRelationPicker({
  open,
  onOpenChange,
  taskId,
  projectId,
  workspaceId,
  relations,
}: TaskRelationPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [relationKey, setRelationKey] = useState(rememberedRelationKey);
  const { data: board } = useGetTasks(projectId);
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const createRelation = useCreateTaskRelation();

  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebouncedQuery("");
    }
  }, [open]);

  useEffect(() => {
    const handle = setTimeout(
      () => setDebouncedQuery(query.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(handle);
  }, [query]);

  const wantsOtherProjects = query.trim().length >= OTHER_PROJECTS_MIN_QUERY;
  const searchTerm =
    open && debouncedQuery.length >= OTHER_PROJECTS_MIN_QUERY
      ? debouncedQuery
      : "";
  const search = useGlobalSearch({
    q: searchTerm,
    type: "tasks",
    workspaceId,
    limit: 20,
  });

  const slug = board?.slug ?? project?.slug ?? "";
  const columns = useMemo(
    () => new Map((board?.columns ?? []).map((column) => [column.id, column])),
    [board],
  );

  const groups = useMemo<PickerGroup[]>(() => {
    const thisProject = relationCandidates(
      boardTaskList(board),
      relations,
      taskId,
    )
      .map((task): PickerTask => {
        const key = formatTaskKey(slug, task.number);
        const column = columns.get(task.status);
        return {
          id: task.id,
          key,
          title: task.title,
          projectId,
          label: `${key} ${task.title}`,
          status: task.status,
          column: column && {
            icon: column.icon,
            isFinal: column.isFinal,
            group: column.group,
          },
        };
      })
      .filter((item) => matchesTaskQuery(query, item.key, item.title));

    const related = relatedTaskIds(relations, taskId);
    const results = (search.data?.results ?? []) as SearchResult[];
    const otherProjects =
      wantsOtherProjects && searchTerm
        ? results
            .filter(
              (result) =>
                result.type === "task" &&
                result.id !== taskId &&
                result.projectId &&
                result.projectId !== projectId &&
                !related.has(result.id),
            )
            .map((result): PickerTask => {
              const key = formatTaskKey(
                result.projectSlug ?? "",
                result.taskNumber,
              );
              return {
                id: result.id,
                key,
                title: result.title,
                projectId: result.projectId ?? "",
                projectName: result.projectName,
                label: `${key} ${result.title}`,
                // Another project's columns are unknown here; the slug's
                // default icon is enough.
                status: result.status ?? "",
              };
            })
        : [];

    return [
      {
        value: "this-project",
        label: t("tasks:relations.tasksInProject"),
        items: thisProject,
      },
      {
        value: "other-projects",
        label: t("tasks:relations.otherProjects"),
        items: otherProjects,
      },
    ];
  }, [
    board,
    columns,
    projectId,
    query,
    relations,
    search.data,
    searchTerm,
    slug,
    t,
    taskId,
    wantsOtherProjects,
  ]);

  const searching =
    wantsOtherProjects &&
    (debouncedQuery !== query.trim() || search.isFetching);
  const status = !wantsOtherProjects
    ? null
    : search.isError && !searching
      ? t("tasks:relations.otherProjectsError")
      : searching
        ? t("tasks:relations.searchingOtherProjects")
        : null;

  const handlePick = async (item: PickerTask) => {
    try {
      await createRelation.mutateAsync({
        sourceTaskId: taskId,
        targetTaskId: item.id,
        relationType: relationKey,
      });
      onOpenChange(false);
      toast.success(t("tasks:relations.added"));
    } catch (error) {
      const serverMessage =
        error instanceof HttpError &&
        (error.status === 400 || error.status === 409) &&
        error.message;
      toast.error(serverMessage || t("tasks:relations.linkError"));
    }
  };

  return (
    <TaskPickerDialog
      open={open}
      onOpenChange={onOpenChange}
      query={query}
      onQueryChange={setQuery}
      placeholder={t("tasks:relations.searchPlaceholder")}
      groups={groups}
      onPick={(item) => void handlePick(item)}
      status={status}
      footer={
        <>
          <RelationTypeSelect
            value={relationKey}
            onChange={(key) => {
              rememberedRelationKey = key;
              setRelationKey(key);
            }}
          />
          <span className="text-muted-foreground/60">
            {t("tasks:relations.selectTask")}
          </span>
        </>
      }
    />
  );
}

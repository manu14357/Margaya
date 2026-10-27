import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { produce } from "immer";
import {
  CalendarIcon,
  Check,
  FilePen,
  FolderKanban,
  LayoutTemplate,
  ListTree,
  Plus,
  Search,
  Tag,
  Trash2,
  UserIcon,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiTaskWriter } from "@/components/ai/ai-task-writer";
import LiveLabelSuggestions from "@/components/ai/triage/live-label-suggestions";
import TemplateMenu from "@/components/project/task-templates/template-menu";
import AssigneeAvatarStack from "@/components/task/assignee-avatar-stack";
import AssigneeMultiSelect from "@/components/task/assignee-multi-select";
import ParentTaskOptions, {
  type ParentOption,
  type ProjectBoardTask,
} from "@/components/task/parent-task-options";
import SimilarTaskHints, {
  type SimilarTask,
} from "@/components/task/similar-task-hints";
import TaskDescriptionEditor from "@/components/task/task-description-editor";
import DeleteDraftDialog from "@/components/task-draft/delete-draft-dialog";
import { usePublishDraftFlow } from "@/components/task-draft/use-publish-draft-flow";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import useSetCustomFieldValue from "@/hooks/mutations/custom-field/use-set-custom-field-value";
import useCreateLabel from "@/hooks/mutations/label/use-create-label";
import useCreateTask from "@/hooks/mutations/task/use-create-task";
import { useDeleteTask } from "@/hooks/mutations/task/use-delete-task";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import { useCreateTaskDraft } from "@/hooks/mutations/task-draft/use-create-task-draft";
import { useUpdateTaskDraft } from "@/hooks/mutations/task-draft/use-update-task-draft";
import useCreateTaskRelation from "@/hooks/mutations/task-relation/use-create-task-relation";
import useSetTaskParent from "@/hooks/mutations/task-relation/use-set-task-parent";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import useGetCustomFieldsByProject from "@/hooks/queries/custom-field/use-get-custom-fields-by-project";
import { useActiveEstimate } from "@/hooks/queries/estimate/use-active-estimate";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useSimilarTasks } from "@/hooks/queries/task/use-similar-tasks";
import { useTaskTemplates } from "@/hooks/queries/task-template/use-task-templates";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useDefaultAssigneePrefill } from "@/hooks/use-default-assignee-prefill";
import { useAssigneePeople } from "@/hooks/use-task-assignees";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { getEntryColumn } from "@/lib/column-groups";
import { prefillAssignees } from "@/lib/default-assignee";
import { formatDateMedium } from "@/lib/format";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
import {
  assigneesOfTask,
  formatAssigneeSummary,
  resolveAssignees,
  withAssignees,
} from "@/lib/task-assignees";
import {
  canPublishDraft,
  type DraftFormValues,
  diffDraftFields,
  draftToFormValues,
  formToDraftFields,
  hasDraftContent,
  isEmptyPatch,
} from "@/lib/task-draft";
import {
  runCreateModalSlots,
  TaskPropertySlotOutlet,
} from "@/lib/task-property-slots";
import {
  type AppliedTemplateTrace,
  fillFormFromTemplate,
} from "@/lib/task-template";
import { toast } from "@/lib/toast";
import useProjectStore from "@/store/project";
import type Task from "@/types/task";
import type { TaskDraft } from "@/types/task-draft";
import type { TaskTemplate } from "@/types/task-template";

type CreateTaskModalProps = {
  open: boolean;
  onClose: () => void;
  status?: string;
  projectId?: string;
  /** Edit mode: the dialog becomes this draft's editor (B11 §1.4). */
  draft?: TaskDraft;
  /** "draft" makes Save as draft the primary action (the Drafts page). */
  primaryAction?: "create" | "draft";
  /** Starting values from the capture bar's Ctrl Enter (canopy slice 5). */
  prefill?: CreateTaskPrefill;
};

export type CreateTaskPrefill = {
  title?: string;
  /** Markdown, e.g. an Ask answer turned into a task. */
  description?: string;
  priority?: string;
  assigneeIds?: readonly string[];
  dueDate?: Date;
  labels?: ReadonlyArray<{ name: string; color: string }>;
};

/** A task being created has no sub-tasks: any task of the project fits. */
const everyTask = (tasks: ProjectBoardTask[]) => tasks;

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

type Priority = "no-priority" | "low" | "medium" | "high" | "urgent";

type LabelColor =
  | "gray"
  | "dark-gray"
  | "purple"
  | "teal"
  | "green"
  | "yellow"
  | "orange"
  | "pink"
  | "red";

type Label = {
  id: string;
  name: string;
  color: string;
  taskId: string | null;
  workspaceId: string;
  createdAt: string;
};

type PopoverStep = "select" | "color";

type CustomFieldType = "text" | "number" | "date" | "dropdown" | "boolean";

type CustomFieldDefinition = {
  id: string;
  projectId: string;
  name: string;
  type: CustomFieldType;
  required: boolean;
  defaultValue: string | null;
  options: string[] | null;
  position: number;
  createdAt: string;
  updatedAt: string;
};

function normalizeTask(
  task: Partial<Task> &
    Pick<Task, "id" | "title" | "status" | "projectId" | "createdAt">,
): Task {
  return {
    ...task,
    number: task.number ?? null,
    description: task.description ?? null,
    priority: task.priority ?? null,
    startDate: task.startDate ?? null,
    dueDate: task.dueDate ?? null,
    position: task.position ?? 0,
    userId: task.userId ?? null,
    assigneeId: task.assigneeId ?? task.userId ?? null,
    assigneeName: task.assigneeName ?? null,
    assigneeImage: task.assigneeImage ?? null,
    assigneeIds: [...assigneesOfTask(task)],
    labels: task.labels ?? [],
    externalLinks: task.externalLinks ?? [],
  };
}

/** A stored draft label as the dialog's label state. */
function draftLabelState(
  label: { name: string; color: string },
  draft: TaskDraft,
): Label {
  return {
    id: `draft-label:${label.name}`,
    name: label.name,
    color: label.color,
    taskId: null,
    workspaceId: draft.workspaceId,
    createdAt: draft.createdAt,
  };
}

function CreateTaskModalContent({
  open,
  onClose,
  status,
  projectId,
  draft,
  primaryAction = "create",
  prefill,
}: CreateTaskModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { project, setProject } = useProjectStore();
  // Edit mode starts from the draft; later refetches never reset the form.
  const [initialValues] = useState<DraftFormValues | null>(() =>
    draft ? draftToFormValues(draft) : null,
  );
  const [baselineFields] = useState(() =>
    initialValues ? formToDraftFields(initialValues) : null,
  );

  const labelColors = useMemo(
    () =>
      [
        {
          value: "gray" as LabelColor,
          labelKey: "stone" as const,
          color: "var(--color-stone-500)",
        },
        {
          value: "dark-gray" as LabelColor,
          labelKey: "slate" as const,
          color: "var(--color-slate-500)",
        },
        {
          value: "purple" as LabelColor,
          labelKey: "lavender" as const,
          color: "var(--color-violet-500)",
        },
        {
          value: "teal" as LabelColor,
          labelKey: "sage" as const,
          color: "var(--color-emerald-600)",
        },
        {
          value: "green" as LabelColor,
          labelKey: "forest" as const,
          color: "var(--color-green-600)",
        },
        {
          value: "yellow" as LabelColor,
          labelKey: "amber" as const,
          color: "var(--color-amber-600)",
        },
        {
          value: "orange" as LabelColor,
          labelKey: "terracotta" as const,
          color: "var(--color-orange-600)",
        },
        {
          value: "pink" as LabelColor,
          labelKey: "rose" as const,
          color: "var(--color-rose-600)",
        },
        {
          value: "red" as LabelColor,
          labelKey: "crimson" as const,
          color: "var(--color-red-600)",
        },
      ].map(({ labelKey, ...rest }) => ({
        ...rest,
        label: t(`common:modals.createTask.labelColors.${labelKey}`),
      })),
    [t],
  );
  const location = useLocation();
  const { data: workspace } = useActiveWorkspace();
  const { people } = useAssigneePeople(workspace?.id || "");
  const { mutateAsync: createLabel } = useCreateLabel();
  const { data: workspaceLabels = [] } = useGetLabelsByWorkspace(
    workspace?.id || "",
  );
  const { canCreateTasks, canCreateLabels, canUpdateTasks } =
    useWorkspacePermission();
  const canCreateTaskCapability = canCreateTasks();
  // Linking under a parent changes the parent too (task:update); a draft
  // keeps its chosen parent until it is published.
  const canPickParent = canUpdateTasks();
  const canCreateLabelCapability = canCreateLabels();

  const [title, setTitle] = useState(
    initialValues?.title ?? prefill?.title ?? "",
  );
  const [description, setDescription] = useState(
    initialValues?.description ?? prefill?.description ?? "",
  );
  const [priority, setPriority] = useState<Priority>(
    ((initialValues?.priority ?? prefill?.priority) as Priority | undefined) ??
      "no-priority",
  );
  const [assigneeIds, setAssigneeIds] = useState<string[]>(() => [
    ...(initialValues?.assigneeIds ?? prefill?.assigneeIds ?? []),
  ]);
  const [startDate, setStartDate] = useState<Date | undefined>(
    initialValues?.startDate,
  );
  const [dueDate, setDueDate] = useState<Date | undefined>(
    initialValues?.dueDate ?? prefill?.dueDate,
  );
  const [createMore, setCreateMore] = useState(false);
  // Kept by Create more, so several sub-tasks can be added in a row.
  const [parent, setParent] = useState<ParentOption | null>(() =>
    draft?.parentTask
      ? {
          id: draft.parentTask.id,
          key: draft.parentTask.key,
          title: draft.parentTask.title,
        }
      : null,
  );
  const [parentOpen, setParentOpen] = useState(false);
  const [labels, setLabels] = useState<Label[]>(() =>
    draft && initialValues
      ? initialValues.labels.map((label) => draftLabelState(label, draft))
      : (prefill?.labels ?? []).map((label) => ({
          id: `prefill-label:${label.name}`,
          name: label.name,
          color: label.color,
          taskId: null,
          workspaceId: "",
          createdAt: "",
        })),
  );
  const [uploadTask, setUploadTask] = useState<Task | null>(null);
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false);
  const [deleteDraftOpen, setDeleteDraftOpen] = useState(false);
  // A draft's status; null is "the entry column at publish time".
  const [draftStatus, setDraftStatus] = useState<string | null>(
    initialValues?.status ?? null,
  );
  // A picked task template: its column wins over the `status` prop, and its
  // sub-tasks are created under the new task after it is saved.
  const [templateStatus, setTemplateStatus] = useState<string | null>(null);
  const [templateSubtasks, setTemplateSubtasks] = useState<string[]>([]);
  const [appliedTemplate, setAppliedTemplate] = useState<{
    name: string;
    trace: AppliedTemplateTrace;
  } | null>(null);
  const clearTemplate = () => {
    setTemplateStatus(null);
    setTemplateSubtasks([]);
    setAppliedTemplate(null);
  };

  const [labelsOpen, setLabelsOpen] = useState(false);
  const [labelsStep, setLabelsStep] = useState<PopoverStep>("select");
  const [searchValue, setSearchValue] = useState("");
  const [selectedColor, setSelectedColor] = useState<LabelColor>("gray");
  const [newLabelName, setNewLabelName] = useState("");

  const routeProjectId =
    location.pathname.match(/\/project\/([^/]+)/)?.[1] ?? null;
  // A draft keeps its own project (or none), wherever it is opened.
  const explicitProjectId = draft ? "" : projectId || routeProjectId || "";
  const [selectedProjectId, setSelectedProjectId] = useState(
    initialValues?.projectId ?? "",
  );
  const { data: workspaceProjects } = useGetProjects({
    workspaceId: workspace?.id || "",
  });
  // Only a project from this workspace's query may receive new content.
  // The global project store can still contain the last visited workspace.
  const resolvedProject = workspaceProjects?.find(
    (candidate) => candidate.id === (explicitProjectId || selectedProjectId),
  );
  const resolvedProjectId = resolvedProject?.id ?? "";
  // New tasks start with the project's default assignee, until the user
  // picks assignees (a draft or a capture-bar handoff arrives decided).
  const defaultAssigneeUserId = resolvedProject?.defaultAssigneeUserId ?? null;
  const assigneePrefill = useDefaultAssigneePrefill({
    defaultAssigneeUserId,
    initiallyChosen:
      Boolean(initialValues) || prefill?.assigneeIds !== undefined,
    setAssigneeIds,
  });
  // The draft's own project, named even before (or without) the list.
  const draftProject =
    draft && selectedProjectId === draft.projectId ? draft.project : null;
  const { data: projectColumns } = useGetColumns(resolvedProjectId);
  // New tasks start in the entry column (the first not-started column).
  const entryColumn = getEntryColumn(projectColumns ?? []);
  // One value per registered create-modal slot (see task-property-slots).
  const [slotValues, setSlotValues] = useState<Record<string, unknown>>(() => ({
    ...(initialValues?.slotValues ?? {}),
  }));
  // Project-bound values belong to the old project; slots of a feature the
  // new project lacks never mount to reset themselves, so clear them here.
  const changeProject = (nextProjectId: string) => {
    if (nextProjectId === selectedProjectId) return;
    setSelectedProjectId(nextProjectId);
    // A parent belongs to its project.
    setParent(null);
    setSlotValues({});
    setDraftStatus(null);
    clearTemplate();
  };

  // Templates belong to a project and never apply to a draft being edited.
  const { data: projectTemplates } = useTaskTemplates(
    workspace?.id ?? "",
    resolvedProjectId,
    { enabled: !draft },
  );
  const templates = draft ? [] : (projectTemplates ?? []);
  const { pointsById: activeEstimatePoints } = useActiveEstimate({
    projectId: resolvedProjectId,
    workspaceId: workspace?.id ?? "",
    enabled: templates.length > 0,
  });

  const searchInputRef = useRef<HTMLInputElement>(null);
  const uploadCreationPromiseRef = useRef<Promise<Task | null> | null>(null);
  const uploadTaskRef = useRef<Task | null>(null);
  const activeRef = useRef(true);
  const submittingRef = useRef(false);
  const [isPreparingUpload, setIsPreparingUpload] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const didSubmitRef = useRef(false);

  const { mutateAsync: createTask } = useCreateTask();
  const { mutateAsync: updateTask } = useUpdateTask();
  const { mutateAsync: deleteTask } = useDeleteTask();
  const { mutateAsync: setTaskParent } = useSetTaskParent();
  const { mutateAsync: createTaskRelation } = useCreateTaskRelation();

  const { data: rawCustomFields } = useGetCustomFieldsByProject(
    resolvedProjectId,
  ) as { data: CustomFieldDefinition[] | undefined };

  const customFields = useMemo(() => rawCustomFields ?? [], [rawCustomFields]);

  const { mutateAsync: setCustomFieldValue } = useSetCustomFieldValue();

  const [customFieldValues, setCustomFieldValues] = useState<
    Record<string, string>
  >(() => ({ ...(initialValues?.customFieldValues ?? {}) }));

  const handleCustomFieldChange = (fieldId: string, value: string) => {
    setCustomFieldValues((prev) => ({
      ...prev,
      [fieldId]: value,
    }));
  };

  // In its own project a draft's stored values stand: blanks stay blank.
  const keepDraftValues =
    Boolean(draft) && resolvedProjectId === (draft?.projectId ?? "");
  useEffect(() => {
    // A draft keeps its values until its project's fields have loaded.
    if (draft && !rawCustomFields) return;
    setCustomFieldValues((previousValues) =>
      Object.fromEntries(
        customFields.map((field) => [
          field.id,
          previousValues[field.id] ??
            (keepDraftValues ? "" : (field.defaultValue ?? "")),
        ]),
      ),
    );
  }, [customFields, draft, rawCustomFields, keepDraftValues]);

  const filteredLabels = (() => {
    const searchFiltered = workspaceLabels.filter((label) =>
      label.name.toLowerCase().includes(searchValue.toLowerCase()),
    );

    const labelMap = new Map<string, (typeof workspaceLabels)[0]>();
    for (const label of searchFiltered) {
      const existing = labelMap.get(label.name);
      if (!existing || (label.taskId === null && existing.taskId !== null)) {
        labelMap.set(label.name, label);
      }
    }

    return Array.from(labelMap.values());
  })();

  const isCreatingNewLabel =
    searchValue &&
    !workspaceLabels.some(
      (label) => label.name.toLowerCase() === searchValue.toLowerCase(),
    );

  const buildDefaultCustomFieldValues = useCallback(() => {
    return customFields.reduce<Record<string, string>>((acc, field) => {
      acc[field.id] = field.defaultValue ?? "";
      return acc;
    }, {});
  }, [customFields]);

  // The form as draft fields: what Save as draft stores, and what edit mode
  // compares with the stored draft.
  const draftFormValues: DraftFormValues = {
    // A draft keeps its stored project even while the project list loads.
    projectId: draft ? selectedProjectId : resolvedProjectId,
    title,
    description,
    status: draft ? draftStatus : (templateStatus ?? status ?? null),
    priority,
    assigneeIds,
    labels,
    startDate,
    dueDate,
    customFieldValues,
    slotValues,
    parentTaskId: parent?.id ?? null,
  };
  const currentDraftFields = formToDraftFields(draftFormValues);
  const draftChanges = baselineFields
    ? diffDraftFields(baselineFields, currentDraftFields)
    : null;

  const hasUnsavedChanges = draftChanges
    ? !isEmptyPatch(draftChanges)
    : Boolean(
        title.trim() ||
          description.trim() ||
          priority !== "no-priority" ||
          !sameIds(assigneeIds, prefillAssignees(defaultAssigneeUserId)) ||
          startDate ||
          dueDate ||
          selectedProjectId ||
          labels.length > 0 ||
          templateSubtasks.length > 0 ||
          uploadTask,
      );

  const discardUploadTask = useCallback(() => {
    const abandoned = uploadTaskRef.current;
    if (abandoned && !didSubmitRef.current) {
      uploadTaskRef.current = null;
      void deleteTask(abandoned.id).catch(() => {
        // An expired session can prevent cleanup; never reuse the task.
      });
    }
  }, [deleteTask]);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      discardUploadTask();
    };
  }, [discardUploadTask]);

  const handleClose = () => {
    activeRef.current = false;
    discardUploadTask();
    setDuplicateOf(null);
    onClose();
  };

  const closeAndReset = () => {
    setDiscardConfirmationOpen(false);
    handleClose();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) return;

    if (hasUnsavedChanges && !didSubmitRef.current) {
      setDiscardConfirmationOpen(true);
      return;
    }

    closeAndReset();
  };

  const syncTaskIntoProject = useCallback(
    (task: Task) => {
      if (!activeRef.current || project?.id !== task.projectId) return;

      const updatedProject = produce(project, (draft) => {
        let existingTask:
          | (typeof draft.columns)[number]["tasks"][number]
          | undefined;

        for (const column of draft.columns ?? []) {
          const taskIndex = column.tasks.findIndex(
            (columnTask) => columnTask.id === task.id,
          );

          if (taskIndex !== -1) {
            existingTask = column.tasks[taskIndex];
            column.tasks.splice(taskIndex, 1);
            break;
          }
        }

        // Planned tasks live outside the columns, and archived ones (which
        // keep their column) leave the board.
        if (task.status === "planned" || task.archivedAt) {
          return;
        }

        const targetColumn = draft.columns?.find(
          (column) => column.id === task.status,
        );
        if (!targetColumn) return;

        const placed = {
          ...existingTask,
          ...task,
          position: task.position ?? 0,
        };
        targetColumn.tasks.push(
          withAssignees(placed, assigneesOfTask(task), people),
        );
      });

      setProject(updatedProject);
    },
    [project, setProject, people],
  );

  const ensureUploadTask = useCallback(async () => {
    if (!activeRef.current || submittingRef.current) return null;
    // Files need a real task; a draft gets them once it is published.
    if (draft) {
      toast.error(t("tasks:drafts.editor.uploadsDisabled"));
      return null;
    }
    if (uploadTaskRef.current) {
      return uploadTaskRef.current.projectId === resolvedProjectId
        ? uploadTaskRef.current.id
        : null;
    }

    if (uploadCreationPromiseRef.current) {
      const pendingTask = await uploadCreationPromiseRef.current;
      return activeRef.current ? (pendingTask?.id ?? null) : null;
    }

    if (!resolvedProjectId) {
      toast.error(t("common:modals.createTask.chooseProjectForImages"));
      return null;
    }

    setIsPreparingUpload(true);
    const uploadStatus = "planned";
    const uploadPromise = createTask({
      title: title.trim() || t("common:modals.createTask.untitledTask"),
      description: description.trim() || "",
      assigneeIds,
      priority,
      projectId: resolvedProjectId,
      startDate: startDate ? startDate.toISOString() : undefined,
      dueDate: dueDate ? dueDate.toISOString() : undefined,
      status: uploadStatus,
      customFields: Object.entries(customFieldValues)
        .filter(([_, value]) => value.trim() !== "")
        .map(([fieldId, value]) => ({
          fieldId,
          value,
        })),
    }).then((task) => {
      const createdTask = normalizeTask(task);
      if (!activeRef.current) {
        void deleteTask(createdTask.id).catch(() => {});
        return null;
      }
      uploadTaskRef.current = createdTask;
      setUploadTask(createdTask);
      return createdTask;
    });

    uploadCreationPromiseRef.current = uploadPromise;

    try {
      const createdTask = await uploadPromise;
      return activeRef.current ? (createdTask?.id ?? null) : null;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("common:modals.createTask.prepareTaskError"),
      );
      return null;
    } finally {
      uploadCreationPromiseRef.current = null;
      if (activeRef.current) setIsPreparingUpload(false);
    }
  }, [
    assigneeIds,
    createTask,
    description,
    deleteTask,
    startDate,
    dueDate,
    priority,
    resolvedProjectId,
    title,
    t,
    customFieldValues,
    draft,
  ]);

  // Duplicate hints while a new task's title is typed (never in a draft's
  // own editor, never blocking).
  const [similarDismissed, setSimilarDismissed] = useState(false);
  const similarTasks = useSimilarTasks(
    resolvedProjectId || undefined,
    title,
    open && !draft && !similarDismissed,
  );
  // "Duplicate of…" picked from the hints; linked once the task exists.
  const [duplicateOf, setDuplicateOf] = useState<SimilarTask | null>(null);

  const { mutateAsync: createDraft } = useCreateTaskDraft();
  const { mutateAsync: updateDraft } = useUpdateTaskDraft();
  const publishDraft = usePublishDraftFlow(workspace?.id ?? "");

  // Drafts can't hold files: Save as draft stops once the upload task exists.
  const blockedByUploads = Boolean(uploadTask) || isPreparingUpload;
  const canSaveAsDraft =
    canCreateTaskCapability &&
    !isSubmitting &&
    !blockedByUploads &&
    hasDraftContent(draftFormValues);
  const canPublish = canPublishDraft(currentDraftFields);

  /** Runs one save at a time and keeps the dialog open on failure. */
  const runDraftSave = async (save: () => Promise<boolean>) => {
    if (!activeRef.current || submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      const done = await save();
      if (done && activeRef.current) {
        didSubmitRef.current = true;
        closeAndReset();
      }
    } finally {
      submittingRef.current = false;
      if (activeRef.current) setIsSubmitting(false);
    }
  };

  const handleSaveAsDraft = () =>
    runDraftSave(async () => {
      const workspaceId = workspace?.id;
      if (!canSaveAsDraft || !workspaceId) return false;
      try {
        await createDraft({ workspaceId, fields: currentDraftFields });
      } catch (error) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : t("tasks:drafts.toast.saveError"),
        );
        return false;
      }
      toast.success(t("tasks:drafts.toast.saved"), {
        action: {
          label: t("tasks:drafts.toast.viewDrafts"),
          onClick: () =>
            navigate({
              to: "/dashboard/workspace/$workspaceId/drafts",
              params: { workspaceId },
            }),
        },
      });
      return true;
    });

  const handleSaveDraft = () =>
    runDraftSave(async () => {
      if (!draft || !draftChanges) return false;
      // Nothing changed: there is nothing to send.
      if (isEmptyPatch(draftChanges)) return true;
      try {
        await updateDraft({
          id: draft.id,
          workspaceId: draft.workspaceId,
          fields: draftChanges,
        });
      } catch (error) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : t("tasks:drafts.toast.saveError"),
        );
        return false;
      }
      toast.success(t("tasks:drafts.toast.updated"));
      return true;
    });

  // Unsaved edits travel with the publish; stored values the server
  // can no longer use are dropped and reported, not refused.
  const handlePublishDraft = () =>
    runDraftSave(async () => {
      if (!draft || !canPublish) return false;
      const outcome = await publishDraft(draft.id, draftChanges ?? {});
      return outcome === "published";
    });

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (draft) {
      void handlePublishDraft();
    } else if (primaryAction === "draft") {
      void handleSaveAsDraft();
    } else {
      void handleSubmit(e);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !activeRef.current ||
      submittingRef.current ||
      !canCreateTaskCapability ||
      !title.trim() ||
      !resolvedProjectId ||
      !workspace?.id
    )
      return;

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      // Submitting while a file prepares its upload task must update it.
      const pendingUpload = uploadCreationPromiseRef.current;
      if (pendingUpload) await pendingUpload;
      if (!activeRef.current) return;
      const currentUpload = uploadTaskRef.current;
      if (currentUpload && currentUpload.projectId !== resolvedProjectId)
        return;
      const taskStatus =
        templateStatus ?? status ?? entryColumn?.slug ?? "to-do";
      didSubmitRef.current = true;

      const savedTask = currentUpload
        ? normalizeTask(
            await updateTask({
              ...currentUpload,
              title: title.trim(),
              description: description.trim() || "",
              userId: assigneeIds[0] ?? null,
              replaceAssigneeIds: assigneeIds,
              status: taskStatus,
              priority,
              startDate: startDate ? startDate.toISOString() : null,
              dueDate: dueDate ? dueDate.toISOString() : null,
              projectId: resolvedProjectId,
              customFieldValues: Object.entries(customFieldValues)
                .filter(([_, value]) => value.trim() !== "")
                .map(([fieldId, value]) => ({ fieldId, value })),
            }),
          )
        : normalizeTask(
            await createTask({
              title: title.trim(),
              description: description.trim() || "",
              assigneeIds,
              priority,
              projectId: resolvedProjectId,
              startDate: startDate ? startDate.toISOString() : undefined,
              dueDate: dueDate ? dueDate.toISOString() : undefined,
              status: taskStatus,
              customFields: Object.entries(customFieldValues)
                .filter(([_, value]) => value.trim() !== "")
                .map(([fieldId, value]) => ({
                  fieldId,
                  value,
                })),
              // Created and linked in one transaction.
              parentId: parent?.id,
            }),
          );

      // The upload task exists already, so its parent is set afterwards.
      if (currentUpload && parent) {
        await setTaskParent({
          taskId: savedTask.id,
          parentTaskId: parent.id,
          projectId: resolvedProjectId,
        });
      }

      for (const label of labels) {
        try {
          await createLabel({
            name: label.name,
            color: label.color,
            taskId: savedTask.id,
            workspaceId: workspace.id,
          });
        } catch (error) {
          console.error("Failed to create label:", error);
        }
      }

      if (currentUpload) {
        for (const [fieldId, value] of Object.entries(customFieldValues)) {
          if (value) {
            await setCustomFieldValue({
              taskId: savedTask.id,
              fieldId,
              value: String(value),
            });
          }
        }
      }

      await runCreateModalSlots({ task: savedTask, values: slotValues });

      if (duplicateOf) {
        try {
          await createTaskRelation({
            sourceTaskId: savedTask.id,
            targetTaskId: duplicateOf.id,
            relationType: "duplicate",
          });
        } catch {
          toast.error(t("ai:duplicates.linkError", { key: duplicateOf.key }));
        }
      }

      // The template's checklist, in order, under the saved task. The task
      // exists either way, so a failed sub-task is reported, not thrown.
      let failedSubtasks = 0;
      for (const subtaskTitle of canPickParent ? templateSubtasks : []) {
        try {
          await createTask({
            title: subtaskTitle,
            description: "",
            assigneeIds: [],
            priority: "no-priority",
            projectId: resolvedProjectId,
            status: entryColumn?.slug ?? "to-do",
            parentId: savedTask.id,
          });
        } catch {
          failedSubtasks += 1;
        }
      }
      if (failedSubtasks > 0) {
        toast.error(t("templates:use.subtaskError", { count: failedSubtasks }));
      }

      uploadTaskRef.current = null;
      if (!activeRef.current) return;
      setUploadTask(savedTask);
      syncTaskIntoProject(savedTask);
      toast.success(
        uploadTask
          ? t("common:modals.createTask.successUpdated")
          : t("common:modals.createTask.successCreated"),
      );

      if (createMore) {
        setTitle("");
        setSimilarDismissed(false);
        setDuplicateOf(null);
        setDescription("");
        setPriority("no-priority");
        assigneePrefill.reset();
        setStartDate(undefined);
        setDueDate(undefined);
        setLabels([]);
        setLabelsStep("select");
        setSearchValue("");
        setSelectedColor("gray");
        setNewLabelName("");
        uploadCreationPromiseRef.current = null;
        setEditorVersion((version) => version + 1);
        didSubmitRef.current = false;
        setUploadTask(null);
        setCustomFieldValues(buildDefaultCustomFieldValues());
        setSlotValues({});
        clearTemplate();
      } else {
        closeAndReset();
      }
    } catch (error) {
      didSubmitRef.current = false;
      if (!activeRef.current) {
        discardUploadTask();
        return;
      }
      toast.error(
        error instanceof Error
          ? error.message
          : t("common:modals.createTask.createError"),
      );
    } finally {
      submittingRef.current = false;
      if (activeRef.current) setIsSubmitting(false);
    }
  };

  const priorityOptions = useMemo(
    () =>
      (["no-priority", "low", "medium", "high", "urgent"] as const).map(
        (value) => ({
          value,
          label: t(`tasks:priority.${value}`),
        }),
      ),
    [t],
  );

  const selectedPriority = priorityOptions.find((p) => p.value === priority);

  const shownStatus = draft
    ? (draftStatus ?? undefined)
    : (templateStatus ?? status);
  const statusLabel = useMemo(() => {
    if (shownStatus) {
      return (
        projectColumns?.find((column) => column.slug === shownStatus)?.name ??
        t(`tasks:status.${shownStatus}`)
      );
    }
    return entryColumn?.name ?? t("tasks:status.in-progress");
  }, [shownStatus, t, projectColumns, entryColumn?.name]);
  const selectedAssignees = resolveAssignees(assigneeIds, people);

  /** Fills the form from a template; everything stays editable after. */
  const pickTemplate = (template: TaskTemplate) => {
    const fill = fillFormFromTemplate(
      template,
      { title, description, priority, assigneeIds, labels },
      appliedTemplate?.trace ?? null,
    );
    setTitle(fill.title);
    setDescription(fill.description);
    setPriority(fill.priority as Priority);
    if (fill.assigneeIds) {
      assigneePrefill.markTouched();
      setAssigneeIds(fill.assigneeIds);
    }
    if (fill.addLabels.length > 0) {
      setLabels((current) => [
        ...current,
        ...fill.addLabels.map((label) => ({
          ...label,
          taskId: null,
          workspaceId: workspace?.id ?? "",
          createdAt: "",
        })),
      ]);
    }
    setTemplateStatus(fill.status);
    // "estimate" is the estimates slice's create-modal slot; its chip shows
    // the value, and only a point of the active system (with task:update)
    // can be set after the create.
    const pointId = fill.estimatePointId;
    if (pointId && canPickParent && activeEstimatePoints.has(pointId)) {
      setSlotValues((previous) => ({ ...previous, estimate: pointId }));
    }
    setTemplateSubtasks(canPickParent ? fill.subtasks : []);
    setAppliedTemplate({ name: template.name, trace: fill.trace });
  };

  useEffect(() => {
    if (labelsOpen && labelsStep === "select" && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [labelsOpen, labelsStep]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open || discardConfirmationOpen) return;

      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (title.trim() && resolvedProjectId && workspace?.id) {
          const form = document.querySelector("form");
          if (form) {
            form.dispatchEvent(
              new Event("submit", { cancelable: true, bubbles: true }),
            );
          }
        }
      }
    },
    [open, discardConfirmationOpen, title, resolvedProjectId, workspace?.id],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const resetLabelsPopover = () => {
    setLabelsStep("select");
    setSearchValue("");
    setNewLabelName("");
    setSelectedColor("gray");
  };

  const handleLabelsClose = () => {
    setLabelsOpen(false);
    setTimeout(resetLabelsPopover, 200);
  };

  const toggleLabel = (labelName: string) => {
    const existingLabel = labels.find((l) => l.name === labelName);
    if (existingLabel) {
      setLabels(labels.filter((l) => l.name !== labelName));
    } else {
      const workspaceLabel = workspaceLabels.find((l) => l.name === labelName);
      if (workspaceLabel) {
        setLabels([
          ...labels,
          {
            id: workspaceLabel.id,
            name: workspaceLabel.name,
            color: workspaceLabel.color,
            taskId: null,
            workspaceId: workspaceLabel.workspaceId || "",
            createdAt: workspaceLabel.createdAt,
          },
        ]);
      }
    }
  };

  const handleCreateNewClick = () => {
    setNewLabelName(searchValue);
    setLabelsStep("color");
  };

  const handleColorSelect = async (color: LabelColor) => {
    setSelectedColor(color);

    if (!newLabelName.trim() || !workspace?.id) return;

    try {
      const createdLabel = await createLabel({
        name: newLabelName.trim(),
        color: color,
        workspaceId: workspace.id,
      });

      const newLabel: Label = {
        id: createdLabel.id,
        name: createdLabel.name,
        color: createdLabel.color,
        taskId: createdLabel.taskId ?? null,
        workspaceId: createdLabel.workspaceId ?? workspace.id,
        createdAt: createdLabel.createdAt,
      };

      setLabels([...labels, newLabel]);
      toast.success(t("common:modals.createTask.labelCreated"));
      handleLabelsClose();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("common:modals.createTask.labelCreateError"),
      );
    }
  };

  const removeLabel = (labelName: string) => {
    setLabels(labels.filter((l) => l.name !== labelName));
  };

  const renderCustomFieldInput = (field: CustomFieldDefinition) => {
    const value = customFieldValues[field.id] ?? "";

    switch (field.type) {
      case "dropdown": {
        const options = field.options || [];

        return (
          <Select
            value={value}
            onValueChange={(val) =>
              handleCustomFieldChange(field.id, val as string)
            }
          >
            <SelectTrigger className="h-9 w-full text-sm bg-background">
              <SelectValue
                placeholder={t(
                  "common:modals.createTask.selectOptionPlaceholder",
                  "Select an option",
                )}
              />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }

      case "date":
        return (
          <Input
            type="date"
            value={value}
            onChange={(e) => handleCustomFieldChange(field.id, e.target.value)}
            required={field.required}
            className="h-9 w-full text-sm bg-background"
          />
        );

      case "number":
        return (
          <Input
            type="number"
            value={value}
            onChange={(e) => handleCustomFieldChange(field.id, e.target.value)}
            placeholder={field.defaultValue || ""}
            required={field.required}
            className="h-9 w-full text-sm bg-background"
          />
        );

      case "boolean":
        return (
          <div className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm">
            <span className="text-sm text-foreground capitalize">{value}</span>

            <Switch
              checked={value === "true"}
              onCheckedChange={(checked) =>
                handleCustomFieldChange(field.id, checked ? "true" : "false")
              }
            />
          </div>
        );

      default:
        return (
          <Input
            type="text"
            value={value}
            onChange={(e) => handleCustomFieldChange(field.id, e.target.value)}
            placeholder={field.defaultValue || ""}
            required={field.required}
            className="h-9 w-full text-sm bg-background"
          />
        );
    }
  };

  // Defense-in-depth: if the user lacks task-create permission, don't render
  // the modal even if a stale trigger somehow opens it (e.g., keyboard
  // shortcut after the capability has changed).
  if (!canCreateTaskCapability) return null;

  const renderSaveAsDraftButton = (variant: "outline" | "default") => (
    <WithTooltip
      tooltip={
        blockedByUploads
          ? t("common:modals.createTask.saveAsDraftUploads")
          : null
      }
    >
      <Button
        type="button"
        variant={variant}
        size="sm"
        disabled={!canSaveAsDraft}
        onClick={() => void handleSaveAsDraft()}
      >
        <FilePen className="size-4" />
        {t("common:modals.createTask.saveAsDraft")}
      </Button>
    </WithTooltip>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="margaya-create-task-modal max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        showCloseButton={false}
      >
        <DialogHeader className="flex-shrink-0">
          <DialogTitle asChild>
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="text-muted-foreground font-semibold tracking-wider text-sm">
                  {(
                    resolvedProject?.slug ?? draftProject?.slug
                  )?.toUpperCase() ||
                    t("common:modals.createTask.breadcrumbTask")}
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem className="text-foreground font-medium text-sm">
                  {draft
                    ? t("tasks:drafts.editor.title")
                    : t("common:modals.createTask.title")}
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("common:modals.createTask.description")}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleFormSubmit}
          className="flex flex-col flex-1 min-h-0 space-y-6"
        >
          <div className="flex-1 min-h-0 overflow-y-auto space-y-6 px-6">
            <Input
              unstyled
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              placeholder={t("common:modals.createTask.taskTitlePlaceholder")}
              className="w-full [&_[data-slot=input]]:h-auto [&_[data-slot=input]]:px-0 [&_[data-slot=input]]:py-3 [&_[data-slot=input]]:text-2xl [&_[data-slot=input]]:leading-tight [&_[data-slot=input]]:font-semibold [&_[data-slot=input]]:tracking-tight [&_[data-slot=input]]:text-foreground [&_[data-slot=input]]:placeholder:text-muted-foreground [&_[data-slot=input]]:outline-none"
              required
            />

            {!similarDismissed && similarTasks.length > 0 && (
              <SimilarTaskHints
                tasks={similarTasks}
                taskHref={(similarTaskId) =>
                  `/dashboard/workspace/${workspace?.id ?? ""}/project/${resolvedProjectId}/task/${similarTaskId}`
                }
                onDismiss={() => setSimilarDismissed(true)}
                ai={
                  resolvedProjectId
                    ? { projectId: resolvedProjectId, title, description }
                    : undefined
                }
                onMarkDuplicate={canUpdateTasks() ? setDuplicateOf : undefined}
                markedId={duplicateOf?.id ?? null}
              />
            )}
            {duplicateOf && !draft && (
              <p className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                {t("ai:duplicates.willLink", { key: duplicateOf.key })}
                <button
                  type="button"
                  className="rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setDuplicateOf(null)}
                >
                  {t("ai:duplicates.undo")}
                </button>
              </p>
            )}

            <div className="min-h-[200px] space-y-2">
              <AiTaskWriter
                workspaceId={workspace?.id || ""}
                projectId={resolvedProjectId || null}
                title={title}
                description={description}
                onUse={(markdown) => {
                  setDescription(markdown);
                  // The editor takes its value on mount.
                  setEditorVersion((version) => version + 1);
                }}
              />
              <TaskDescriptionEditor
                key={editorVersion}
                value={description}
                onChange={setDescription}
                placeholder={t(
                  "common:modals.createTask.descriptionPlaceholder",
                )}
                taskId={uploadTask?.id}
                ensureTaskId={ensureUploadTask}
                allowFileUploads={!draft}
                fileUploadsDisabledMessage={t(
                  "tasks:drafts.editor.uploadsDisabled",
                )}
              />
            </div>

            {customFields.length > 0 && (
              <div className="space-y-4 pt-4 border-t border-border">
                <h4 className="text-sm font-semibold text-foreground">
                  {t("tasks:common.customFields")}
                </h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  {customFields.map((field) => (
                    <div
                      key={`custom-field_${field.id}`}
                      className="space-y-1.5"
                    >
                      <label
                        htmlFor={`custom-field_${field.id}`}
                        className="text-xs font-medium text-muted-foreground flex items-center gap-1"
                      >
                        {field.name}
                        {field.required && (
                          <span className="text-destructive">*</span>
                        )}
                      </label>
                      {renderCustomFieldInput(field)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {resolvedProjectId && (
              <LiveLabelSuggestions
                projectId={resolvedProjectId}
                title={title}
                description={description}
                selectedLabelIds={labels.map((label) => label.id)}
                enabled={canCreateLabelCapability || canUpdateTasks()}
                onAdd={(label) => toggleLabel(label.name)}
              />
            )}
            {labels.length > 0 && (
              <div className="flex flex-wrap mb-2">
                {labels.map((label) => (
                  <Badge
                    key={label.name}
                    color={label.color}
                    variant="outline"
                    className="flex items-center gap-1 pl-3 cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => removeLabel(label.name)}
                  >
                    <span
                      className="inline-block w-2 h-2 mr-1.5 rounded-full"
                      style={{
                        backgroundColor: resolveLabelColor(label.color),
                      }}
                    />
                    <span className="max-w-20 truncate">{label.name}</span>
                  </Badge>
                ))}
              </div>
            )}

            {templateSubtasks.length > 0 && (
              <section
                aria-labelledby="create-task-template-subtasks"
                className="space-y-1"
              >
                <h4
                  id="create-task-template-subtasks"
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
                >
                  <ListTree aria-hidden className="w-3.5 h-3.5" />
                  {t("templates:use.subtasksTitle", {
                    count: templateSubtasks.length,
                  })}
                </h4>
                <ul className="space-y-0.5">
                  {templateSubtasks.map((subtaskTitle, index) => (
                    <li
                      // biome-ignore lint/suspicious/noArrayIndexKey: titles may repeat; the order is the identity
                      key={index}
                      className="group flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent/40"
                    >
                      <span
                        aria-hidden
                        className="size-3.5 shrink-0 rounded-full border border-border"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {subtaskTitle}
                      </span>
                      <button
                        type="button"
                        disabled={isSubmitting}
                        aria-label={t("templates:use.removeSubtask", {
                          title: subtaskTitle,
                        })}
                        className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() =>
                          setTemplateSubtasks((current) =>
                            current.filter((_, at) => at !== index),
                          )
                        }
                      >
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="flex flex-wrap items-center gap-2 py-2">
              {!explicitProjectId && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors border border-border hover:bg-accent/50",
                        resolvedProjectId
                          ? "bg-accent/30 text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      <FolderKanban className="w-3.5 h-3.5" />
                      <span>
                        {resolvedProject?.name ||
                          draftProject?.name ||
                          t("common:modals.createTask.selectProject")}
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-1" align="start">
                    <div className="space-y-1">
                      {draft && selectedProjectId && (
                        <button
                          type="button"
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/50 text-left transition-colors h-8"
                          disabled={isSubmitting}
                          onClick={() => changeProject("")}
                        >
                          {t("tasks:drafts.noProject")}
                        </button>
                      )}
                      {workspaceProjects?.map((workspaceProject) => (
                        <button
                          key={workspaceProject.id}
                          type="button"
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent/50 text-left transition-colors h-8"
                          disabled={
                            isPreparingUpload || !!uploadTask || isSubmitting
                          }
                          onClick={() => {
                            if (
                              !uploadCreationPromiseRef.current &&
                              !uploadTaskRef.current &&
                              !submittingRef.current
                            ) {
                              changeProject(workspaceProject.id);
                            }
                          }}
                        >
                          <span className="text-sm truncate">
                            {workspaceProject.name}
                          </span>
                          {resolvedProjectId === workspaceProject.id && (
                            <Check className="ml-auto h-4 w-4 shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
              {templates.length > 0 && (
                <TemplateMenu
                  templates={templates}
                  onPick={pickTemplate}
                  trigger={
                    <button
                      type="button"
                      disabled={isSubmitting}
                      aria-label={
                        appliedTemplate
                          ? t("templates:use.applied", {
                              name: appliedTemplate.name,
                            })
                          : t("templates:use.menuLabel")
                      }
                      className={cn(
                        "flex max-w-48 items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors border border-border hover:bg-accent/50",
                        appliedTemplate
                          ? "bg-accent/30 text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      <LayoutTemplate className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">
                        {appliedTemplate?.name ?? t("templates:use.button")}
                      </span>
                    </button>
                  }
                />
              )}
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-accent/50 text-foreground rounded-md text-xs font-medium border border-border">
                <div className="w-1.5 h-1.5 bg-foreground rounded-full" />
                {statusLabel}
              </div>

              {canPickParent && resolvedProjectId && (
                <Popover open={parentOpen} onOpenChange={setParentOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      aria-label={
                        parent
                          ? t("tasks:parent.tooltip", {
                              key: parent.key,
                              title: parent.title,
                            })
                          : t("tasks:parent.add")
                      }
                      className={cn(
                        "flex max-w-56 items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors border border-border hover:bg-accent/50",
                        parent
                          ? "bg-accent/30 text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      <ListTree className="w-3.5 h-3.5 shrink-0" />
                      {parent ? (
                        <>
                          <span className="shrink-0 font-mono">
                            {parent.key}
                          </span>
                          <span className="min-w-0 truncate">
                            {parent.title}
                          </span>
                        </>
                      ) : (
                        <span>{t("tasks:parent.add")}</span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-72 max-w-[calc(100vw-2rem)] p-0"
                    align="start"
                  >
                    {parentOpen && (
                      <ParentTaskOptions
                        projectId={resolvedProjectId}
                        current={parent}
                        candidates={everyTask}
                        onChoose={(next) => {
                          setParent(next);
                          setParentOpen(false);
                        }}
                      />
                    )}
                  </PopoverContent>
                </Popover>
              )}

              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors border border-border hover:bg-accent/50",
                      startDate
                        ? "bg-accent/30 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="w-3.5 h-3.5" />
                    <span>
                      {startDate
                        ? formatDateMedium(startDate)
                        : t("common:modals.createTask.startDate")}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={setStartDate}
                    className="w-full bg-popover"
                  />
                  {startDate && (
                    <div className="p-2 border-t border-border">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full text-xs"
                        onClick={() => setStartDate(undefined)}
                      >
                        {t("common:modals.createTask.clearStartDate")}
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors border border-border hover:bg-accent/50",
                      priority !== "no-priority"
                        ? "bg-accent/30 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {getPriorityIcon(priority)}
                    <span>
                      {selectedPriority
                        ? selectedPriority.label
                        : t("common:modals.createTask.priority")}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="start">
                  <div className="space-y-1">
                    {priorityOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent/50 text-left transition-colors h-8"
                        onClick={() => setPriority(option.value as Priority)}
                      >
                        {getPriorityIcon(option.value)}
                        <span className="text-sm">{option.label}</span>
                        {priority === option.value && (
                          <Check className="ml-auto h-4 w-4" />
                        )}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors border border-border hover:bg-accent/50",
                      selectedAssignees.length > 0
                        ? "bg-accent/30 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {selectedAssignees.length > 0 ? (
                      <>
                        <AssigneeAvatarStack
                          assignees={selectedAssignees}
                          max={2}
                          size="xs"
                        />
                        <span className="max-w-40 truncate">
                          {formatAssigneeSummary(selectedAssignees, t)}
                        </span>
                      </>
                    ) : (
                      <>
                        <UserIcon className="w-3.5 h-3.5" />
                        <span>{t("common:modals.createTask.assign")}</span>
                      </>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-0" align="start">
                  <AssigneeMultiSelect
                    workspaceId={workspace?.id ?? ""}
                    selectedIds={assigneeIds}
                    onToggle={(userId, nextChecked) => {
                      assigneePrefill.markTouched();
                      setAssigneeIds((current) =>
                        nextChecked
                          ? [...current.filter((id) => id !== userId), userId]
                          : current.filter((id) => id !== userId),
                      );
                    }}
                    onClear={() => {
                      assigneePrefill.markTouched();
                      setAssigneeIds([]);
                    }}
                  />
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors border border-border hover:bg-accent/50",
                      dueDate
                        ? "bg-accent/30 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="w-3.5 h-3.5" />
                    <span>
                      {dueDate
                        ? formatDateMedium(dueDate)
                        : t("common:modals.createTask.dueDate")}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dueDate}
                    onSelect={setDueDate}
                    className="w-full bg-popover"
                  />
                  {dueDate && (
                    <div className="p-2 border-t border-border">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full text-xs"
                        onClick={() => setDueDate(undefined)}
                      >
                        {t("common:modals.createTask.clearDueDate")}
                      </Button>
                    </div>
                  )}
                </PopoverContent>
              </Popover>

              <Popover open={labelsOpen} onOpenChange={setLabelsOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors border border-border hover:bg-accent/50",
                      labels.length > 0
                        ? "bg-accent/30 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <Tag className="w-3.5 h-3.5" />
                    <span>{t("common:modals.createTask.labels")}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="p-0" align="start">
                  {labelsStep === "select" && (
                    <div className="w-auto">
                      <div className="flex items-center gap-2 p-2 border-b border-border">
                        <Search className="w-3 h-3 text-muted-foreground" />
                        <input
                          ref={searchInputRef}
                          value={searchValue}
                          onChange={(e) => setSearchValue(e.target.value)}
                          placeholder={t(
                            "common:modals.createTask.searchLabels",
                          )}
                          className="w-full bg-transparent border-none text-foreground text-xs focus:outline-none placeholder:text-muted-foreground"
                        />
                      </div>

                      <div className="py-1">
                        {filteredLabels.length === 0 &&
                          searchValue.length === 0 && (
                            <span className="text-xs text-muted-foreground px-2">
                              {t("common:modals.createTask.noLabelsFound")}
                            </span>
                          )}
                        {filteredLabels.map((label) => (
                          <button
                            key={label.id}
                            type="button"
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent/50 text-left"
                            onClick={() => toggleLabel(label.name)}
                          >
                            <div className="flex-shrink-0 w-3 flex justify-center">
                              {labels.some((l) => l.name === label.name) && (
                                <Check className="w-3 h-3" />
                              )}
                            </div>
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{
                                backgroundColor: resolveLabelColor(label.color),
                              }}
                            />
                            <span className="max-w-20 truncate">
                              {label.name}
                            </span>
                          </button>
                        ))}

                        {canCreateLabelCapability &&
                          isCreatingNewLabel &&
                          filteredLabels.length > 0 && (
                            <div className="border-t border-border my-1" />
                          )}
                        {canCreateLabelCapability && isCreatingNewLabel && (
                          <button
                            type="button"
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent/50 text-left"
                            onClick={handleCreateNewClick}
                          >
                            <div className="flex-shrink-0 w-3 flex justify-center">
                              <Plus className="w-3 h-3" />
                            </div>
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{
                                backgroundColor:
                                  labelColors.find(
                                    (c) => c.value === selectedColor,
                                  )?.color || "var(--color-neutral-400)",
                              }}
                            />
                            <span className="truncate">
                              {t("common:modals.createTask.createLabel", {
                                name: searchValue,
                              })}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {labelsStep === "color" && (
                    <div className="w-auto">
                      <div className="flex items-center justify-between p-2 border-b border-border">
                        <span className="text-xs font-medium">
                          {t("common:modals.createTask.chooseColor")}
                        </span>
                        <button
                          type="button"
                          onClick={() => setLabelsStep("select")}
                          className="w-4 h-4 flex items-center justify-center hover:bg-accent/50 rounded"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>

                      <div className="py-1">
                        {labelColors.map((color) => (
                          <button
                            key={color.value}
                            type="button"
                            className={cn(
                              "w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent/50 text-left",
                              selectedColor === color.value && "bg-accent/30",
                            )}
                            onClick={() =>
                              handleColorSelect(color.value as LabelColor)
                            }
                          >
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: color.color }}
                            />
                            <span className="truncate">{color.label}</span>
                            {selectedColor === color.value && (
                              <Check className="w-3 h-3 ml-auto" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </PopoverContent>
              </Popover>

              <TaskPropertySlotOutlet
                location="createModal"
                projectId={resolvedProjectId}
                workspaceId={workspace?.id ?? ""}
                props={(slot) => ({
                  value: slotValues[slot.id],
                  onChange: (value: unknown) =>
                    setSlotValues((previous) => ({
                      ...previous,
                      [slot.id]: value,
                    })),
                })}
              />
            </div>
          </div>

          <DialogFooter className="flex-shrink-0 border-t border-border bg-background px-6 py-4">
            <div className="flex items-center gap-3 mr-auto">
              {draft ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={isSubmitting}
                  onClick={() => setDeleteDraftOpen(true)}
                >
                  <Trash2 className="size-4" />
                  {t("tasks:drafts.editor.deleteDraft")}
                </Button>
              ) : (
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                  <input
                    type="checkbox"
                    checked={createMore}
                    onChange={(e) => setCreateMore(e.target.checked)}
                    className="rounded border-border bg-background text-primary focus:ring-ring focus:ring-offset-0 focus:ring-2 transition-[border-color,box-shadow]"
                  />
                  {t("common:modals.createTask.createMore")}
                </label>
              )}
            </div>

            <Button
              type="button"
              onClick={() => handleOpenChange(false)}
              variant="outline"
              size="sm"
              className="border-border text-foreground hover:bg-accent"
            >
              {t("common:actions.cancel")}
            </Button>
            {draft ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSubmitting}
                  onClick={() => void handleSaveDraft()}
                >
                  {t("tasks:drafts.editor.saveDraft")}
                </Button>
                <WithTooltip
                  tooltip={
                    canPublish ? null : t("tasks:drafts.editor.publishDisabled")
                  }
                >
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!canPublish || isSubmitting}
                  >
                    {t("tasks:drafts.editor.publish")}
                  </Button>
                </WithTooltip>
              </>
            ) : (
              <>
                {primaryAction === "create" &&
                  renderSaveAsDraftButton("outline")}
                <Button
                  type={primaryAction === "create" ? "submit" : "button"}
                  variant={primaryAction === "create" ? "default" : "outline"}
                  disabled={!title.trim() || !resolvedProjectId || isSubmitting}
                  size="sm"
                  className="disabled:opacity-50"
                  onClick={
                    primaryAction === "create"
                      ? undefined
                      : (event) => void handleSubmit(event)
                  }
                >
                  {t("common:modals.createTask.createButton")}
                </Button>
                {primaryAction === "draft" &&
                  renderSaveAsDraftButton("default")}
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>

      <AlertDialog
        open={discardConfirmationOpen}
        onOpenChange={setDiscardConfirmationOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {draft
                ? t("tasks:drafts.editor.unsavedTitle")
                : t("common:modals.createTask.discardTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {draft
                ? t("tasks:drafts.editor.unsavedDescription")
                : t("common:modals.createTask.discardDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button type="button" variant="outline" size="sm" />}
            >
              {t("common:actions.cancel")}
            </AlertDialogClose>
            {draft ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={closeAndReset}
                >
                  {t("tasks:drafts.editor.discardChanges")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={isSubmitting}
                  onClick={() => void handleSaveDraft()}
                >
                  {t("tasks:drafts.editor.save")}
                </Button>
              </>
            ) : (
              <>
                {renderSaveAsDraftButton("outline")}
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={closeAndReset}
                >
                  {t("common:modals.createTask.discardButton")}
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {draft && (
        <DeleteDraftDialog
          draft={draft}
          open={deleteDraftOpen}
          onOpenChange={setDeleteDraftOpen}
          onDeleted={() => {
            didSubmitRef.current = true;
            closeAndReset();
          }}
        />
      )}
    </Dialog>
  );
}

/** Wraps a control in a tooltip that explains why it is disabled. */
function WithTooltip({
  tooltip,
  children,
}: {
  tooltip: string | null;
  children: React.ReactElement;
}) {
  if (!tooltip) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function CreateTaskModal(props: CreateTaskModalProps) {
  const { data: workspace } = useActiveWorkspace();
  const location = useLocation();
  const routeWorkspaceId = useParams({
    strict: false,
    select: (params) =>
      "workspaceId" in params && typeof params.workspaceId === "string"
        ? params.workspaceId
        : undefined,
  });
  // useActiveWorkspace may temporarily fall back to the previous organization
  // while the new route's organization list is loading.
  if (!props.open || (routeWorkspaceId && routeWorkspaceId !== workspace?.id))
    return null;

  // Closing or navigating ends the whole editing session, including pending
  // upload tasks, instead of carrying confidential fields into a new context.
  return (
    <CreateTaskModalContent
      key={JSON.stringify([
        workspace?.id,
        location.pathname,
        props.projectId,
        props.draft?.id,
      ])}
      {...props}
    />
  );
}

export default CreateTaskModal;

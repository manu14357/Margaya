import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
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
import { Skeleton } from "@/components/ui/skeleton";
import useCopyTask from "@/hooks/mutations/task-copy/use-copy-task";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import {
  COPY_OPTION_LABEL_KEYS,
  type CopyOptionKey,
  copyInclude,
  DEFAULT_COPY_CHOICES,
  isCopyOption,
  visibleCopyOptions,
} from "@/lib/copy-task-options";
import { formatTaskKey } from "@/lib/task-key";
import { toast } from "@/lib/toast";
import type { CopyTaskTarget } from "@/store/copy-task-dialog";
import { useCopySource } from "./use-copy-source";

type CopyTaskDialogProps = {
  target: CopyTaskTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * "Make a copy": a new task from this one, in this or another project of the
 * workspace, with the chosen title and properties. Options the source has
 * nothing for are not listed.
 */
export default function CopyTaskDialog({
  target,
  open,
  onOpenChange,
}: CopyTaskDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { workspaceId } = target;
  const source = useCopySource(target);
  const { data: projects, isLoading: projectsLoading } = useGetProjects({
    workspaceId,
  });
  const copyTask = useCopyTask();
  const idPrefix = useId();
  const [title, setTitle] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [choices, setChoices] = useState(DEFAULT_COPY_CHOICES);

  const sourceTitle = source.task?.title;
  useEffect(() => {
    if (sourceTitle !== undefined && title === null) {
      setTitle(t("tasks:copy.titleSuffix", { title: sourceTitle }));
    }
  }, [sourceTitle, title, t]);

  const targetProjectId = projectId ?? source.sourceProjectId;
  const sameProject = targetProjectId === source.sourceProjectId;
  const visible = visibleCopyOptions(source.sourceHas, sameProject);
  const key =
    source.project && source.task
      ? formatTaskKey(source.project.slug, source.task.number)
      : "";

  // The current project first, then the others as listed.
  const projectOptions = useMemo(() => {
    const list = projects ?? [];
    const current = list.filter((p) => p.id === source.sourceProjectId);
    const others = list.filter((p) => p.id !== source.sourceProjectId);
    return [...current, ...others];
  }, [projects, source.sourceProjectId]);
  const selectedProject = projectOptions.find(
    (project) => project.id === targetProjectId,
  );

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = (title ?? "").trim();
    if (!trimmed) {
      setTitleError(t("tasks:copy.titleRequired"));
      return;
    }
    const include = copyInclude(visible, choices);
    copyTask.mutate(
      {
        taskId: target.taskId,
        projectId: targetProjectId,
        title: trimmed,
        include,
        parentTaskId: source.parentTaskId,
      },
      {
        onSuccess: (result) => {
          onOpenChange(false);
          const skipped = result.skipped
            .filter(isCopyOption)
            .map((option) => t(COPY_OPTION_LABEL_KEYS[option]));
          toast.success(t("tasks:copy.toast.success", { key: result.key }), {
            description:
              skipped.length > 0
                ? t("tasks:copy.toast.skipped", { list: skipped.join(" · ") })
                : undefined,
            action: {
              label: t("tasks:copy.toast.open"),
              onClick: () =>
                navigate({
                  to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
                  params: {
                    workspaceId,
                    projectId: result.task.projectId,
                    taskId: result.task.id,
                  },
                }),
            },
          });
        },
        onError: (error) => {
          toast.error(error.message || t("tasks:copy.toast.error"));
        },
      },
    );
  };

  const toggle = (option: CopyOptionKey, checked: boolean) =>
    setChoices((current) => ({ ...current, [option]: checked }));

  const isPending = copyTask.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !isPending && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>{t("tasks:copy.title", { key })}</DialogTitle>
          </DialogHeader>
          <fieldset
            disabled={isPending}
            className="flex flex-col gap-4 p-6 pt-1"
          >
            <div className="space-y-2">
              <Label htmlFor="copy-task-title">
                {t("tasks:copy.titleLabel")}
              </Label>
              <Input
                id="copy-task-title"
                autoFocus
                value={title ?? ""}
                aria-invalid={titleError ? true : undefined}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setTitleError(null);
                }}
              />
              {titleError && (
                <p className="text-destructive-foreground text-xs">
                  {titleError}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="copy-task-project">
                {t("tasks:copy.projectLabel")}
              </Label>
              {projectsLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select
                  value={targetProjectId}
                  onValueChange={(value) => {
                    if (typeof value === "string") setProjectId(value);
                  }}
                  disabled={isPending}
                >
                  <SelectTrigger id="copy-task-project" className="w-full">
                    <SelectValue>
                      {selectedProject?.name ?? source.project?.name}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {projectOptions.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {!sameProject && (
                <p className="text-muted-foreground text-xs">
                  {t("tasks:copy.otherProjectHint")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <p className="font-medium text-foreground text-sm">
                {t("tasks:copy.includeLabel")}
              </p>
              {visible.length > 0 && (
                <div className="flex flex-col gap-2">
                  {visible.map((option) => (
                    <label
                      key={option}
                      htmlFor={`${idPrefix}-${option}`}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        id={`${idPrefix}-${option}`}
                        checked={choices[option]}
                        onCheckedChange={(checked) =>
                          toggle(option, checked === true)
                        }
                      />
                      <span>{t(COPY_OPTION_LABEL_KEYS[option])}</span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-muted-foreground text-xs">
                {t("tasks:copy.alwaysCopied")}
              </p>
            </div>
          </fieldset>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
            >
              {t("tasks:copy.cancel")}
            </Button>
            <Button type="submit" loading={isPending} disabled={!source.ready}>
              {t("tasks:copy.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

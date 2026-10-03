import { Check, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { isProjectFeatureEnabled } from "@/constants/project-features";
import { useMovePageToProject } from "@/hooks/mutations/page/use-move-page-to-project";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { cn } from "@/lib/cn";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";
import type { PageSummary } from "@/types/page";

type MovePageDialogProps = {
  page: Pick<PageSummary, "id" | "projectId">;
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After the move, with the project the page now lives in. */
  onMoved?: (projectId: string) => void;
};

/** Moves a page and its sub-pages to another project with Pages on. */
export default function MovePageDialog({
  page,
  workspaceId,
  open,
  onOpenChange,
  onMoved,
}: MovePageDialogProps) {
  const { t } = useTranslation();
  const { data: projects = [] } = useGetProjects({ workspaceId });
  const movePage = useMovePageToProject();
  const [query, setQuery] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setTargetId(null);
  }, [open]);

  const targets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.filter(
      (project) =>
        project.id !== page.projectId &&
        !project.archivedAt &&
        isProjectFeatureEnabled(project, "pages") &&
        project.name.toLowerCase().includes(needle),
    );
  }, [page.projectId, projects, query]);

  const handleMove = () => {
    const target = projects.find((project) => project.id === targetId);
    if (!target || !page.projectId) return;
    movePage.mutate(
      {
        pageId: page.id,
        projectId: page.projectId,
        targetProjectId: target.id,
      },
      {
        onSuccess: () => {
          toast.success(t("pages:toasts.moved", { project: target.name }));
          onOpenChange(false);
          onMoved?.(target.id);
        },
        onError: (error) => {
          toast.error(pageErrorMessage(error) ?? t("pages:toasts.moveError"));
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !movePage.isPending && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("pages:moveDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("pages:moveDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 px-6 pb-2">
          <div className="relative">
            <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("pages:moveDialog.searchPlaceholder")}
              aria-label={t("pages:moveDialog.searchPlaceholder")}
              className="[&_[data-slot=input]]:pl-8"
            />
          </div>
          <div
            role="listbox"
            aria-label={t("pages:moveDialog.title")}
            className="max-h-64 space-y-0.5 overflow-y-auto"
          >
            {targets.length === 0 ? (
              <p className="py-6 text-center text-muted-foreground text-sm">
                {t("pages:moveDialog.empty")}
              </p>
            ) : (
              targets.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  role="option"
                  aria-selected={project.id === targetId}
                  onClick={() => setTargetId(project.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                    project.id === targetId && "bg-accent",
                  )}
                >
                  <span className="truncate">{project.name}</span>
                  {project.id === targetId && (
                    <Check className="size-4 shrink-0 text-primary" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={movePage.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("pages:moveDialog.cancel")}
          </Button>
          <Button
            disabled={!targetId}
            loading={movePage.isPending}
            onClick={handleMove}
          >
            {t("pages:moveDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { ArrowRightLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useBulkOperations } from "@/hooks/mutations/task/use-bulk-operations";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import type { BulkAssigneeGroup } from "./use-bulk-assignee-groups";

type Options = {
  workspaceId: string;
  /** Left out of the list; null on surfaces that span projects. */
  currentProjectId: string | null;
  selectedTaskIds: ReadonlySet<string>;
  /** Without the update permission there is no group. */
  enabled: boolean;
  /** Runs when a destination is picked, e.g. to close the actions palette. */
  onPick: () => void;
  /** Runs after a successful move, e.g. to clear the selection. */
  onDone: () => void;
};

type Destination = { id: string; name: string };

/**
 * The bulk bar's "Move to project" group and its confirmation. The dialog
 * states the move's rule, since keys and planning links change for every task.
 */
export function useBulkMoveToProject({
  workspaceId,
  currentProjectId,
  selectedTaskIds,
  enabled,
  onPick,
  onDone,
}: Options): { groups: BulkAssigneeGroup[]; dialog: React.ReactNode } {
  const { t } = useTranslation();
  const [destination, setDestination] = useState<Destination | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const { bulkMoveToProject } = useBulkOperations();
  // Nothing to load until tasks are selected.
  const { data: projects } = useGetProjects({
    workspaceId: enabled && selectedTaskIds.size > 0 ? workspaceId : "",
  });

  const groups = useMemo<BulkAssigneeGroup[]>(() => {
    const items = (projects ?? [])
      .filter((project) => project.id !== currentProjectId)
      .map((project) => ({
        value: `move-project-${project.id}`,
        label: project.name,
        icon: <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />,
        onRun: () => {
          setDestination({ id: project.id, name: project.name });
          onPick();
        },
      }));
    if (!enabled || items.length === 0) return [];
    return [
      {
        value: "move-project",
        label: t("tasks:bulk.moveToProject"),
        items,
      },
    ];
  }, [projects, currentProjectId, enabled, onPick, t]);

  const count = selectedTaskIds.size;

  const handleMove = async () => {
    if (!destination) return;
    const { name } = destination;
    setIsMoving(true);
    try {
      const { updatedCount } = await bulkMoveToProject({
        taskIds: [...selectedTaskIds],
        projectId: destination.id,
      });
      if (updatedCount === 0) {
        toast.info(t("tasks:bulk.moveToProjectNone", { name }));
      } else {
        toast.success(
          t("tasks:bulk.moveToProjectSuccess", { name, count: updatedCount }),
        );
      }
      setDestination(null);
      onDone();
    } catch (error) {
      // The server explains a refusal, such as a task waiting in intake.
      toast.error(
        error instanceof HttpError && error.message
          ? error.message
          : t("tasks:bulk.moveToProjectError"),
      );
    } finally {
      setIsMoving(false);
    }
  };

  const dialog = (
    <AlertDialog
      open={destination !== null}
      onOpenChange={(open) => {
        if (!open && !isMoving) setDestination(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("tasks:bulk.moveToProjectTitle", {
              count,
              name: destination?.name ?? "",
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("tasks:bulk.moveToProjectRule")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={isMoving}
            onClick={() => setDestination(null)}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button size="sm" loading={isMoving} onClick={handleMove}>
            {t("tasks:bulk.moveToProjectConfirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { groups, dialog };
}

import { useNavigate } from "@tanstack/react-router";
import { Save } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUpdateView } from "@/hooks/mutations/view/use-view-mutations";
import type { TaskQueryStateHandle } from "@/hooks/use-task-query-state";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { mergeBaseConditions } from "@/lib/task-query/filter-tree";
import type { FilterCondition, TaskLayout } from "@/lib/task-query/model";
import {
  stateToViewContent,
  viewScopeOf,
  viewToState,
} from "@/lib/task-query/view-state";
import { toast } from "@/lib/toast";
import { viewPath } from "@/lib/view/entity-link";
import type { SavedView } from "@/types/view";
import ViewFormDialog from "./view-form-dialog";

type SaveViewActionsProps = {
  workspaceId: string;
  /** The list's project; null for workspace lists. */
  projectId: string | null;
  handle: TaskQueryStateHandle;
  /** The saved view the list shows; without it, changes save as a new view. */
  view?: SavedView;
  /** A built-in view's hidden conditions, kept in the new view. */
  baseConditions?: readonly FilterCondition[];
  /** The layout on screen, when the list's state doesn't hold it. */
  layout?: TaskLayout;
};

/**
 * Save, Save as new view and Reset on a changed saved view; "Save view" on
 * lists without one (B4 §6.3).
 */
export default function SaveViewActions({
  workspaceId,
  projectId,
  handle,
  view,
  baseConditions = [],
  layout,
}: SaveViewActionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canCreateViews, isCheckingPermissions } = useWorkspacePermission();
  const updateView = useUpdateView();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const canCreate = !isCheckingPermissions && canCreateViews();

  if (!handle.isDirty) return null;

  const newViewState = {
    ...handle.state,
    filters: mergeBaseConditions(handle.state.filters, baseConditions),
    display: layout
      ? { ...handle.state.display, layout }
      : handle.state.display,
  };
  const createDialog = canCreate ? (
    <ViewFormDialog
      open={isCreateOpen}
      onOpenChange={setIsCreateOpen}
      workspaceId={workspaceId}
      projectId={projectId}
      currentState={newViewState}
      onSaved={(saved) => {
        if (view) handle.reset();
        navigate({
          to: viewPath(saved.workspaceId, saved.id, saved.projectId),
        });
      }}
    />
  ) : null;

  if (!view) {
    if (!canCreate) return null;
    return (
      <>
        <Button
          size="xs"
          variant="outline"
          className="gap-1"
          onClick={() => setIsCreateOpen(true)}
        >
          <Save className="size-3" />
          {t("views:actions.saveView")}
        </Button>
        {createDialog}
      </>
    );
  }

  const blockedReason = view.isLocked
    ? view.lockedBy
      ? t("views:lock.lockedBy", { name: view.lockedBy.name })
      : t("views:actions.saveDisabledLocked")
    : !view.canEdit
      ? t("views:actions.saveDisabledPermission")
      : null;

  const handleSave = () => {
    updateView.mutate(
      {
        viewId: view.id,
        changes: stateToViewContent(handle.state, viewScopeOf(view)),
      },
      {
        onSuccess: (saved) => {
          handle.commit(viewToState(saved));
          toast.success(t("views:toast.updated"));
        },
        onError: (error) =>
          toast.error(error.message || t("views:toast.saveError")),
      },
    );
  };

  const saveButton = (
    <Button
      size="xs"
      disabled={Boolean(blockedReason)}
      loading={updateView.isPending}
      onClick={handleSave}
    >
      {t("views:actions.save")}
    </Button>
  );

  return (
    <>
      <span className="hidden text-muted-foreground text-xs lg:inline">
        {t("views:detail.unsaved")}
      </span>
      {blockedReason ? (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            {saveButton}
          </TooltipTrigger>
          <TooltipContent>{blockedReason}</TooltipContent>
        </Tooltip>
      ) : (
        saveButton
      )}
      {canCreate && (
        <Button
          size="xs"
          variant="outline"
          onClick={() => setIsCreateOpen(true)}
        >
          {t("views:actions.saveAsNew")}
        </Button>
      )}
      <Button size="xs" variant="ghost" onClick={handle.reset}>
        {t("views:actions.reset")}
      </Button>
      {createDialog}
    </>
  );
}

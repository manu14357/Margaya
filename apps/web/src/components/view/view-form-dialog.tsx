import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { groupLabelKey } from "@/components/task-filters/display-menu";
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
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateView,
  useUpdateView,
} from "@/hooks/mutations/view/use-view-mutations";
import { defaultTaskQueryState } from "@/hooks/use-task-query-state";
import { countConditions } from "@/lib/task-query/filter-tree";
import type { TaskQueryState } from "@/lib/task-query/model";
import { stateToViewContent } from "@/lib/task-query/view-state";
import { toast } from "@/lib/toast";
import type { SavedView, ViewAccess } from "@/types/view";

const NAME_MAX = 255;
const DESCRIPTION_MAX = 2000;

type ViewFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** Null for a workspace view. */
  projectId: string | null;
  /** Edit this view's name, description and access. */
  view?: SavedView;
  /** Create: the list state to save (filters, display, properties). */
  currentState?: TaskQueryState;
  onSaved?: (view: SavedView) => void;
};

/** Create a view (from the current filters) or edit its details. */
export default function ViewFormDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
  view,
  currentState,
  onSaved,
}: ViewFormDialogProps) {
  const { t } = useTranslation();
  const id = useId();
  const currentUserId = useAuth().user?.id;
  const createView = useCreateView();
  const updateView = useUpdateView();
  const isEditing = Boolean(view);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [access, setAccess] = useState<ViewAccess>("workspace");
  const [fromCurrent, setFromCurrent] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isSubmitting = createView.isPending || updateView.isPending;

  useEffect(() => {
    if (!open) return;
    setName(view?.name ?? "");
    setDescription(view?.description ?? "");
    setAccess(view?.access ?? "workspace");
    setFromCurrent(true);
    setError(null);
  }, [open, view]);

  const scope = projectId ? "project" : "workspace";
  const state =
    currentState && fromCurrent ? currentState : defaultTaskQueryState(scope);
  const groupBy = state.display.groupBy;

  const validate = () => {
    const trimmed = name.trim();
    if (!trimmed) return t("views:dialog.errors.nameRequired");
    if (trimmed.length > NAME_MAX) return t("views:dialog.errors.nameTooLong");
    if (description.length > DESCRIPTION_MAX) {
      return t("views:dialog.errors.descriptionTooLong");
    }
    return null;
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    const details = { name: name.trim(), description, access };
    const onError = (reason: Error) =>
      toast.error(reason.message || t("views:toast.saveError"));

    if (view) {
      updateView.mutate(
        { viewId: view.id, changes: details },
        {
          onSuccess: (saved) => {
            toast.success(t("views:toast.updated"));
            onOpenChange(false);
            onSaved?.(saved);
          },
          onError,
        },
      );
      return;
    }
    createView.mutate(
      {
        workspaceId,
        ...(projectId ? { projectId } : {}),
        ...details,
        ...stateToViewContent(state, scope),
      },
      {
        onSuccess: (saved) => {
          toast.success(t("views:toast.created"));
          onOpenChange(false);
          onSaved?.(saved);
        },
        onError,
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !isSubmitting && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {isEditing
                ? t("views:dialog.editTitle")
                : t("views:dialog.createTitle")}
            </DialogTitle>
          </DialogHeader>

          <fieldset disabled={isSubmitting} className="space-y-4 p-6 pt-1">
            <div className="space-y-2">
              <Label htmlFor={`${id}-name`}>{t("views:dialog.name")}</Label>
              <Input
                id={`${id}-name`}
                autoFocus
                maxLength={NAME_MAX}
                value={name}
                placeholder={t("views:dialog.namePlaceholder")}
                aria-invalid={error ? true : undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
              />
              {error && <p className="text-destructive text-sm">{error}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${id}-description`}>
                {t("views:dialog.description")}
              </Label>
              <Textarea
                id={`${id}-description`}
                rows={2}
                maxLength={DESCRIPTION_MAX}
                value={description}
                placeholder={t("views:dialog.descriptionPlaceholder")}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <p className="font-medium text-sm">{t("views:dialog.access")}</p>
              <RadioGroup
                className="gap-2"
                value={access}
                onValueChange={(value) =>
                  setAccess(value === "private" ? "private" : "workspace")
                }
              >
                {(["workspace", "private"] as const).map((option) => (
                  <label
                    key={option}
                    className="flex items-start gap-3"
                    htmlFor={`${id}-${option}`}
                  >
                    <Radio
                      className="mt-0.5"
                      id={`${id}-${option}`}
                      value={option}
                      // Only a view's owner can make it private.
                      disabled={
                        option === "private" &&
                        Boolean(view) &&
                        view?.access !== "private" &&
                        view?.ownerId !== currentUserId
                      }
                    />
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium text-sm">
                        {t(`views:access.${option}`)}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {t(`views:access.${option}Hint`)}
                      </p>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </div>

            {!isEditing && currentState && (
              <label
                className="flex items-center gap-2 text-sm"
                htmlFor={`${id}-current`}
              >
                <Checkbox
                  id={`${id}-current`}
                  checked={fromCurrent}
                  onCheckedChange={(checked) =>
                    setFromCurrent(checked === true)
                  }
                />
                {t("views:dialog.fromCurrent")}
              </label>
            )}
            {!isEditing && (
              <p className="text-muted-foreground text-xs">
                {groupBy
                  ? t("views:dialog.summary", {
                      filters: countConditions(state.filters),
                      group: t(groupLabelKey(groupBy)),
                    })
                  : t("views:dialog.summaryUngrouped", {
                      filters: countConditions(state.filters),
                    })}
              </p>
            )}
          </fieldset>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              {t("views:dialog.cancel")}
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {isEditing ? t("views:dialog.save") : t("views:dialog.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useNavigate } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import { Circle, CircleCheck, Info, X } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import LazyCreateTaskModal from "@/components/shared/modals/lazy-create-task-modal";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useRemoveSampleData } from "@/hooks/mutations/project-template/use-remove-sample-data";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  type FirstStepsItemId,
  type FirstStepsState,
  readFirstSteps,
  writeFirstSteps,
} from "@/lib/create-flow-storage";
import { toast } from "@/lib/toast";

const MAX_ITEMS = 4;

// Loaded only when the strip's invite action is used, so boards stay light.
const InviteTeamMemberModal = lazy(
  () => import("@/components/team/invite-team-member-modal"),
);

type ProjectLike = {
  id: string;
  workspaceId: string;
  name: string;
  hasSampleData?: boolean;
};

/** This browser's record of a project it created, kept in step with storage. */
function useFirstStepsState(projectId: string) {
  const [state, setState] = useState<FirstStepsState | null>(() =>
    readFirstSteps(projectId),
  );
  const [forProject, setForProject] = useState(projectId);
  if (forProject !== projectId) {
    setForProject(projectId);
    setState(readFirstSteps(projectId));
  }
  const update = (change: Partial<FirstStepsState>) =>
    setState(writeFirstSteps(projectId, change));
  return [state, update] as const;
}

/**
 * The board's welcome for a new project: the example-tasks banner and the
 * "First steps" strip (at most four items). Mounted on the Tasks section only;
 * nothing renders for projects this browser did not create, except the
 * banner for people with task:delete.
 */
export default function ProjectFirstSteps({
  project,
}: {
  project: ProjectLike | undefined;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const projectId = project?.id ?? "";
  const [state, update] = useFirstStepsState(projectId);
  const {
    canDeleteTasks,
    canCreateTasks,
    canInviteUsers,
    isCheckingPermissions,
  } = useWorkspacePermission();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const removal = useRemoveSampleData({
    projectId,
    workspaceId: project?.workspaceId ?? "",
  });

  if (!project || isCheckingPermissions) return null;

  const hasSampleData = project.hasSampleData === true;
  // The API lets the person who added the examples remove them, and anyone
  // with task:delete.
  const mayRemove = canDeleteTasks() || state?.appliedByMe === true;
  const bannerAllowed = hasSampleData && mayRemove && !state?.bannerDismissed;

  const done = new Set<FirstStepsItemId>(state?.done ?? []);
  if (state && state.sampleTaskCount > 0 && !hasSampleData) {
    done.add("removeExamples");
  }
  // A stable list, so the count reads "1 of 4" as items get done.
  const items: FirstStepsItemId[] = [];
  if (state) {
    const hadExamples = state.sampleTaskCount > 0;
    if (hadExamples) items.push("moveExample");
    if (canCreateTasks()) items.push("addTask");
    if (canInviteUsers()) items.push("invite");
    if (hadExamples && mayRemove) items.push("removeExamples");
  }
  const shown = items.slice(0, MAX_ITEMS);
  const doneCount = shown.filter((item) => done.has(item)).length;
  const showStrip =
    state !== null &&
    !state.dismissed &&
    shown.length > 0 &&
    doneCount < shown.length;
  // While the open strip already offers "Remove the examples", the banner
  // would repeat it; it takes over once the strip is hidden or done.
  const stripOffersRemoval =
    showStrip &&
    !state?.collapsed &&
    shown.includes("removeExamples") &&
    !done.has("removeExamples");
  const showBanner = bannerAllowed && !stripOffersRemoval;

  const markDone = (item: FirstStepsItemId) =>
    update({ done: [...new Set([...(state?.done ?? []), item])] });

  const removeExamples = () =>
    removal.mutate(undefined, {
      onSuccess: (result) => {
        setConfirmOpen(false);
        markDone("removeExamples");
        toast.success(
          t("common:modals.createProject.examples.removed", {
            count: result.removedTaskCount,
          }),
          {
            description: t("common:modals.createProject.examples.restoreHint"),
            action: {
              label: t("common:modals.createProject.examples.openTrash"),
              onClick: () =>
                navigate({
                  to: "/dashboard/settings/projects/$projectId/trash",
                  params: { projectId },
                }),
            },
          },
        );
      },
      onError: () =>
        toast.error(t("common:modals.createProject.examples.removeFailed")),
    });

  const itemCopy: Record<
    FirstStepsItemId,
    { label: string; action?: string; run?: () => void }
  > = {
    moveExample: {
      label: t("common:modals.createProject.firstSteps.moveExample"),
      action: t("common:modals.createProject.firstSteps.markDone"),
      run: () => markDone("moveExample"),
    },
    addTask: {
      label: t("common:modals.createProject.firstSteps.addTask"),
      action: t("common:modals.createProject.firstSteps.addTaskAction"),
      run: () => {
        markDone("addTask");
        setTaskOpen(true);
      },
    },
    invite: {
      label: t("common:modals.createProject.firstSteps.invite"),
      action: t("common:modals.createProject.firstSteps.inviteAction"),
      run: () => {
        markDone("invite");
        setInviteOpen(true);
      },
    },
    removeExamples: {
      label: t("common:modals.createProject.firstSteps.removeExamplesItem"),
      action: t("common:modals.createProject.firstSteps.removeExamples"),
      run: () => setConfirmOpen(true),
    },
  };

  return (
    <>
      {showStrip && state && (
        <motion.section
          aria-label={t("common:modals.createProject.firstSteps.label")}
          className="mx-4 mt-3 rounded-xl border border-border bg-card"
          initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            duration: reduceMotion ? 0.15 : 0.2,
            ease: [0.23, 1, 0.32, 1],
          }}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <CircleCheck
              className="size-4 shrink-0 text-success-foreground"
              aria-hidden
            />
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-medium text-foreground">
                {t("common:modals.createProject.firstSteps.title", {
                  name: project.name,
                })}
              </span>{" "}
              <span className="text-muted-foreground">
                {t("common:modals.createProject.firstSteps.progress", {
                  done: doneCount,
                  total: shown.length,
                })}
              </span>
            </p>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-expanded={!state.collapsed}
              onClick={() => update({ collapsed: !state.collapsed })}
            >
              {state.collapsed
                ? t("common:modals.createProject.firstSteps.show")
                : t("common:modals.createProject.firstSteps.hide")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => update({ dismissed: true })}
            >
              {t("common:modals.createProject.firstSteps.dismiss")}
            </Button>
          </div>
          {!state.collapsed && (
            <>
              <ul className="space-y-1 border-border border-t px-3 py-2">
                {shown.map((item) => {
                  const isDone = done.has(item);
                  const copy = itemCopy[item];
                  return (
                    <li
                      key={item}
                      className="flex min-h-9 items-center gap-2 text-sm"
                    >
                      {isDone ? (
                        <CircleCheck
                          className="size-4 shrink-0 text-success-foreground"
                          aria-hidden
                        />
                      ) : (
                        <Circle
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      )}
                      <span
                        className={
                          isDone
                            ? "min-w-0 flex-1 text-muted-foreground line-through"
                            : "min-w-0 flex-1 text-foreground"
                        }
                      >
                        <span className="sr-only">
                          {isDone
                            ? t(
                                "common:modals.createProject.firstSteps.doneLabel",
                              )
                            : t(
                                "common:modals.createProject.firstSteps.todoLabel",
                              )}
                        </span>
                        {copy.label}
                      </span>
                      {!isDone && copy.action && (
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={copy.run}
                        >
                          {copy.action}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {state.skippedLabels && (
                <p className="border-border border-t px-3 py-2 text-muted-foreground text-xs">
                  {t("common:modals.createProject.firstSteps.labelsSkipped")}
                </p>
              )}
            </>
          )}
        </motion.section>
      )}

      {showBanner && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-border/80 border-b bg-muted/60 px-4 py-1.5 text-muted-foreground text-xs"
        >
          <Info className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            {t("common:modals.createProject.examples.banner")}
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setConfirmOpen(true)}
          >
            {t("common:modals.createProject.firstSteps.removeExamples")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("common:modals.createProject.examples.dismissBanner")}
            title={t("common:modals.createProject.examples.dismissBanner")}
            onClick={() => update({ bannerDismissed: true })}
          >
            <X aria-hidden />
          </Button>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("common:modals.createProject.examples.confirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("common:modals.createProject.examples.confirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button
              variant="destructive"
              loading={removal.isPending}
              onClick={removeExamples}
            >
              {t("common:modals.createProject.firstSteps.removeExamples")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      {taskOpen && (
        <LazyCreateTaskModal
          open={taskOpen}
          onClose={() => setTaskOpen(false)}
          projectId={projectId}
        />
      )}
      {inviteOpen && (
        <Suspense fallback={null}>
          <InviteTeamMemberModal
            open={inviteOpen}
            onClose={() => setInviteOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}

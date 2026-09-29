import { Link } from "@tanstack/react-router";
import { IterationCw, ListPlus, Plus, SquarePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function CycleNotFound({
  workspaceId,
  projectId,
}: {
  workspaceId: string;
  projectId: string;
}) {
  const { t } = useTranslation();
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IterationCw />
        </EmptyMedia>
        <EmptyTitle>{t("cycles:detail.notFoundTitle")}</EmptyTitle>
        <EmptyDescription>
          {t("cycles:detail.notFoundDescription")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          size="sm"
          render={
            <Link
              to="/dashboard/workspace/$workspaceId/project/$projectId/cycles"
              params={{ workspaceId, projectId }}
            />
          }
        >
          {t("cycles:detail.backToCycles")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/** A cycle without tasks: create one here or pull in existing work. */
export function CycleEmptyBoard({
  isClosed,
  onCreateTask,
  onAddExisting,
  onPlan,
}: {
  /** Completed or archived: nothing can be added. */
  isClosed: boolean;
  onCreateTask?: () => void;
  onAddExisting?: () => void;
  /** Opens the split-view planner. */
  onPlan?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IterationCw />
        </EmptyMedia>
        <EmptyTitle>
          {isClosed
            ? t("cycles:detail.emptyCompletedTitle")
            : t("cycles:detail.emptyTitle")}
        </EmptyTitle>
        <EmptyDescription>
          {isClosed
            ? t("cycles:detail.emptyCompletedDescription")
            : t("cycles:detail.emptyDescription")}
        </EmptyDescription>
      </EmptyHeader>
      {!isClosed && (onCreateTask || onAddExisting || onPlan) && (
        <EmptyContent className="flex-row justify-center gap-2">
          {onCreateTask && (
            <Button size="sm" onClick={onCreateTask}>
              <Plus />
              {t("cycles:detail.addTask")}
            </Button>
          )}
          {onPlan && (
            <Button
              variant={onCreateTask ? "outline" : "default"}
              size="sm"
              onClick={onPlan}
            >
              <ListPlus />
              {t("cycles:plan.open")}
            </Button>
          )}
          {onAddExisting && !onPlan && (
            <Button variant="outline" size="sm" onClick={onAddExisting}>
              <SquarePlus />
              {t("cycles:detail.addExisting")}
            </Button>
          )}
        </EmptyContent>
      )}
    </Empty>
  );
}

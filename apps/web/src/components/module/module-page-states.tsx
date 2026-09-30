import { Link } from "@tanstack/react-router";
import { Boxes, Plus, SquarePlus } from "lucide-react";
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

/** A missing module, or one of another project. */
export function ModuleNotFound({
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
          <Boxes />
        </EmptyMedia>
        <EmptyTitle>{t("modules:detail.notFound")}</EmptyTitle>
        <EmptyDescription>
          {t("modules:detail.notFoundDescription")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          size="sm"
          render={
            <Link
              to="/dashboard/workspace/$workspaceId/project/$projectId/modules"
              params={{ workspaceId, projectId }}
            />
          }
        >
          {t("modules:detail.backToList")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/** A module without tasks: create one here or pull in existing work. */
export function ModuleEmptyBoard({
  isArchived,
  onCreateTask,
  onAddExisting,
}: {
  isArchived: boolean;
  onCreateTask?: () => void;
  onAddExisting?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Boxes />
        </EmptyMedia>
        <EmptyTitle>{t("modules:detail.emptyTitle")}</EmptyTitle>
        <EmptyDescription>
          {isArchived
            ? t("modules:detail.emptyArchivedDescription")
            : t("modules:detail.emptyDescription")}
        </EmptyDescription>
      </EmptyHeader>
      {!isArchived && (onCreateTask || onAddExisting) && (
        <EmptyContent className="flex-row justify-center gap-2">
          {onCreateTask && (
            <Button size="sm" onClick={onCreateTask}>
              <Plus />
              {t("modules:detail.addTask")}
            </Button>
          )}
          {onAddExisting && (
            <Button variant="outline" size="sm" onClick={onAddExisting}>
              <SquarePlus />
              {t("modules:detail.addExisting")}
            </Button>
          )}
        </EmptyContent>
      )}
    </Empty>
  );
}

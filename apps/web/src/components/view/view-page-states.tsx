import { Link } from "@tanstack/react-router";
import { EyeOff } from "lucide-react";
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

/** An unknown view, or another user's private one (the API says 404). */
export function ViewNotFound({
  workspaceId,
  projectId,
}: {
  workspaceId: string;
  projectId?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <EyeOff />
        </EmptyMedia>
        <EmptyTitle>{t("views:detail.notFoundTitle")}</EmptyTitle>
        <EmptyDescription>
          {t("views:detail.notFoundDescription")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          size="sm"
          variant="outline"
          render={
            projectId ? (
              <Link
                to="/dashboard/workspace/$workspaceId/project/$projectId/views"
                params={{ workspaceId, projectId }}
              />
            ) : (
              <Link
                to="/dashboard/workspace/$workspaceId/views/$viewId"
                params={{ workspaceId, viewId: "all" }}
              />
            )
          }
        >
          {t("views:detail.back")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

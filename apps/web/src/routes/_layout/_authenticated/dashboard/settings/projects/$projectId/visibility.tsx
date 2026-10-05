import { createFileRoute } from "@tanstack/react-router";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import BlockedPeopleList from "@/components/publication/blocked-people-list";
import PublicCommentsModeration from "@/components/publication/public-comments-moderation";
import PublishSettingsForm from "@/components/publication/publish-settings-form";
import PublishStatusCard from "@/components/publication/publish-status-card";
import { SettingsPage, SettingsSection } from "@/components/settings-layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { usePublication } from "@/hooks/queries/publication/use-publication";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

// The Publish page (B12 §1.2). The segment stays "visibility" so existing
// links keep working.
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/visibility",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const {
    data: publication,
    isLoading,
    isError,
    refetch,
  } = usePublication(projectId);

  const pageTitle = t("settings:projectPublish.pageTitle");

  return (
    <SettingsPage
      title={t("settings:projectPublish.title")}
      documentTitle={
        project?.name ? `${pageTitle} · ${project.name}` : pageTitle
      }
      description={t("settings:projectPublish.subtitle")}
    >
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : isError || !publication ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{t("settings:projectPublish.loadError")}</span>
          <Button variant="outline" size="xs" onClick={() => refetch()}>
            {t("settings:projectPublish.retry")}
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {!publication.availability.publicBoards && (
              <Alert variant="warning">
                <Info />
                <AlertDescription>
                  {t("settings:projectPublish.status.boardsOff")}
                </AlertDescription>
              </Alert>
            )}
            <PublishStatusCard
              projectId={projectId}
              publication={publication}
            />
            {!publication.canManage && (
              <p className="text-xs text-muted-foreground">
                {t("settings:projectPublish.status.noPermission")}
              </p>
            )}
          </div>

          <PublishSettingsForm
            projectId={projectId}
            publication={publication}
          />

          <SettingsSection
            title={t("settings:projectPublish.moderation.title")}
          >
            <div className="space-y-4">
              <PublicCommentsModeration
                projectId={projectId}
                workspaceId={workspaceId}
                canManage={publication.canManage}
              />
              {publication.canManage && (
                <BlockedPeopleList projectId={projectId} />
              )}
            </div>
          </SettingsSection>
        </>
      )}
    </SettingsPage>
  );
}

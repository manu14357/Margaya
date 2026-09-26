import { Link } from "@tanstack/react-router";
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
import {
  getProjectFeature,
  type ProjectFeatureKey,
} from "@/constants/project-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

type FeatureDisabledStateProps = {
  projectId: string;
  feature: ProjectFeatureKey;
};

/** Shown at a section URL while its feature is turned off. */
export default function FeatureDisabledState({
  projectId,
  feature,
}: FeatureDisabledStateProps) {
  const { t } = useTranslation();
  const { canUpdateProjects } = useWorkspacePermission();
  const definition = getProjectFeature(feature);
  const Icon = definition.icon;
  const title = t(definition.titleKey);

  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>
          {t("common:featureDisabled.title", { feature: title })}
        </EmptyTitle>
        <EmptyDescription>
          {t("common:featureDisabled.description")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {canUpdateProjects() ? (
          <Button
            variant="outline"
            size="sm"
            render={
              <Link
                to="/dashboard/settings/projects/$projectId/features"
                params={{ projectId }}
              />
            }
          >
            {t("common:featureDisabled.manage")}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("common:featureDisabled.askAdmin")}
          </p>
        )}
      </EmptyContent>
    </Empty>
  );
}

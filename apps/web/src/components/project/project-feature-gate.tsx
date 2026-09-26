import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProjectFeatureKey } from "@/constants/project-features";
import { useProjectFeatures } from "@/hooks/use-project-features";
import FeatureDisabledState from "./feature-disabled-state";

type ProjectFeatureGateProps = {
  projectId: string;
  workspaceId: string;
  feature: ProjectFeatureKey;
  children: ReactNode;
};

/**
 * Wraps a feature section's content: a skeleton while the project loads, the
 * "turned off" state while the feature is off or unavailable, else children.
 * Section routes from later slices render it inside ProjectLayout.
 */
export default function ProjectFeatureGate({
  projectId,
  workspaceId,
  feature,
  children,
}: ProjectFeatureGateProps) {
  const { isEnabled, isLoading } = useProjectFeatures({
    projectId,
    workspaceId,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Skeleton className="h-32 w-full max-w-md" />
      </div>
    );
  }

  if (!isEnabled(feature)) {
    return <FeatureDisabledState projectId={projectId} feature={feature} />;
  }

  return <>{children}</>;
}

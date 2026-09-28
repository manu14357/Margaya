import { useMemo } from "react";
import useGetCycles from "@/hooks/queries/cycle/use-get-cycles";
import useActiveEstimate from "@/hooks/queries/estimate/use-active-estimate";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import useGetModules from "@/hooks/queries/module/use-get-modules";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useProjectFeatures } from "@/hooks/use-project-features";
import {
  FEATURE_FIELDS,
  IMPORT_FIELDS,
  type ImportContext,
  type ImportField,
} from "@/lib/task-import/csv-mapping";

type CsvImportProject = {
  id: string;
  workspaceId: string;
  columns: ReadonlyArray<{ slug: string; name: string; group?: string }>;
};

/**
 * What the CSV import resolves names against: members, labels, cycles that
 * take tasks, active modules and the active estimate's points. It also lists
 * the fields to offer; cycle, module and estimate need their feature on.
 */
export function useCsvImportContext(
  project: CsvImportProject,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const projectId = enabled ? project.id : "";
  const workspaceId = enabled ? project.workspaceId : "";
  const { flags, isLoading: isLoadingFeatures } = useProjectFeatures({
    projectId,
    workspaceId,
  });
  const members = useGetActiveWorkspaceUsers(workspaceId);
  const labels = useGetLabelsByWorkspace(workspaceId);
  const cycles = useGetCycles(projectId, "incomplete", {
    enabled: flags.cycles,
  });
  const modules = useGetModules(projectId, "active", {
    enabled: flags.modules,
  });
  const estimate = useActiveEstimate({ projectId, workspaceId, enabled });

  const fields = useMemo<ImportField[]>(
    () =>
      IMPORT_FIELDS.filter((field) => {
        const feature = FEATURE_FIELDS[field as keyof typeof FEATURE_FIELDS];
        return !feature || flags[feature];
      }),
    [flags],
  );

  const context = useMemo<Omit<ImportContext, "dateFormat">>(
    () => ({
      columns: project.columns.filter((column) => column.group !== "triage"),
      members: (members.data?.members ?? []).map((member) => ({
        id: member.userId,
        name: member.user?.name ?? "",
        email: member.user?.email ?? "",
      })),
      labels: labels.data ?? [],
      cycles: flags.cycles ? (cycles.data ?? []) : [],
      modules: flags.modules ? (modules.data ?? []) : [],
      estimatePoints: estimate.estimate?.points ?? [],
    }),
    [
      project.columns,
      members.data,
      labels.data,
      flags.cycles,
      flags.modules,
      cycles.data,
      modules.data,
      estimate.estimate,
    ],
  );

  const isLoading =
    isLoadingFeatures ||
    members.isLoading ||
    labels.isLoading ||
    (flags.cycles && cycles.isLoading) ||
    (flags.modules && modules.isLoading) ||
    estimate.isLoading;

  return { fields, context, isLoading };
}

export default useCsvImportContext;

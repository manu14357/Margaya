import { useMemo } from "react";
import { isProjectFeatureEnabled } from "@/constants/project-features";
import useGetCustomFieldsByProject from "@/hooks/queries/custom-field/use-get-custom-fields-by-project";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import {
  DISPLAY_PROPERTY_KEYS,
  type DisplayPropertyKey,
  GROUP_BY_KEYS,
  type GroupByKey,
  ORDER_BY_FIELDS,
  type OrderByField,
  type TaskLayout,
  type TaskQueryScope,
} from "@/lib/task-query/model";
import type { DisplayMenuConfig } from "./display-menu";

const CLASSIC_ORDER_FIELDS: readonly OrderByField[] = [
  "manual",
  "createdAt",
  "priority",
  "dueDate",
  "title",
  "number",
  "estimate",
];

type Options = {
  workspaceId: string;
  scope: TaskQueryScope;
  layout: TaskLayout;
  /** Cycle and module pages keep the classic board: no regrouping. */
  classicOnly?: boolean;
};

/**
 * What the Display menu offers on a surface: group-by keys (status needs
 * one project), orders and properties, without features that are off in
 * every project in scope.
 */
export function useDisplayConfig({
  workspaceId,
  scope,
  layout,
  classicOnly = false,
}: Options): DisplayMenuConfig {
  const { data: projects } = useGetProjects({ workspaceId });
  const projectId = scope.kind === "project" ? scope.projectId : "";
  const { data: customFields } = useGetCustomFieldsByProject(
    layout === "spreadsheet" ? projectId : "",
  );

  return useMemo(() => {
    const list = (projects ?? []) as Array<{
      id: string;
      archivedAt?: string | null;
    }>;
    const inScope = list.filter((project) =>
      scope.kind === "project"
        ? project.id === scope.projectId
        : scope.projectIds?.length
          ? scope.projectIds.includes(project.id)
          : !project.archivedAt,
    );
    const anyHas = (feature: "cycles" | "modules" | "estimates") =>
      inScope.some((project) =>
        isProjectFeatureEnabled(
          project as Parameters<typeof isProjectFeatureEnabled>[0],
          feature,
        ),
      );
    const hasCycles = anyHas("cycles");
    const hasModules = anyHas("modules");
    const hasEstimates = anyHas("estimates");
    const featureOk = (key: string) =>
      (key !== "cycle" || hasCycles) &&
      (key !== "module" && key !== "modules" ? true : hasModules) &&
      (key !== "estimate" || hasEstimates);

    const groupByOptions: GroupByKey[] =
      layout === "spreadsheet" || classicOnly
        ? []
        : GROUP_BY_KEYS.filter(
            (key) =>
              featureOk(key) &&
              (key !== "status" || scope.kind === "project") &&
              (key !== "project" || scope.kind === "workspace"),
          );

    const orderOptions: OrderByField[] = (
      classicOnly ? CLASSIC_ORDER_FIELDS : ORDER_BY_FIELDS
    ).filter(
      (field) =>
        featureOk(field) &&
        (field !== "manual" || scope.kind === "project") &&
        // Only the Archives list offers it (its tasks all have one).
        field !== "archivedAt",
    );

    const propertyKeys: DisplayPropertyKey[] = DISPLAY_PROPERTY_KEYS.filter(
      (key) =>
        featureOk(key) &&
        // Rows have no description, so the spreadsheet has no checklist.
        (layout !== "spreadsheet" || key !== "checklist"),
    );

    return {
      groupByOptions,
      allowSubGroup: !classicOnly && (layout === "board" || layout === "list"),
      allowEmptyGroups: !classicOnly,
      orderOptions,
      propertyKeys,
      propertiesTitle: layout === "spreadsheet" ? "columns" : "properties",
      customFields:
        layout === "spreadsheet" && scope.kind === "project"
          ? ((customFields ?? []) as Array<{ id: string; name: string }>).map(
              (field) => ({ id: field.id, name: field.name }),
            )
          : undefined,
    };
  }, [projects, scope, layout, classicOnly, customFields]);
}

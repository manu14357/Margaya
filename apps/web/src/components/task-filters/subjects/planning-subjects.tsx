import { useQueries } from "@tanstack/react-query";
import { Boxes, IterationCw, Ruler, SlidersHorizontal } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CycleStatusIcon } from "@/components/cycle/cycle-status";
import { ModuleStatusIcon } from "@/components/module/module-status";
import {
  isProjectFeatureEnabled,
  type ProjectFeatureKey,
} from "@/constants/project-features";
import getCustomFieldFilterValues from "@/fetchers/custom-field/get-custom-field-filter-values";
import getCustomFieldsByProject from "@/fetchers/custom-field/get-custom-fields-by-project";
import getCycles from "@/fetchers/cycle/get-cycles";
import getEstimates from "@/fetchers/estimate/get-estimates";
import getModules from "@/fetchers/module/get-modules";
import { cycleQueryKeys } from "@/hooks/queries/cycle/cycle-query-keys";
import { estimateQueryKeys } from "@/hooks/queries/estimate/estimate-query-keys";
import { moduleQueryKeys } from "@/hooks/queries/module/module-query-keys";
import { formatEstimateValue } from "@/lib/estimate/format";
import { CURRENT_CYCLE_VALUE, NONE_VALUE } from "@/lib/task-query/model";
import type {
  FilterOption,
  FilterSubject,
  FilterSubjectContext,
  ScopeProject,
} from "./registry";
import { registerFilterSubject } from "./registry";

// Cycle, module, estimate and custom field subjects. Each lists the options
// of the projects in scope that have the feature on (grouped by project in
// workspace scope) and hides itself when no project has it (B4 §6.3).

function featureProjects(
  context: FilterSubjectContext,
  feature: ProjectFeatureKey,
): ScopeProject[] {
  return context.projects.filter((project) =>
    isProjectFeatureEnabled(project, feature),
  );
}

function sectionOf(context: FilterSubjectContext, project: ScopeProject) {
  return context.scope.kind === "workspace" ? project.name : undefined;
}

const CYCLE_ORDER = ["current", "upcoming", "draft", "completed"] as const;

function useCycleSubjects(context: FilterSubjectContext): FilterSubject[] {
  const { t } = useTranslation();
  const projects = featureProjects(context, "cycles");
  const active = context.isActive("cycle");
  const results = useQueries({
    queries: projects.map((project) => ({
      queryKey: cycleQueryKeys.list(project.id, "all"),
      queryFn: () => getCycles(project.id, "all"),
      enabled: active,
    })),
  });
  const stamp = results.map((result) => result.dataUpdatedAt).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: stamp tracks the per-project results
  return useMemo(() => {
    if (projects.length === 0) return [];
    const options: FilterOption[] = [
      {
        value: CURRENT_CYCLE_VALUE,
        label: t("tasks:filters.values.currentCycle"),
        icon: <IterationCw className="text-muted-foreground" />,
      },
      { value: NONE_VALUE, label: t("tasks:filters.values.noCycle") },
    ];
    projects.forEach((project, index) => {
      const cycles = [...(results[index]?.data ?? [])]
        .filter((cycle) => !cycle.archivedAt)
        .sort(
          (a, b) =>
            CYCLE_ORDER.indexOf(a.status as (typeof CYCLE_ORDER)[number]) -
            CYCLE_ORDER.indexOf(b.status as (typeof CYCLE_ORDER)[number]),
        );
      for (const cycle of cycles) {
        options.push({
          value: cycle.id,
          label: cycle.name,
          icon: <CycleStatusIcon cycle={cycle} className="size-3.5" />,
          section: sectionOf(context, project),
        });
      }
    });
    return [
      {
        id: "cycle",
        key: "cycle",
        label: t("tasks:filters.subjects.cycle"),
        icon: IterationCw,
        kind: "set",
        options,
        isLoading: results.some((result) => result.isLoading),
      },
    ];
  }, [projects.map((project) => project.id).join(","), stamp, t]);
}

function useModuleSubjects(context: FilterSubjectContext): FilterSubject[] {
  const { t } = useTranslation();
  const projects = featureProjects(context, "modules");
  const active = context.isActive("module");
  const results = useQueries({
    queries: projects.map((project) => ({
      queryKey: moduleQueryKeys.list(project.id, "active"),
      queryFn: () => getModules(project.id, "active"),
      enabled: active,
      staleTime: 30_000,
    })),
  });
  const stamp = results.map((result) => result.dataUpdatedAt).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: stamp tracks the per-project results
  return useMemo(() => {
    if (projects.length === 0) return [];
    const options: FilterOption[] = [
      { value: NONE_VALUE, label: t("tasks:filters.values.noModule") },
    ];
    projects.forEach((project, index) => {
      const modules = [...(results[index]?.data ?? [])]
        .filter((module) => !module.archivedAt)
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
        );
      for (const module of modules) {
        options.push({
          value: module.id,
          label: module.name,
          icon: (
            <ModuleStatusIcon status={module.status} className="size-3.5" />
          ),
          section: sectionOf(context, project),
        });
      }
    });
    return [
      {
        id: "module",
        key: "module",
        label: t("tasks:filters.subjects.module"),
        icon: Boxes,
        kind: "set",
        options,
        isLoading: results.some((result) => result.isLoading),
      },
    ];
  }, [projects.map((project) => project.id).join(","), stamp, t]);
}

function useEstimateSubjects(context: FilterSubjectContext): FilterSubject[] {
  const { t } = useTranslation();
  const projects = featureProjects(context, "estimates");
  const active = context.isActive("estimate");
  const results = useQueries({
    queries: projects.map((project) => ({
      queryKey: estimateQueryKeys.all(project.id),
      queryFn: () => getEstimates(project.id),
      enabled: active,
      staleTime: 60_000,
    })),
  });
  const stamp = results.map((result) => result.dataUpdatedAt).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: stamp tracks the per-project results
  return useMemo(() => {
    if (projects.length === 0) return [];
    const options: FilterOption[] = [
      { value: NONE_VALUE, label: t("tasks:filters.values.noEstimate") },
    ];
    projects.forEach((project, index) => {
      const data = results[index]?.data;
      const estimate = data?.estimates.find(
        (candidate) => candidate.id === data.activeEstimateId,
      );
      if (!estimate) return;
      for (const point of [...estimate.points].sort(
        (a, b) => a.position - b.position,
      )) {
        options.push({
          value: point.id,
          label: formatEstimateValue(estimate.type, point.value),
          section: sectionOf(context, project),
        });
      }
    });
    return [
      {
        id: "estimate",
        key: "estimate",
        label: t("tasks:boardFilters.subjects.estimate"),
        icon: Ruler,
        kind: "set",
        options,
        isLoading: results.some((result) => result.isLoading),
      },
    ];
  }, [projects.map((project) => project.id).join(","), stamp, t]);
}

type CustomField = {
  id: string;
  name: string;
  type: string;
  options?: unknown;
};

function useCustomFieldSubjects(
  context: FilterSubjectContext,
): FilterSubject[] {
  const { t } = useTranslation();
  // Custom fields belong to one project; workspace lists don't offer them.
  const projectId =
    context.scope.kind === "project" ? context.scope.projectId : "";
  const [fields, used] = useQueries({
    queries: [
      {
        queryKey: ["custom-fields", projectId],
        queryFn: () => getCustomFieldsByProject({ projectId }),
        enabled: Boolean(projectId),
      },
      {
        queryKey: ["custom-field-filter-values", projectId],
        queryFn: () => getCustomFieldFilterValues({ projectId }),
        enabled: Boolean(projectId) && context.isActive("customField"),
      },
    ],
  });
  const fieldList = fields?.data as CustomField[] | undefined;
  const usedList = used?.data as
    | Array<{ fieldId: string; values: string[] }>
    | undefined;
  return useMemo(() => {
    if (!projectId || !fieldList) return [];
    return fieldList.map((field) => {
      let values: string[] = [];
      if (field.type === "dropdown" && Array.isArray(field.options)) {
        values = field.options.filter(
          (option): option is string => typeof option === "string",
        );
      } else if (field.type === "boolean") {
        values = ["true", "false"];
      } else {
        values =
          usedList?.find((entry) => entry.fieldId === field.id)?.values ?? [];
      }
      return {
        id: `customField:${field.id}`,
        key: "customField",
        fieldId: field.id,
        label: field.name,
        icon: SlidersHorizontal,
        kind: "set" as const,
        options: [
          { value: NONE_VALUE, label: t("tasks:filters.values.none") },
          ...values.map((value) => ({
            value,
            label:
              field.type === "boolean"
                ? t(
                    value === "true"
                      ? "tasks:filters.values.true"
                      : "tasks:filters.values.false",
                  )
                : value,
          })),
        ],
      };
    });
  }, [projectId, fieldList, usedList, t]);
}

registerFilterSubject({
  id: "cycle",
  order: 60,
  useSubjects: useCycleSubjects,
});
registerFilterSubject({
  id: "module",
  order: 70,
  useSubjects: useModuleSubjects,
});
registerFilterSubject({
  id: "estimate",
  order: 80,
  useSubjects: useEstimateSubjects,
});
registerFilterSubject({
  id: "customField",
  order: 120,
  useSubjects: useCustomFieldSubjects,
});

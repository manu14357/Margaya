import { useMemo } from "react";
import { useAgents } from "@/hooks/queries/ai/use-agents";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import useGetCustomFieldsByProject from "@/hooks/queries/custom-field/use-get-custom-fields-by-project";
import useGetCycles from "@/hooks/queries/cycle/use-get-cycles";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import useGetModules from "@/hooks/queries/module/use-get-modules";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import useGetWorkspaceUsers from "@/hooks/queries/workspace-users/use-get-workspace-users";

// What a rule's builder rows can pick from: the project's columns, cycles,
// modules and custom fields, and the workspace's people and labels.

export type Option = { id: string; name: string };

export type RuleOptions = {
  columns: (Option & { slug: string; group?: string })[];
  people: Option[];
  labels: string[];
  cycles: Option[];
  modules: Option[];
  fields: Option[];
  /** Enabled agents, for "Run agent" (by agent id). */
  agents?: Option[];
};

function named(value: unknown): Option | null {
  if (!value || typeof value !== "object") return null;
  const { id, name } = value as { id?: unknown; name?: unknown };
  return typeof id === "string" && typeof name === "string"
    ? { id, name }
    : null;
}

export function useRuleOptions(projectId: string): RuleOptions {
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const { data: columns } = useGetColumns(projectId);
  const { data: members } = useGetWorkspaceUsers({ workspaceId });
  const { data: labels } = useGetLabelsByWorkspace(workspaceId);
  const { data: cycles } = useGetCycles(projectId, "all");
  const { data: modules } = useGetModules(projectId, "active");
  const { data: fields } = useGetCustomFieldsByProject(projectId);
  const { data: agents } = useAgents(workspaceId || undefined);

  return useMemo(
    () => ({
      columns: (columns ?? []).map((column) => ({
        id: column.id,
        name: column.name,
        slug: column.slug,
        group: (column as { group?: string }).group,
      })),
      people: (members ?? []).map((member) => ({
        id: member.userId,
        name: member.user.name || member.user.email,
      })),
      labels: [
        ...new Set(
          ((labels ?? []) as { name: string }[]).map((label) => label.name),
        ),
      ].sort((a, b) => a.localeCompare(b)),
      cycles: ((cycles ?? []) as unknown[]).flatMap((cycle) => {
        const option = named(cycle);
        return option ? [option] : [];
      }),
      modules: ((modules ?? []) as unknown[]).flatMap((module) => {
        const option = named(module);
        return option ? [option] : [];
      }),
      fields: ((fields ?? []) as unknown[]).flatMap((field) => {
        const option = named(field);
        return option ? [option] : [];
      }),
      agents: (agents ?? [])
        .filter((agent) => agent.enabled)
        .map((agent) => ({ id: agent.id, name: agent.name })),
    }),
    [columns, members, labels, cycles, modules, fields, agents],
  );
}

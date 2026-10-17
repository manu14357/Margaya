import { useId } from "react";
import { useTranslation } from "react-i18next";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import type { ApiKeyAccess } from "@/types/api-key";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { Radio, RadioGroup } from "../ui/radio-group";

// What a new API key may do: everything its owner can, reads only, or
// chosen permission areas; and optionally only some projects. The server
// stores the scope where clients can't change it.

export const API_KEY_AREAS = [
  "project",
  "task",
  "label",
  "cycle",
  "module",
  "view",
  "intake",
  "page",
  "analytics",
  "workspace",
  "audit_log",
  "ai",
] as const;
export type ApiKeyArea = (typeof API_KEY_AREAS)[number];
export type AreaLevel = "read" | "write";
export type ApiKeyAreas = Partial<Record<ApiKeyArea, AreaLevel>>;

const AREA_KEYS: Record<ApiKeyArea, string> = {
  project: "settings:workspaceRoles.resources.project",
  task: "settings:workspaceRoles.resources.task",
  label: "settings:workspaceRoles.resources.label",
  cycle: "settings:workspaceRoles.resources.cycle",
  module: "settings:workspaceRoles.resources.module",
  view: "settings:workspaceRoles.resources.view",
  intake: "settings:workspaceRoles.resources.intake",
  page: "settings:workspaceRoles.resources.page",
  analytics: "settings:workspaceRoles.resources.analytics",
  workspace: "settings:workspaceRoles.resources.workspace",
  audit_log: "settings:workspaceRoles.resources.audit_log",
  ai: "settings:workspaceRoles.resources.ai",
};

// Areas whose only action is reading.
const READ_ONLY_AREAS = new Set<ApiKeyArea>(["analytics", "audit_log"]);
// Areas with no read action: AI calls are writes (POSTs).
const WRITE_ONLY_AREAS = new Set<ApiKeyArea>(["ai"]);

const ACCESS: ApiKeyAccess[] = ["full", "read", "custom"];

const ACCESS_KEYS = {
  full: {
    label: "accountSecurity:platform.apiKeys.accessFull",
    hint: "accountSecurity:platform.apiKeys.accessFullHint",
  },
  read: {
    label: "accountSecurity:platform.apiKeys.accessRead",
    hint: "accountSecurity:platform.apiKeys.accessReadHint",
  },
  custom: {
    label: "accountSecurity:platform.apiKeys.accessCustom",
    hint: "accountSecurity:platform.apiKeys.accessCustomHint",
  },
} as const;

const LEVEL_KEYS = {
  none: "accountSecurity:platform.apiKeys.areaNone",
  read: "accountSecurity:platform.apiKeys.areaRead",
  write: "accountSecurity:platform.apiKeys.areaWrite",
} as const;

type ApiKeyScopeFieldsProps = {
  access: ApiKeyAccess;
  onAccessChange: (access: ApiKeyAccess) => void;
  areas: ApiKeyAreas;
  onAreasChange: (areas: ApiKeyAreas) => void;
  /** null: every project. */
  projectIds: string[] | null;
  onProjectIdsChange: (ids: string[] | null) => void;
  disabled?: boolean;
};

export function ApiKeyScopeFields({
  access,
  onAccessChange,
  areas,
  onAreasChange,
  projectIds,
  onProjectIdsChange,
  disabled,
}: ApiKeyScopeFieldsProps) {
  const { t } = useTranslation();
  const id = useId();

  const setLevel = (area: ApiKeyArea, level: AreaLevel | "none") => {
    const next = { ...areas };
    if (level === "none") delete next[area];
    else next[area] = level;
    onAreasChange(next);
  };

  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">
          {t("accountSecurity:platform.apiKeys.accessLabel")}
        </legend>
        <RadioGroup
          value={access}
          onValueChange={(value) => onAccessChange(value as ApiKeyAccess)}
          disabled={disabled}
          className="gap-2"
        >
          {ACCESS.map((option) => (
            <Label
              key={option}
              className="flex items-start gap-2 rounded-md border border-border p-3 font-normal has-data-checked:border-primary/48"
            >
              <Radio value={option} className="mt-0.5" />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">
                  {t(ACCESS_KEYS[option].label)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t(ACCESS_KEYS[option].hint)}
                </span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </fieldset>

      {access === "custom" && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">
            {t("accountSecurity:platform.apiKeys.areasLabel")}
          </legend>
          <div className="divide-y divide-border rounded-md border border-border">
            {API_KEY_AREAS.map((area) => {
              const current = areas[area] ?? "none";
              const levels = READ_ONLY_AREAS.has(area)
                ? (["none", "read"] as const)
                : WRITE_ONLY_AREAS.has(area)
                  ? (["none", "write"] as const)
                  : (["none", "read", "write"] as const);
              return (
                <div
                  key={area}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <span id={`${id}-${area}`} className="text-sm">
                    {t(AREA_KEYS[area])}
                  </span>
                  <RadioGroup
                    aria-labelledby={`${id}-${area}`}
                    value={current}
                    onValueChange={(value) =>
                      setLevel(area, value as AreaLevel | "none")
                    }
                    disabled={disabled}
                    className="flex-row gap-3"
                  >
                    {levels.map((level) => (
                      <Label
                        key={level}
                        className="flex items-center gap-1.5 text-xs font-normal"
                      >
                        <Radio value={level} />
                        {t(LEVEL_KEYS[level])}
                      </Label>
                    ))}
                  </RadioGroup>
                </div>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="space-y-2">
        <Label className="flex items-start gap-2 font-normal">
          <Checkbox
            checked={projectIds !== null}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onProjectIdsChange(checked ? [] : null)
            }
            className="mt-0.5"
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">
              {t("accountSecurity:platform.apiKeys.projectsLabel")}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t("accountSecurity:platform.apiKeys.projectsHint")}
            </span>
          </span>
        </Label>
        {projectIds !== null && (
          <ProjectChoices
            selected={projectIds}
            onChange={onProjectIdsChange}
            disabled={disabled}
          />
        )}
      </div>
    </div>
  );
}

function ProjectChoices({
  selected,
  onChange,
  disabled,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const { data: projects, isLoading } = useGetProjects({
    workspaceId: workspace?.id ?? "",
  });

  if (isLoading || !workspace) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("accountSecurity:platform.apiKeys.projectsLoading")}
      </p>
    );
  }
  if (!projects || projects.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("accountSecurity:platform.apiKeys.projectsEmpty")}
      </p>
    );
  }

  const toggle = (projectId: string, checked: boolean) =>
    onChange(
      checked
        ? [...selected, projectId]
        : selected.filter((id) => id !== projectId),
    );

  return (
    <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
      <p className="px-1 pb-1 text-xs text-muted-foreground">
        {t("accountSecurity:platform.apiKeys.projectsIn", {
          workspace: workspace.name,
        })}
      </p>
      {projects.map((project) => (
        <Label
          key={project.id}
          className="flex items-center gap-2 rounded px-1 py-1 text-sm font-normal hover:bg-muted"
        >
          <Checkbox
            checked={selected.includes(project.id)}
            disabled={disabled}
            onCheckedChange={(checked) => toggle(project.id, checked === true)}
          />
          <span className="truncate">{project.name}</span>
        </Label>
      ))}
    </div>
  );
}

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { useAiSkills } from "@/hooks/queries/ai/use-ai-assistant";
import useGetProjects from "@/hooks/queries/project/use-get-projects";

// The agent dialog's reach: the projects it may work in (null: all its
// role reaches), the shared skills it follows and whether it may go
// outside Margaya (web search and MCP connectors).

function toggle(list: readonly string[], id: string, on: boolean): string[] {
  return on
    ? [...new Set([...list, id])]
    : list.filter((entry) => entry !== id);
}

export function AgentAccessFields({
  workspaceId,
  projectIds,
  onProjectIds,
  skillIds,
  onSkillIds,
  webAccess,
  onWebAccess,
}: {
  workspaceId: string;
  projectIds: string[] | null;
  onProjectIds: (next: string[] | null) => void;
  skillIds: string[];
  onSkillIds: (next: string[]) => void;
  webAccess: boolean;
  onWebAccess: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const projects = useGetProjects({ workspaceId });
  const skills = useAiSkills(workspaceId);
  const projectRows = (Array.isArray(projects.data) ? projects.data : []) as {
    id: string;
    name: string;
  }[];
  // Agents serve everyone, so only shared skills can be given to them.
  const sharedSkills = (skills.data ?? []).filter((skill) => skill.shared);
  const limited = projectIds !== null;

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <p id={`${id}-scope`} className="font-medium text-sm">
          {t("ai:agents.fields.projects")}
        </p>
        <RadioGroup
          aria-labelledby={`${id}-scope`}
          className="gap-2"
          value={limited ? "some" : "all"}
          onValueChange={(value) =>
            onProjectIds(value === "some" ? (projectIds ?? []) : null)
          }
        >
          {(["all", "some"] as const).map((option) => (
            <label
              key={option}
              htmlFor={`${id}-scope-${option}`}
              className="flex items-center gap-2 text-sm"
            >
              <Radio id={`${id}-scope-${option}`} value={option} />
              {t(
                option === "all"
                  ? "ai:agents.fields.projectsAll"
                  : "ai:agents.fields.projectsSome",
              )}
            </label>
          ))}
        </RadioGroup>
        {limited && (
          <ul
            aria-label={t("ai:agents.fields.projects")}
            className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-md border border-border p-2"
          >
            {projectRows.map((project) => (
              <li key={project.id} className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-project-${project.id}`}
                  checked={projectIds.includes(project.id)}
                  onCheckedChange={(checked) =>
                    onProjectIds(
                      toggle(projectIds, project.id, checked === true),
                    )
                  }
                />
                <Label
                  htmlFor={`${id}-project-${project.id}`}
                  className="font-normal text-sm"
                >
                  {project.name}
                </Label>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground text-xs">
          {limited && projectIds.length === 0
            ? t("ai:agents.fields.projectsNone")
            : t("ai:agents.fields.projectsHint")}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <p id={`${id}-skills`} className="font-medium text-sm">
          {t("ai:agents.fields.skills")}
        </p>
        {sharedSkills.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t("ai:agents.fields.skillsEmpty")}
          </p>
        ) : (
          <ul
            aria-labelledby={`${id}-skills`}
            className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-md border border-border p-2"
          >
            {sharedSkills.map((skill) => (
              <li key={skill.id} className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-skill-${skill.id}`}
                  checked={skillIds.includes(skill.id)}
                  disabled={
                    !skillIds.includes(skill.id) && skillIds.length >= 10
                  }
                  onCheckedChange={(checked) =>
                    onSkillIds(toggle(skillIds, skill.id, checked === true))
                  }
                />
                <Label
                  htmlFor={`${id}-skill-${skill.id}`}
                  className="font-normal text-sm"
                >
                  {skill.name}
                </Label>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground text-xs">
          {t("ai:agents.fields.skillsHint")}
        </p>
      </div>
      <div className="flex items-start gap-2">
        <Switch
          id={`${id}-web`}
          checked={webAccess}
          onCheckedChange={onWebAccess}
        />
        <div className="flex flex-col gap-0.5">
          <Label htmlFor={`${id}-web`}>{t("ai:agents.fields.webAccess")}</Label>
          <p className="text-muted-foreground text-xs">
            {t("ai:agents.fields.webAccessHint")}
          </p>
        </div>
      </div>
    </>
  );
}

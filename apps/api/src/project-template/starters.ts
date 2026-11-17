import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { projectTable, workspaceTable } from "../database/schema";
import { publishEvent } from "../events";
import {
  type CreatedProject,
  createProjectInTransaction,
  publishProjectCreated,
} from "../project/controllers/create-project";
import { lockWorkspaceProjects } from "../project/slug";
import { getWorkspaceTimezone } from "../utils/timezone";
import {
  isValidTimezone,
  normalizeTimezone,
  todayInTimezone,
} from "../utils/zoned-date";
import { prepareTemplate } from "./apply";
import { findTemplate } from "./catalog";
import { resolveTemplate } from "./resolve";
import { type AppLocale, templateTextSource, textOrFallback } from "./text";
import type { TextKey, WorkspaceStarter } from "./types";

// Workspace starters: a named set of up to five templates a brand-new
// workspace creates in one step (plans/.../04-workspace-templates/starters.md).
// Their text lives in locales/_starters.json under "starters.<id>".
// Templates not registered yet are skipped, so the list can name the whole
// catalog while it ships in waves.

export const STARTER_NOT_FOUND = "Workspace starter not found";
export const WORKSPACE_NOT_EMPTY =
  "A starter applies only to a workspace without projects";
/** Each starter project gets at most this many example tasks. */
export const STARTER_SAMPLE_TASKS = 4;

function starter(
  id: string,
  icon: string,
  projects: [templateId: string, key: string, restricted?: boolean][],
): WorkspaceStarter {
  return {
    id,
    version: 1,
    icon,
    name: `projectTemplates:starters.${id}.name`,
    description: `projectTemplates:starters.${id}.description`,
    projects: projects.map(([templateId, key, restricted]) => ({
      templateId,
      key,
      name: `projectTemplates:starters.${id}.projects.${templateId}` as TextKey,
      ...(restricted ? { visibility: "restricted" as const } : {}),
    })),
  };
}

export const WORKSPACE_STARTERS: readonly WorkspaceStarter[] = [
  starter("software-team", "Code", [
    ["scrum", "SPR"],
    ["bug-tracking", "BUG"],
    ["development-requests", "REQ"],
    ["product-roadmap", "MAP"],
  ]),
  starter("product-team", "Lightbulb", [
    ["product-discovery", "DISC"],
    ["prioritization", "PRI"],
    ["product-roadmap", "MAP"],
    ["ux-design", "UX"],
  ]),
  starter("it-team", "CircuitBoard", [
    ["it-service-desk", "HELP"],
    ["it-operations", "OPS"],
    ["it-asset-management", "AST"],
  ]),
  starter("support-team", "Smile", [
    ["customer-support", "SUP"],
    ["bug-tracking", "BUG"],
    ["product-discovery", "FB"],
  ]),
  starter("marketing-team", "Radio", [
    ["campaign-management", "CAMP"],
    ["content-calendar", "CON"],
    ["marketing-assets", "AR"],
    ["event-planning", "EVT"],
  ]),
  starter("people-team", "Users", [
    ["hr-service-desk", "HR", true],
    ["recruitment", "HIRE", true],
    ["employee-reviews", "REV", true],
    ["policy-management", "POL"],
  ]),
  starter("finance-team", "Wallet", [
    ["finance-service-desk", "FIN", true],
    ["budget-planning", "BUD"],
    ["financial-close", "CLOSE"],
    ["procurement", "BUY"],
  ]),
  starter("sales-team", "Target", [
    ["sales-pipeline", "PIPE"],
    ["lead-tracking", "LEAD"],
    ["sales-support-desk", "DEAL"],
  ]),
  starter("agency", "Briefcase", [
    ["project-management", "CLI"],
    ["design-request-desk", "REQ"],
    ["task-tracking", "INT"],
  ]),
  starter("nonprofit", "Heart", [
    ["nonprofit-programs", "PROG"],
    ["grant-tracker", "GRANT"],
    ["community-management", "COM"],
  ]),
  starter("operations", "Cog", [
    ["general-service-desk", "REQ"],
    ["process-control", "IMP"],
    ["procurement", "BUY"],
    ["document-review", "DOC"],
  ]),
  starter("just-me", "User", [["personal-planner", "ME"]]),
];

/** A starter with only the projects whose template is registered. */
function available(starterDef: WorkspaceStarter): WorkspaceStarter | null {
  const projects = starterDef.projects.filter((project) =>
    findTemplate(project.templateId),
  );
  return projects.length > 0 ? { ...starterDef, projects } : null;
}

export function availableStarters(): WorkspaceStarter[] {
  return WORKSPACE_STARTERS.map(available).filter(
    (item): item is WorkspaceStarter => item !== null,
  );
}

export function findStarter(id: string): WorkspaceStarter | null {
  const found = WORKSPACE_STARTERS.find((item) => item.id === id);
  return found ? available(found) : null;
}

function text(locale: AppLocale, key: string): string {
  return textOrFallback(templateTextSource(), locale, key) ?? "";
}

export function starterSummaries(locale: AppLocale) {
  return availableStarters().map((item) => ({
    id: item.id,
    version: item.version,
    icon: item.icon,
    name: text(locale, item.name),
    description: text(locale, item.description),
    projects: item.projects.map((project) => {
      const template = findTemplate(project.templateId);
      return {
        templateId: project.templateId,
        key: project.key,
        name: project.name
          ? text(locale, project.name)
          : text(locale, template?.name ?? ""),
        icon: template?.icon ?? "Layout",
        visibility: project.visibility ?? "open",
      };
    }),
  }));
}

export async function applyStarter({
  workspaceId,
  userId,
  starterId,
  locale,
  sampleData,
  canCreateLabels,
  timezone,
}: {
  workspaceId: string;
  userId: string;
  starterId: string;
  locale: AppLocale;
  sampleData: boolean;
  canCreateLabels: boolean;
  /** Set the workspace's zone first (the route checked manage_settings). */
  timezone?: string;
}): Promise<CreatedProject[]> {
  const found = findStarter(starterId);
  if (!found) throw new HTTPException(404, { message: STARTER_NOT_FOUND });
  if (timezone !== undefined && !isValidTimezone(timezone)) {
    throw new HTTPException(400, { message: "Unknown time zone" });
  }

  // CPU work before the transaction.
  const source = templateTextSource();
  const plans = found.projects.map((project) => {
    const definition = findTemplate(project.templateId);
    if (!definition)
      throw new HTTPException(404, { message: STARTER_NOT_FOUND });
    const resolved = resolveTemplate(definition, locale, source);
    return {
      project,
      definition,
      name: project.name ? text(locale, project.name) : resolved.name,
      prepared: prepareTemplate(resolved),
    };
  });
  // Stored in Intl's own spelling, as the workspace settings route stores it.
  const requestedZone =
    timezone === undefined ? undefined : normalizeTimezone(timezone);
  const timeZone = requestedZone ?? (await getWorkspaceTimezone(workspaceId));
  const clock = { timeZone, today: todayInTimezone(timeZone) };

  let timezoneChanged = false;
  const created = await db.transaction(async (tx) => {
    await lockWorkspaceProjects(tx, workspaceId);
    const [existing] = await tx
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          isNull(projectTable.deletedAt),
        ),
      )
      .limit(1);
    if (existing)
      throw new HTTPException(409, { message: WORKSPACE_NOT_EMPTY });
    if (requestedZone !== undefined) {
      // Set in the same transaction as the empty-workspace check, so a 409
      // leaves the zone alone.
      if ((await getWorkspaceTimezone(workspaceId, tx)) !== requestedZone) {
        await tx
          .update(workspaceTable)
          .set({ timezone: requestedZone })
          .where(eq(workspaceTable.id, workspaceId));
        timezoneChanged = true;
      }
    }
    const results: Awaited<ReturnType<typeof createProjectInTransaction>>[] =
      [];
    for (const plan of plans) {
      results.push(
        await createProjectInTransaction(tx, {
          workspaceId,
          name: plan.name,
          icon: plan.definition.icon,
          slug: plan.project.key,
          userId,
          options: {
            visibility: plan.project.visibility ?? "open",
            template: {
              prepared: plan.prepared,
              canCreateLabels,
              sampleData,
              maxSampleTasks: STARTER_SAMPLE_TASKS,
            },
          },
          clock,
        }),
      );
    }
    return results;
  });

  if (timezoneChanged) {
    await publishEvent("workspace.settings_updated", {
      workspaceId,
      userId,
      changed: ["timezone"],
    });
  }
  for (const { project, labelsInserted } of created) {
    await publishProjectCreated(project, {
      workspaceId,
      userId,
      labelsInserted,
    });
  }
  return created.map(({ project }) => project);
}

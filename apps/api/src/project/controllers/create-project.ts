import { eq, max } from "drizzle-orm";
import db from "../../database";
import { columnTable, projectTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  type ApplyResult,
  applyTemplate,
  type PreparedTemplate,
} from "../../project-template/apply";
import { featureFields } from "../../project-template/resolve";
import type { Transaction } from "../../task/assignee-writes";
import { getWorkspaceTimezone, todayInTimezone } from "../../utils/timezone";
import { ensureProjectMembers } from "../access";
import {
  type CopyFromOptions,
  copiedProjectFields,
  copyProjectSetup,
  loadSourceProject,
} from "../copy-setup";
import { type ProjectFeature, projectFeatureField } from "../features";
import { assertProjectSlugAvailable, lockWorkspaceProjects } from "../slug";
import type { ProjectVisibility } from "../visibility";

export const DEFAULT_PROJECT_COLUMNS = [
  {
    name: "To Do",
    slug: "to-do",
    position: 0,
    group: "unstarted",
    isFinal: false,
  },
  {
    name: "In Progress",
    slug: "in-progress",
    position: 1,
    group: "started",
    isFinal: false,
  },
  {
    name: "In Review",
    slug: "in-review",
    position: 2,
    group: "started",
    isFinal: false,
  },
  {
    name: "Done",
    slug: "done",
    position: 3,
    group: "completed",
    isFinal: true,
  },
] as const;

/** A built-in template to apply while creating (project-template/). */
export type TemplateApplyOptions = {
  prepared: PreparedTemplate;
  /** label:create: missing workspace labels may be inserted. */
  canCreateLabels: boolean;
  /** Write the sample tasks (task:create was checked). */
  sampleData: boolean;
  /** Keep only the first sample tasks (workspace starters). */
  maxSampleTasks?: number;
};

export type CreateProjectOptions = {
  visibility?: ProjectVisibility;
  /** Feature switches; they win over a template's or a source's. */
  features?: Partial<Record<ProjectFeature, boolean>>;
  template?: TemplateApplyOptions;
};

export type CreatedProject = typeof projectTable.$inferSelect & {
  template?: ApplyResult["applied"];
};

type CreateInput = {
  workspaceId: string;
  name: string;
  icon: string;
  slug: string;
  userId?: string;
  copyFrom?: CopyFromOptions;
  options: CreateProjectOptions;
  /** The workspace's zone and local date, for template sample dates. */
  clock?: { timeZone: string; today: string };
};

/**
 * Creates one project inside a transaction that already holds the
 * workspace's project lock. Workspace starters call it once per project.
 */
export async function createProjectInTransaction(
  tx: Transaction,
  input: CreateInput,
): Promise<{ project: CreatedProject; labelsInserted: boolean }> {
  const { workspaceId, name, icon, slug, userId, copyFrom, options } = input;
  const visibility = options.visibility ?? "open";
  const template = options.template;
  await assertProjectSlugAvailable(tx, workspaceId, slug);
  const source = copyFrom
    ? await loadSourceProject(tx, workspaceId, copyFrom.projectId)
    : null;

  // New projects go to the bottom of the workspace's ordering.
  const [{ maxPosition } = { maxPosition: null }] = await tx
    .select({ maxPosition: max(projectTable.position) })
    .from(projectTable)
    .where(eq(projectTable.workspaceId, workspaceId));

  const resolved = template?.prepared.resolved;
  const templateFields = resolved
    ? {
        description: resolved.projectDescription,
        ...featureFields(resolved.definition.project.features),
        leadUserId:
          resolved.definition.project.lead === "creator"
            ? (userId ?? null)
            : null,
        defaultAssigneeUserId:
          resolved.definition.project.defaultAssignee === "creator"
            ? (userId ?? null)
            : null,
      }
    : {};
  // Only the switches the request sends; they win over the template's.
  const requestedFeatures = Object.fromEntries(
    Object.entries(options.features ?? {})
      .filter(([, value]) => typeof value === "boolean")
      .map(([feature, value]) => [
        projectFeatureField(feature as ProjectFeature),
        value,
      ]),
  );

  const [createdProject] = await tx
    .insert(projectTable)
    .values({
      workspaceId,
      name,
      icon,
      slug,
      position: maxPosition === null ? 0 : maxPosition + 1,
      ...(source ? await copiedProjectFields(tx, source) : {}),
      ...templateFields,
      ...requestedFeatures,
      visibility,
    })
    .returning();
  if (!createdProject) throw new Error("Project insert returned no row");

  // A restricted project starts with its creator as a member.
  if (visibility === "restricted") {
    await ensureProjectMembers(
      tx,
      createdProject.id,
      [userId, createdProject.leadUserId],
      userId ?? null,
    );
  }

  if (source && copyFrom && userId) {
    const { copiedTaskCount } = await copyProjectSetup(tx, {
      source,
      targetId: createdProject.id,
      userId,
      options: copyFrom,
    });
    return {
      project: { ...createdProject, lastTaskNumber: copiedTaskCount },
      labelsInserted: false,
    };
  }

  if (template && userId) {
    const clock = input.clock ?? {
      timeZone: "UTC",
      today: todayInTimezone("UTC"),
    };
    const result = await applyTemplate(tx, {
      projectId: createdProject.id,
      workspaceId,
      userId,
      prepared: template.prepared,
      canCreateLabels: template.canCreateLabels,
      sampleData: template.sampleData,
      maxSampleTasks: template.maxSampleTasks,
      today: clock.today,
      timeZone: clock.timeZone,
    });
    return {
      project: {
        ...createdProject,
        lastTaskNumber: result.sampleTaskIds.length,
        template: result.applied,
      },
      labelsInserted: result.labelsInserted,
    };
  }

  await tx.insert(columnTable).values(
    DEFAULT_PROJECT_COLUMNS.map((column) => ({
      projectId: createdProject.id,
      name: column.name,
      slug: column.slug,
      position: column.position,
      group: column.group,
      isFinal: column.isFinal,
    })),
  );
  return { project: createdProject, labelsInserted: false };
}

/** The workspace's time zone and today's local date there. */
export async function workspaceClock(workspaceId: string) {
  const timeZone = await getWorkspaceTimezone(workspaceId);
  return { timeZone, today: todayInTimezone(timeZone) };
}

/** Events for a created project, after commit. */
export async function publishProjectCreated(
  project: CreatedProject,
  {
    workspaceId,
    userId,
    copiedFromProjectId,
    labelsInserted,
  }: {
    workspaceId: string;
    userId?: string;
    copiedFromProjectId?: string;
    labelsInserted: boolean;
  },
) {
  await publishEvent("project.created", {
    projectId: project.id,
    workspaceId,
    userId: userId ?? null,
    name: project.name,
    slug: project.slug,
    ...(copiedFromProjectId ? { copiedFromProjectId } : {}),
    ...(project.template
      ? {
          templateId: project.template.id,
          templateVersion: project.template.version,
        }
      : {}),
  });
  if (labelsInserted) {
    await publishEvent("label.changed", { workspaceId, userId });
  }
}

async function createProject(
  workspaceId: string,
  name: string,
  icon: string,
  slug: string,
  userId?: string,
  /** Start from an existing project's setup (see copy-setup.ts). */
  copyFrom?: CopyFromOptions,
  options: CreateProjectOptions = {},
): Promise<CreatedProject> {
  // Outside the transaction: no locks held while reading the zone.
  const clock = options.template
    ? await workspaceClock(workspaceId)
    : undefined;
  const { project, labelsInserted } = await db.transaction(async (tx) => {
    // Serialize ordering writes per workspace: without this, two concurrent
    // creates can read the same max(position) and land on the same slot, and a
    // create can interleave with a reorder's renumber. The lock also makes the
    // key uniqueness check race-free.
    await lockWorkspaceProjects(tx, workspaceId);
    return createProjectInTransaction(tx, {
      workspaceId,
      name,
      icon,
      slug,
      userId,
      copyFrom,
      options,
      clock,
    });
  });

  await publishProjectCreated(project, {
    workspaceId,
    userId,
    copiedFromProjectId: copyFrom?.projectId,
    labelsInserted,
  });
  return project;
}

export default createProject;

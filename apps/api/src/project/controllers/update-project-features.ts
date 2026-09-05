import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  PROJECT_FEATURE_KEYS,
  type ProjectFeature,
  type ProjectFeatureField,
  projectFeatureField,
} from "../features";

type FeatureChanges = Partial<Record<ProjectFeatureField, boolean>>;

async function updateProjectFeatures({
  projectId,
  workspaceId,
  userId,
  changes,
}: {
  projectId: string;
  workspaceId: string;
  userId: string;
  changes: FeatureChanges;
}) {
  const requested = PROJECT_FEATURE_KEYS.filter(
    (feature) => changes[projectFeatureField(feature)] !== undefined,
  );

  if (requested.length === 0) {
    throw new HTTPException(400, {
      message: "Provide at least one feature to change",
    });
  }

  const [existing] = await db
    .select()
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new HTTPException(404, { message: "Project not found" });
  }

  const enabled: ProjectFeature[] = [];
  const disabled: ProjectFeature[] = [];
  const set: FeatureChanges = {};

  for (const feature of requested) {
    const field = projectFeatureField(feature);
    const next = changes[field];
    if (next === undefined || next === existing[field]) continue;
    set[field] = next;
    (next ? enabled : disabled).push(feature);
  }

  // A no-op request answers with the current row and publishes nothing.
  if (enabled.length === 0 && disabled.length === 0) {
    return existing;
  }

  const [updated] = await db
    .update(projectTable)
    .set(set)
    .where(eq(projectTable.id, projectId))
    .returning();

  if (!updated) {
    throw new HTTPException(500, {
      message: "Failed to update project features",
    });
  }

  await publishEvent("project.features_updated", {
    projectId,
    workspaceId,
    userId,
    enabled,
    disabled,
  });

  return updated;
}

export default updateProjectFeatures;

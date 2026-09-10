import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { cycleTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { projectToday } from "../../utils/timezone";
import { deriveCycleStatus } from "../dates";
import { findOverlappingCycle } from "../queries";
import {
  assertOwner,
  type CycleRecord,
  type DatePair,
  getCycleResponse,
  lockCycle,
  lockProject,
  OVERLAP_MESSAGE,
  resolveDatePair,
} from "./shared";

export type UpdateCycleInput = {
  name?: string;
  description?: string;
  startDate?: string | null;
  endDate?: string | null;
  ownerId?: string | null;
  sortOrder?: number;
};

type CycleValues = Partial<
  Pick<
    CycleRecord,
    "name" | "description" | "startDate" | "endDate" | "ownerId" | "sortOrder"
  >
>;

function sentKeys(input: UpdateCycleInput): string[] {
  return Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
}

/** Status rules: archived and completed cycles are frozen, a running one keeps its start. */
function assertEditable(
  cycle: CycleRecord,
  input: UpdateCycleInput,
  dates: DatePair | undefined,
  today: string,
) {
  if (cycle.archivedAt) {
    throw new HTTPException(409, {
      message: "Restore the cycle before editing it",
    });
  }

  const status = deriveCycleStatus(cycle, today);
  if (
    status === "completed" &&
    sentKeys(input).some((key) => key !== "sortOrder")
  ) {
    throw new HTTPException(409, {
      message: "Completed cycles can't be edited",
    });
  }

  if (status === "current" && dates) {
    if (dates.startDate === null || dates.endDate === null) {
      throw new HTTPException(409, { message: "A running cycle needs dates" });
    }
    if (dates.startDate !== cycle.startDate) {
      throw new HTTPException(409, {
        message: "A running cycle's start date can't change",
      });
    }
    if (dates.endDate < today) {
      throw new HTTPException(400, {
        message: "A running cycle can't end in the past",
      });
    }
  }
}

function changedValues(
  cycle: CycleRecord,
  input: UpdateCycleInput,
  dates: DatePair | undefined,
): CycleValues {
  const next: CycleValues = {
    name: input.name,
    description: input.description,
    ownerId: input.ownerId,
    sortOrder: input.sortOrder,
    ...(dates ?? {}),
  };
  const values: CycleValues = {};
  for (const [key, value] of Object.entries(next) as Array<
    [keyof CycleValues, CycleValues[keyof CycleValues]]
  >) {
    if (value !== undefined && value !== cycle[key]) {
      Object.assign(values, { [key]: value });
    }
  }
  return values;
}

async function updateCycle({
  cycleId,
  projectId,
  workspaceId,
  userId,
  input,
}: {
  cycleId: string;
  projectId: string;
  workspaceId: string;
  userId: string;
  input: UpdateCycleInput;
}) {
  const dates = resolveDatePair(input.startDate, input.endDate);
  if (input.ownerId) await assertOwner(input.ownerId, workspaceId);

  const changes = await db.transaction(async (tx) => {
    // Date writes lock the project first (then the cycle), like create.
    if (dates) await lockProject(tx, projectId);
    const cycle = await lockCycle(tx, cycleId);
    const today = await projectToday(projectId, tx);
    assertEditable(cycle, input, dates, today);

    if (dates?.startDate && dates.endDate) {
      const overlap = await findOverlappingCycle(tx, {
        projectId: cycle.projectId,
        startDate: dates.startDate,
        endDate: dates.endDate,
        excludeId: cycle.id,
      });
      if (overlap) throw new HTTPException(409, { message: OVERLAP_MESSAGE });
    }

    const values = changedValues(cycle, input, dates);
    const changed = Object.keys(values);
    if (changed.length > 0) {
      await tx.update(cycleTable).set(values).where(eq(cycleTable.id, cycleId));
    }
    return changed;
  });

  if (changes.length > 0) {
    await publishEvent("cycle.updated", {
      cycleId,
      projectId,
      userId,
      changes,
    });
  }

  return getCycleResponse(cycleId);
}

export default updateCycle;

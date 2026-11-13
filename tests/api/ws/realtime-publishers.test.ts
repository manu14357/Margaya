import { beforeEach, describe, expect, it, vi } from "vitest";

// The writes that had no realtime event: each now publishes one after the
// write, which ws/workspace-hints.ts turns into user-socket hints.

const m = vi.hoisted(() => ({
  publishEvent: vi.fn(),
  deleted: [] as unknown[][],
  label: {
    id: "label-1",
    taskId: null as string | null,
    workspaceId: "ws-1",
    name: "Old",
    color: "#000000",
    deletionStartedAt: null,
  },
}));

vi.mock("../../../apps/api/src/events", () => ({
  publishEvent: m.publishEvent,
  subscribeToEvent: vi.fn(),
}));

function chain(result: unknown) {
  // update().set().where() is awaited directly or followed by returning().
  const where = () =>
    Object.assign(Promise.resolve(result), {
      returning: async () => result,
    });
  return { set: () => ({ where }), where };
}

vi.mock("../../../apps/api/src/database", () => {
  const tx = {
    query: { labelTable: { findFirst: async () => m.label } },
    update: () => chain([{ ...m.label, name: "New" }]),
  };
  return {
    default: {
      transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
      update: () => chain([]),
      delete: () => ({
        where: () => ({
          returning: async () => m.deleted.shift() ?? [],
        }),
      }),
    },
  };
});

import { removeEntityReferences } from "../../../apps/api/src/entity-reference/registry";
import updateLabel from "../../../apps/api/src/label/controllers/update-label";
import { setUserTimezone } from "../../../apps/api/src/user/controllers/user-timezone";

beforeEach(() => {
  m.publishEvent.mockReset();
  m.deleted = [];
});

describe("label rename", () => {
  it("publishes label.changed for the workspace after the write", async () => {
    await updateLabel("label-1", "New", "#ffffff");
    expect(m.publishEvent).toHaveBeenCalledWith("label.changed", {
      workspaceId: "ws-1",
    });
  });
});

describe("time zone", () => {
  it("publishes user.profile_changed for the person", async () => {
    await setUserTimezone("user-1", "Europe/Berlin");
    expect(m.publishEvent).toHaveBeenCalledWith("user.profile_changed", {
      userId: "user-1",
    });
  });
});

describe("removing favorites and recent visits", () => {
  it("names the people whose rows went", async () => {
    m.deleted = [
      [{ userId: "bob", workspaceId: "ws-1" }],
      [{ userId: "carol", workspaceId: "ws-1" }],
    ];
    await removeEntityReferences("cycle", ["cycle-1"]);
    expect(m.publishEvent).toHaveBeenCalledWith("entity_reference.removed", {
      entityType: "cycle",
      holders: [
        { userId: "bob", workspaceId: "ws-1" },
        { userId: "carol", workspaceId: "ws-1" },
      ],
    });
  });

  it("publishes nothing when nobody held the entity", async () => {
    await removeEntityReferences("view", ["view-1"]);
    expect(m.publishEvent).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import {
  addMissingResources,
  BASELINE_ROLE_RESOURCES,
  pendingBackfillResources,
} from "../../../apps/api/src/utils/backfill-role-permissions";

describe("pendingBackfillResources", () => {
  it("offers every non-baseline resource of the built-in roles until applied", () => {
    expect(pendingBackfillResources(new Set())).toEqual([
      "ai",
      "analytics",
      "audit_log",
      "cycle",
      "intake",
      "module",
      "page",
      "view",
    ]);
    expect(pendingBackfillResources(new Set(["cycle"]))).toEqual([
      "ai",
      "analytics",
      "audit_log",
      "intake",
      "module",
      "page",
      "view",
    ]);
    expect(
      pendingBackfillResources(
        new Set([
          "ai",
          "analytics",
          "audit_log",
          "cycle",
          "intake",
          "module",
          "page",
          "view",
        ]),
      ),
    ).toEqual([]);
  });

  it("picks up future resources without code changes", () => {
    const base = { project: ["read"], task: ["read"], cycle: ["read"] };
    const payloads = {
      viewer: { ...base, module: ["read"] },
      member: { ...base, page: ["read"] },
      admin: base,
    };
    expect(pendingBackfillResources(new Set(["cycle"]), payloads)).toEqual([
      "module",
      "page",
    ]);
  });

  it("never backfills the resources that predate it", () => {
    expect([...BASELINE_ROLE_RESOURCES].sort()).toEqual([
      "ac",
      "invitation",
      "label",
      "member",
      "organization",
      "project",
      "task",
      "team",
      "workspace",
    ]);
  });
});

describe("addMissingResources", () => {
  const defaults = { task: ["read"], cycle: ["create", "read", "update"] };

  it("adds a missing resource with the default actions", () => {
    const stored = { task: ["read", "update"] };
    const next = addMissingResources(stored, defaults, ["cycle"]);
    expect(next).toEqual({
      task: ["read", "update"],
      cycle: ["create", "read", "update"],
    });
    // The stored object and the defaults are not mutated.
    expect(stored).toEqual({ task: ["read", "update"] });
    next?.cycle?.push("delete");
    expect(defaults.cycle).toEqual(["create", "read", "update"]);
  });

  it("never changes a resource the row already has", () => {
    expect(
      addMissingResources({ cycle: ["read"] }, defaults, ["cycle"]),
    ).toBeNull();
    expect(addMissingResources({ cycle: [] }, defaults, ["cycle"])).toBeNull();
  });

  it("skips resources the role does not grant", () => {
    expect(addMissingResources({}, { task: ["read"] }, ["cycle"])).toBeNull();
    expect(addMissingResources({}, { cycle: [] }, ["cycle"])).toBeNull();
  });

  it("only touches the pending resources", () => {
    expect(addMissingResources({}, defaults, [])).toBeNull();
    expect(addMissingResources({}, defaults, ["cycle"])).toEqual({
      cycle: ["create", "read", "update"],
    });
  });
});

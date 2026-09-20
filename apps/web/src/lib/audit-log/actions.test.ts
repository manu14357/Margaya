import enUS from "@i18n/en-US.json";
import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTION_KEYS,
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_KEYS,
  auditActionSentence,
  UNKNOWN_ACTION_KEY,
} from "./actions";
import { auditLogQuery, isFiltered } from "./filters";

function lookup(key: string): unknown {
  const [namespace, path] = key.split(":");
  let node: unknown = (enUS as Record<string, unknown>)[namespace as string];
  for (const part of (path ?? "").split(".")) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  return node;
}

describe("audit action sentences", () => {
  it("maps every known action to an English sentence", () => {
    for (const [action, key] of Object.entries(AUDIT_ACTION_KEYS)) {
      const text = lookup(key);
      expect(typeof text, `${action} → ${key}`).toBe("string");
      expect((text as string).length).toBeGreaterThan(3);
    }
  });

  it("gives each action its own sentence", () => {
    const keys = Object.values(AUDIT_ACTION_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("resolves known and unknown actions", () => {
    expect(auditActionSentence("member.role_changed")).toEqual({
      key: "settings:workspaceAuditLog.actions.memberRoleChanged",
      values: {},
    });
    expect(auditActionSentence("future.thing")).toEqual({
      key: UNKNOWN_ACTION_KEY,
      values: { action: "future.thing" },
    });
    expect(lookup(UNKNOWN_ACTION_KEY)).toBe("{{action}}");
  });

  it("labels every category, and every action belongs to one", () => {
    for (const category of AUDIT_CATEGORIES) {
      expect(typeof lookup(AUDIT_CATEGORY_KEYS[category])).toBe("string");
    }
    for (const action of Object.keys(AUDIT_ACTION_KEYS)) {
      expect(AUDIT_CATEGORIES).toContain(action.split(".")[0]);
    }
  });
});

describe("audit log filters", () => {
  it("turns filters into the API query", () => {
    const now = new Date("2026-10-14T12:00:00.000Z");
    expect(
      auditLogQuery(
        "ws1",
        { actorId: "u1", category: "member", range: "7d" },
        now,
      ),
    ).toEqual({
      workspaceId: "ws1",
      actorId: "u1",
      action: "member.",
      from: "2026-10-07T12:00:00.000Z",
    });
    expect(
      auditLogQuery("ws1", { actorId: null, category: null, range: "all" }),
    ).toEqual({
      workspaceId: "ws1",
      actorId: undefined,
      action: undefined,
      from: undefined,
    });
  });

  it("knows when anything is filtered", () => {
    expect(isFiltered({ actorId: null, category: null, range: "all" })).toBe(
      false,
    );
    expect(isFiltered({ actorId: null, category: null, range: "1d" })).toBe(
      true,
    );
  });
});

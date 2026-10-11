import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INTEGRATED_INTERNAL_EVENTS,
  matchesPatterns,
  UnknownWebhookEventError,
  validatePatterns,
  WEBHOOK_EVENTS,
  WEBHOOK_EXCLUDED_EVENTS,
  WEBHOOK_FAMILIES,
  WEBHOOK_PING_EVENT,
  WEBHOOK_SOURCE_EVENTS,
  webhookEventCatalog,
  webhookSourceFor,
} from "../../../apps/api/src/webhook/catalog";

const SOURCE_ROOT = resolve(__dirname, "../../../apps/api/src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** Event names passed to publishEvent as literals or literal ternaries. */
function publishedLiterals(): Set<string> {
  const names = new Set<string>();
  const literal = /publishEvent\(\s*"([a-z_.-]+)"/g;
  const ternary =
    /publishEvent\(\s*[\w.!]+\s*\?\s*"([a-z_.-]+)"\s*:\s*"([a-z_.-]+)"/g;
  for (const file of sourceFiles(SOURCE_ROOT)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(literal)) names.add(match[1] ?? "");
    for (const match of text.matchAll(ternary)) {
      names.add(match[1] ?? "");
      names.add(match[2] ?? "");
    }
  }
  names.delete("");
  return names;
}

describe("webhook catalog completeness", () => {
  it("maps or excludes every integrated internal event", () => {
    const known = new Set([
      ...WEBHOOK_SOURCE_EVENTS,
      ...Object.keys(WEBHOOK_EXCLUDED_EVENTS),
    ]);
    for (const name of INTEGRATED_INTERNAL_EVENTS) {
      expect(known.has(name), name).toBe(true);
    }
  });

  it("never maps an excluded event", () => {
    for (const name of Object.keys(WEBHOOK_EXCLUDED_EVENTS)) {
      expect(webhookSourceFor(name), name).toBeNull();
    }
  });

  it("knows every event name the API publishes", () => {
    const known = new Set(INTEGRATED_INTERNAL_EVENTS);
    const missing = [...publishedLiterals()].filter((name) => !known.has(name));
    expect(missing).toEqual([]);
  });

  it("knows the events published through constants and variables", () => {
    for (const name of [
      "intake.item_created",
      "intake.item_updated",
      "intake.item_deleted",
      "estimate.created",
      "estimate.updated",
      "estimate.deleted",
      "estimate.activated",
      "task-relation.created",
      "task-relation.deleted",
      "task.link_created",
      "task.link_updated",
      "task.link_deleted",
      "page.locked",
      "page.unlocked",
      "task.label_deleted",
      "export.status_changed",
      "integration.created",
      "project.created",
      "project.updated",
      "project.deleted",
      "publication.published",
      "publication.unpublished",
      "publication.updated",
    ]) {
      expect(INTEGRATED_INTERNAL_EVENTS, name).toContain(name);
    }
  });

  it("keeps export progress and personal data out", () => {
    for (const name of [
      "export.status_changed",
      "favorite.changed",
      "task_draft.changed",
      "notification.created",
      "task.subscription_changed",
      "page.reordered",
      "publication.participant_blocked",
      "publication.participant_unblocked",
      "instance.settings_updated",
      "instance.admin_added",
      "instance.admin_removed",
    ]) {
      expect(WEBHOOK_EXCLUDED_EVENTS[name], name).toBeTruthy();
    }
  });

  it("maps the public board events into the project and task families", () => {
    expect(webhookSourceFor("publication.published")?.event).toBe(
      "project.published",
    );
    expect(webhookSourceFor("publication.unpublished")?.event).toBe(
      "project.unpublished",
    );
    expect(webhookSourceFor("publication.updated")?.event).toBe(
      "project.publication_updated",
    );
    expect(webhookSourceFor("publication.link_rotated")?.event).toBe(
      "project.public_link_rotated",
    );
    const vote = webhookSourceFor("task.vote_changed");
    expect(vote?.event).toBe("task.vote_changed");
    expect(vote?.privacy).toContain("triage");
    expect(vote?.changes({ value: 1, up: 3, down: 1 })).toEqual({
      vote: { value: 1, up: 3, down: 1 },
    });
  });

  it("skips comment hints that name no comment", () => {
    const updated = webhookSourceFor("comment.updated");
    expect(updated?.skip?.({ taskId: "t", changes: ["visibility"] })).toBe(
      true,
    );
    expect(updated?.skip?.({ id: "c", taskId: "t" })).toBe(false);
    expect(updated?.changes({ id: "c", changes: ["visibility"] })).toEqual({
      visibility: null,
    });
  });

  it("has unique public names, and every family has an event", () => {
    const names = WEBHOOK_EVENTS.map((event) => event.name);
    expect(new Set(names).size).toBe(names.length);
    for (const family of WEBHOOK_FAMILIES) {
      expect(
        WEBHOOK_EVENTS.some((event) => event.family === family),
        family,
      ).toBe(true);
    }
    expect(names).not.toContain(WEBHOOK_PING_EVENT);
  });

  it("keeps the names the per-project webhook already uses", () => {
    for (const name of [
      "task.created",
      "task.status_changed",
      "task.priority_changed",
      "task.title_changed",
      "task.description_changed",
      "task.deleted",
      "task.moved",
      "task.due_date_changed",
      "task.assignee_changed",
      "task.unassigned",
      "comment.created",
    ]) {
      expect(names()).toContain(name);
    }
    function names() {
      return WEBHOOK_EVENTS.map((event) => event.name);
    }
  });

  it("maps internal names to the public contract", () => {
    expect(webhookSourceFor("task-relation.created")?.event).toBe(
      "task.relation_created",
    );
    expect(webhookSourceFor("time-entry.created")?.event).toBe(
      "time_entry.created",
    );
    expect(webhookSourceFor("task.label_created")?.event).toBe(
      "task.label_added",
    );
    expect(webhookSourceFor("task.label_deleted")?.event).toBe(
      "task.label_removed",
    );
    expect(webhookSourceFor("project.features_updated")?.event).toBe(
      "project.updated",
    );
    expect(webhookSourceFor("task.automation_applied")?.entity).toBe("project");
  });

  it("lists every family in the catalog response", () => {
    const catalog = webhookEventCatalog();
    expect(catalog.families.map((family) => family.key)).toEqual([
      ...WEBHOOK_FAMILIES,
    ]);
    const task = catalog.families.find((family) => family.key === "task");
    expect(task?.events).toContainEqual({
      name: "task.status_changed",
      entity: "task",
    });
  });
});

describe("webhook patterns", () => {
  it("dedupes, trims and sorts", () => {
    expect(
      validatePatterns([" task.* ", "comment.created", "task.*", "*"]),
    ).toEqual(["*", "comment.created", "task.*"]);
  });

  it("rejects unknown families, unknown names and webhook.ping", () => {
    for (const bad of ["tasks.*", "task.exploded", "webhook.ping", "", "*.*"]) {
      expect(() => validatePatterns([bad]), bad).toThrow(
        UnknownWebhookEventError,
      );
    }
    expect(() => validatePatterns(["nope"])).toThrow("Unknown event: nope");
  });

  it("matches *, a family and an exact name", () => {
    expect(matchesPatterns(["*"], "task.created")).toBe(true);
    expect(matchesPatterns(["task.*"], "task.created")).toBe(true);
    expect(matchesPatterns(["task.created"], "task.created")).toBe(true);
    expect(matchesPatterns(["cycle.*"], "task.created")).toBe(false);
    expect(matchesPatterns(["task.updated"], "task.created")).toBe(false);
  });

  it("never matches pings or unknown events", () => {
    expect(matchesPatterns(["*"], WEBHOOK_PING_EVENT)).toBe(false);
    expect(matchesPatterns(["*"], "favorite.changed")).toBe(false);
  });
});

describe("change extraction", () => {
  it("reads old and new values", () => {
    const status = webhookSourceFor("task.status_changed");
    expect(
      status?.changes({ oldStatus: "to-do", newStatus: "done", taskId: "t" }),
    ).toEqual({ status: { old: "to-do", new: "done" } });
  });

  it("turns changed-field lists into names", () => {
    expect(
      webhookSourceFor("cycle.updated")?.changes({
        changes: ["name", "endDate"],
      }),
    ).toEqual({ name: null, endDate: null });
  });

  it("describes one assignee per event", () => {
    expect(
      webhookSourceFor("task.assignee_changed")?.changes({
        newAssigneeId: "u1",
        newAssignee: "Ada",
      }),
    ).toEqual({ assignee: { added: { id: "u1", name: "Ada" } } });
    expect(
      webhookSourceFor("task.unassigned")?.changes({
        oldAssigneeId: "u2",
        oldAssignee: "Bo",
      }),
    ).toEqual({ assignee: { removed: { id: "u2", name: "Bo" } } });
  });

  it("uses the creator, not the assignee, as task.created's actor", () => {
    const created = webhookSourceFor("task.created");
    expect(created?.actor({ userId: "assignee", currentUserId: "me" })).toBe(
      "me",
    );
    expect(created?.actor({ userId: "assignee" })).toBeNull();
  });

  it("skips relations removed with their task", () => {
    expect(
      webhookSourceFor("task-relation.deleted")?.skip?.({
        origin: "task_deleted",
      }),
    ).toBe(true);
    expect(
      webhookSourceFor("task-relation.deleted")?.skip?.({ origin: "user" }),
    ).toBe(false);
  });

  it("coalesces content updates per page", () => {
    expect(
      webhookSourceFor("page.content_updated")?.coalesceKey?.({
        pageId: "p1",
      }),
    ).toBe("page:p1");
    expect(webhookSourceFor("page.updated")?.coalesceKey).toBeUndefined();
  });

  it("applies the privacy filters", () => {
    expect(webhookSourceFor("page.created")?.privacy).toContain("page");
    expect(webhookSourceFor("view.updated")?.privacy).toContain("view");
    expect(webhookSourceFor("task.title_changed")?.privacy).toContain("triage");
    expect(webhookSourceFor("comment.created")?.privacy).toContain("triage");
    expect(webhookSourceFor("time-entry.created")?.privacy).toEqual([
      "triage",
      "time_tracking",
    ]);
    expect(webhookSourceFor("intake.item_created")?.privacy).toEqual([]);
  });
});

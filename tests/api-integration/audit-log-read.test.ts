import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAuditLogRetention } from "../../apps/api/src/audit-log/retention";
import db from "../../apps/api/src/database";
import { auditLogTable } from "../../apps/api/src/database/schema";
import { createApiKey } from "./helpers/api-keys";
import { auditRows } from "./helpers/audit-log";
import { resetTestDatabase } from "./helpers/database";
import { draftScene } from "./helpers/drafts";

type EntryJson = {
  id: string;
  action: string;
  actor: {
    type: string;
    userId: string | null;
    apiKeyId: string | null;
    name: string | null;
    image: string | null;
  };
  target: { type: string; id: string | null; label: string | null } | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};
type PageJson = { items: EntryJson[]; nextCursor: string | null };

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => resetTestDatabase());
afterEach(() => {
  delete process.env.AUDIT_LOG_RETENTION_DAYS;
});

async function scene() {
  const s = await draftScene();
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY);
  const insert = (
    values: Partial<typeof auditLogTable.$inferInsert> & {
      action: string;
    },
  ) =>
    db
      .insert(auditLogTable)
      .values({
        workspaceId: s.workspaceId,
        actorType: "user",
        actorUserId: s.owner.id,
        actorName: "Owen",
        ...values,
      })
      .returning()
      .then((rows) => rows[0] as typeof auditLogTable.$inferSelect);

  await insert({
    action: "member.invited",
    targetType: "invitation",
    targetLabel: "a@example.com",
    createdAt: at(5),
  });
  await insert({
    action: "member.role_changed",
    actorUserId: s.ada.id,
    actorName: "Ada",
    targetType: "user",
    targetLabel: "=HYPERLINK(1)",
    metadata: { changes: { role: { before: "member", after: "admin" } } },
    createdAt: at(4),
  });
  await insert({
    action: "webhook.created",
    targetType: "webhook",
    targetLabel: "Deploys",
    createdAt: at(3),
  });
  await insert({
    action: "project.created",
    targetType: "project",
    targetLabel: "Web",
    createdAt: at(2),
  });
  await insert({
    action: "webhook.deleted",
    actorType: "api_key",
    apiKeyId: "key-1",
    actorName: "CI",
    targetType: "webhook",
    targetLabel: "Deploys",
    createdAt: at(1),
  });
  // Another workspace's entry never shows.
  await insert({
    workspaceId: s.outsiderWorkspaceId,
    action: "webhook.created",
    createdAt: at(1),
  });

  const list = (user = s.owner, query = "") =>
    s.ok<PageJson>(
      user,
      "GET",
      `/audit-log?workspaceId=${s.workspaceId}${query}`,
    );
  return { ...s, insert, at, list };
}

describe("GET /audit-log", () => {
  it("is for owners and admins only", async () => {
    const s = await scene();
    for (const user of [s.mia, s.vic]) {
      const response = await s.as(user)(
        "GET",
        `/audit-log?workspaceId=${s.workspaceId}`,
      );
      expect(response.status).toBe(403);
    }
    const outsider = await s.as(s.outsider)(
      "GET",
      `/audit-log?workspaceId=${s.workspaceId}`,
    );
    expect(outsider.status).toBe(403);
    expect((await s.list(s.ada)).items).toHaveLength(5);
    expect((await s.list(s.owner)).items).toHaveLength(5);
  });

  it("refuses an API key without the audit_log scope", async () => {
    const s = await scene();
    const scoped = await createApiKey(s.owner, { project: ["read"] });
    const response = await s.app.request(
      `/api/audit-log?workspaceId=${s.workspaceId}`,
      { headers: scoped.headers },
    );
    expect(response.status).toBe(403);
    const full = await createApiKey(s.owner, { audit_log: ["read"] });
    const allowed = await s.app.request(
      `/api/audit-log?workspaceId=${s.workspaceId}`,
      { headers: full.headers },
    );
    expect(allowed.status).toBe(200);
  });

  it("lists newest first with actor and target", async () => {
    const s = await scene();
    const { items, nextCursor } = await s.list();
    expect(items.map((item) => item.action)).toEqual([
      "webhook.deleted",
      "project.created",
      "webhook.created",
      "member.role_changed",
      "member.invited",
    ]);
    expect(nextCursor).toBeNull();
    expect(items[0]).toMatchObject({
      actor: { type: "api_key", apiKeyId: "key-1", name: "CI" },
      target: { type: "webhook", label: "Deploys" },
    });
    expect(items[3]).toMatchObject({
      actor: { type: "user", userId: s.ada.id, name: "Ada" },
      metadata: { changes: { role: { before: "member", after: "admin" } } },
    });
    expect(items[3]?.actor.image).toBe(s.ada.image);
  });

  it("filters by action prefix, action, actor, actor type, target type and dates", async () => {
    const s = await scene();
    const actions = async (query: string) =>
      (await s.list(s.owner, query)).items.map((item) => item.action);

    expect(await actions("&action=member")).toEqual([
      "member.role_changed",
      "member.invited",
    ]);
    expect(await actions("&action=webhook.")).toEqual([
      "webhook.deleted",
      "webhook.created",
    ]);
    expect(await actions("&action=webhook.created")).toEqual([
      "webhook.created",
    ]);
    expect(await actions(`&actorId=${s.ada.id}`)).toEqual([
      "member.role_changed",
    ]);
    expect(await actions("&actorType=api_key")).toEqual(["webhook.deleted"]);
    expect(await actions("&targetType=project")).toEqual(["project.created"]);
    const from = encodeURIComponent(s.at(3.5).toISOString());
    const to = encodeURIComponent(s.at(1.5).toISOString());
    expect(await actions(`&from=${from}&to=${to}`)).toEqual([
      "project.created",
      "webhook.created",
    ]);
    const bad = await s.as(s.owner)(
      "GET",
      `/audit-log?workspaceId=${s.workspaceId}&from=yesterday`,
    );
    expect(bad.status).toBe(400);
  });

  it("pages with a cursor", async () => {
    const s = await scene();
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = `&limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const page = await s.list(s.owner, query);
      seen.push(...page.items.map((item) => item.action));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual([
      "webhook.deleted",
      "project.created",
      "webhook.created",
      "member.role_changed",
      "member.invited",
    ]);
    const invalid = await s.as(s.owner)(
      "GET",
      `/audit-log?workspaceId=${s.workspaceId}&cursor=nope`,
    );
    expect(invalid.status).toBe(400);
  });
});

describe("GET /audit-log/export", () => {
  it("returns the filtered log as CSV for permitted callers", async () => {
    const s = await scene();
    const denied = await s.as(s.mia)(
      "GET",
      `/audit-log/export?workspaceId=${s.workspaceId}`,
    );
    expect(denied.status).toBe(403);

    const response = await s.as(s.ada)(
      "GET",
      `/audit-log/export?workspaceId=${s.workspaceId}&action=member`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const text = (await response.text()).replace(/^﻿/, "");
    const lines = text.trim().split("\r\n");
    expect(lines[0]).toContain('"time","action","actor_type"');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"member.role_changed"');
    // Spreadsheet formulas are neutralized.
    expect(lines[1]).toContain(`"'=HYPERLINK(1)"`);
    expect(lines[2]).toContain('"member.invited"');
  });
});

describe("audit log retention", () => {
  it("purges entries older than AUDIT_LOG_RETENTION_DAYS (default 365)", async () => {
    const s = await scene();
    await s.insert({ action: "project.created", createdAt: s.at(400) });
    await s.insert({ action: "project.created", createdAt: s.at(40) });

    expect((await runAuditLogRetention()).deleted).toBe(1);
    expect(await auditRows(s.workspaceId)).toHaveLength(6);

    process.env.AUDIT_LOG_RETENTION_DAYS = "30";
    expect((await runAuditLogRetention()).deleted).toBe(1);
    expect(await auditRows(s.workspaceId)).toHaveLength(5);
  });

  it("keeps everything with AUDIT_LOG_RETENTION_DAYS=0", async () => {
    const s = await scene();
    await s.insert({ action: "project.created", createdAt: s.at(4000) });
    process.env.AUDIT_LOG_RETENTION_DAYS = "0";
    expect((await runAuditLogRetention()).deleted).toBe(0);
    expect(await auditRows(s.workspaceId)).toHaveLength(6);
  });
});

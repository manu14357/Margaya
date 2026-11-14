import { count } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { addWorkspaceMember, createWorkspaceMember } from "./helpers/fixtures";
import {
  addSecondWorkspace,
  collectEvents,
  expectStatus,
  homeContext,
  json,
} from "./helpers/home";

type Preferences = {
  workspaceId: string;
  widgets: Array<{ key: string; enabled: boolean }>;
  updatedAt: string | null;
};

const preferenceEvents = await collectEvents("home_preferences.changed");

const DEFAULTS = [
  { key: "quick-links", enabled: true },
  { key: "recents", enabled: true },
  { key: "stickies", enabled: true },
  { key: "risks", enabled: true },
  { key: "my-brief", enabled: false },
  { key: "pinned-reports", enabled: false },
  { key: "project-updates", enabled: false },
];

async function preferences(role = "member") {
  const ctx = await homeContext(role);
  const get = async (workspaceId = ctx.workspaceId) =>
    (await (
      await expectStatus(
        ctx.app.request(`/api/home/preferences?workspaceId=${workspaceId}`),
        200,
      )
    ).json()) as Preferences;
  const put = (widgets: unknown, workspaceId = ctx.workspaceId) =>
    ctx.app.request(
      "/api/home/preferences",
      json("PUT", { workspaceId, widgets }),
    );
  return { ...ctx, get, put };
}

async function storedRows() {
  const [row] = await db
    .select({ total: count() })
    .from(schema.homePreferenceTable);
  return row?.total ?? 0;
}

describe("API integration: home preferences", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    preferenceEvents.length = 0;
  });

  it("returns the defaults without writing a row", async () => {
    const { get, workspaceId } = await preferences();
    expect(await get()).toEqual({
      workspaceId,
      widgets: DEFAULTS,
      updatedAt: null,
    });
    expect(await storedRows()).toBe(0);
  });

  it("saves order and visibility", async () => {
    const { get, put, user, workspaceId } = await preferences();
    const widgets = [
      { key: "stickies", enabled: true },
      { key: "quick-links", enabled: false },
      { key: "risks", enabled: false },
      { key: "recents", enabled: true },
      { key: "my-brief", enabled: true },
      { key: "pinned-reports", enabled: false },
      { key: "project-updates", enabled: true },
    ];
    const saved = (await (
      await expectStatus(put(widgets), 200)
    ).json()) as Preferences;
    expect(saved.widgets).toEqual(widgets);
    expect(saved.updatedAt).toEqual(expect.any(String));
    expect(await get()).toMatchObject({ widgets });
    expect(preferenceEvents).toEqual([
      expect.objectContaining({ userId: user.id, workspaceId }),
    ]);

    // Every widget off is allowed.
    const allOff = DEFAULTS.map(({ key }) => ({ key, enabled: false }));
    await expectStatus(put(allOff), 200);
    expect((await get()).widgets).toEqual(allOff);
  });

  it("saves pinned reports on their widget and drops them elsewhere", async () => {
    const { get, put } = await preferences();
    const widgets = DEFAULTS.map((widget) =>
      widget.key === "pinned-reports"
        ? { ...widget, enabled: true, reportIds: ["report-1", "report-2"] }
        : widget.key === "recents"
          ? { ...widget, reportIds: ["report-3"] }
          : widget,
    );
    const saved = (await (
      await expectStatus(put(widgets), 200)
    ).json()) as Preferences;
    const pinned = saved.widgets.find(({ key }) => key === "pinned-reports");
    expect(pinned).toEqual({
      key: "pinned-reports",
      enabled: true,
      reportIds: ["report-1", "report-2"],
    });
    expect(saved.widgets.find(({ key }) => key === "recents")).toEqual({
      key: "recents",
      enabled: true,
    });
    expect((await get()).widgets).toEqual(saved.widgets);

    // Unpinning is a change too, and more pins than allowed are refused.
    const unpinned = DEFAULTS;
    const after = (await (
      await expectStatus(put(unpinned), 200)
    ).json()) as Preferences;
    expect(after.widgets).toEqual(DEFAULTS);
    const tooMany = DEFAULTS.map((widget) =>
      widget.key === "pinned-reports"
        ? {
            ...widget,
            reportIds: Array.from({ length: 7 }, (_, n) => `report-${n}`),
          }
        : widget,
    );
    expect((await put(tooMany)).status).toBe(400);
  });

  it("requires every widget exactly once", async () => {
    const { put } = await preferences();
    const message = "List every home widget exactly once";
    await expectStatus(put(DEFAULTS.slice(0, 2)), 400, message);
    await expectStatus(
      put([...DEFAULTS.slice(0, 2), { key: "recents", enabled: false }]),
      400,
      message,
    );
    await expectStatus(put([...DEFAULTS, { key: "tour", enabled: true }]), 400);
    await expectStatus(put("all"), 400);
  });

  it("publishes nothing for an unchanged list", async () => {
    const { put } = await preferences();
    const widgets = [...DEFAULTS].reverse();
    const first = (await (
      await expectStatus(put(widgets), 200)
    ).json()) as Preferences;
    preferenceEvents.length = 0;

    const again = (await (
      await expectStatus(put(widgets), 200)
    ).json()) as Preferences;
    expect(again.updatedAt).toBe(first.updatedAt);
    expect(preferenceEvents).toEqual([]);
  });

  it("normalizes rows stored by older versions", async () => {
    const { get, user, workspaceId } = await preferences();
    await db.insert(schema.homePreferenceTable).values({
      userId: user.id,
      workspaceId,
      widgets: [
        { key: "tour", enabled: true },
        { key: "recents", enabled: false },
        { key: "quick-links", enabled: true },
      ],
    });
    expect((await get()).widgets).toEqual([
      { key: "recents", enabled: false },
      { key: "quick-links", enabled: true },
      { key: "stickies", enabled: true },
      { key: "risks", enabled: true },
      { key: "my-brief", enabled: false },
      { key: "pinned-reports", enabled: false },
      { key: "project-updates", enabled: false },
    ]);
  });

  it("keeps preferences per user and per workspace", async () => {
    const { get, put, user, workspaceId } = await preferences();
    const otherWorkspaceId = await addSecondWorkspace(user);
    const hidden = DEFAULTS.map((widget) => ({
      ...widget,
      enabled: widget.key !== "recents",
    }));
    await expectStatus(put(hidden), 200);

    expect((await get(otherWorkspaceId)).widgets).toEqual(DEFAULTS);
    mockAuthenticatedSession(await addWorkspaceMember(workspaceId, "admin"));
    expect(await get()).toMatchObject({ widgets: DEFAULTS, updatedAt: null });
  });

  it("lets a viewer save and refuses non-members", async () => {
    const { app, put, workspaceId } = await preferences("viewer");
    await expectStatus(put([...DEFAULTS].reverse()), 200);

    const outsider = await createWorkspaceMember();
    mockAuthenticatedSession(outsider.user);
    await expectStatus(
      app.request(`/api/home/preferences?workspaceId=${workspaceId}`),
      403,
    );
    await expectStatus(put(DEFAULTS), 403);
  });
});

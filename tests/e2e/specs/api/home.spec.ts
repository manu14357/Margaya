import { expect, test } from "../../fixtures";
import {
  createWorld,
  expectJson,
  expectStatus,
  type World,
} from "../../helpers/api-kit";
import { covers, skipUnlessDeployed } from "../../helpers/openapi";

// Home: the caller's quick links, stickies and widget preferences. All three
// are personal per workspace: another member never sees or changes them,
// and every workspace member (viewers included) has their own.

type QuickLink = {
  id: string;
  workspaceId: string;
  url: string;
  title: string | null;
};
type Sticky = {
  id: string;
  workspaceId: string;
  content: string;
  color: string;
  position: number;
};
type StickyPage = { items: Sticky[]; nextCursor: string | null };
type HomePreferences = {
  workspaceId: string;
  widgets: { key: string; enabled: boolean }[];
  updatedAt: string | null;
};

let world: World;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Home");
});

test.afterAll(async () => {
  await world?.dispose();
});

test(
  "quick links: save, list, edit and remove",
  covers(
    "createQuickLink",
    "listQuickLinks",
    "updateQuickLink",
    "deleteQuickLink",
  ),
  async () => {
    await skipUnlessDeployed(
      "createQuickLink",
      "listQuickLinks",
      "updateQuickLink",
      "deleteQuickLink",
    );
    // Viewers hold workspace:read, which is all quick links need.
    const viewer = world.as("viewer");
    const workspaceId = world.workspace.id;
    const first = await expectJson<QuickLink>(
      await viewer.post("/api/quick-link", {
        data: {
          workspaceId,
          url: "docs.example.com/handbook",
          title: "Handbook",
        },
      }),
    );
    // https:// is added and the URL stored normalized.
    expect(first).toMatchObject({
      workspaceId,
      url: "https://docs.example.com/handbook",
      title: "Handbook",
    });
    const second = await expectJson<QuickLink>(
      await viewer.post("/api/quick-link", {
        data: { workspaceId, url: "https://status.example.com" },
      }),
    );
    expect(second.title).toBeNull();

    await expectStatus(
      await viewer.post("/api/quick-link", {
        data: { workspaceId, url: "https://docs.example.com/handbook" },
      }),
      409,
    );
    for (const url of [
      "javascript:alert(1)",
      "https://user:pass@example.com",
      "http://intranet",
    ]) {
      await expectStatus(
        await viewer.post("/api/quick-link", { data: { workspaceId, url } }),
        400,
      );
    }

    const listed = await expectJson<QuickLink[]>(
      await viewer.get("/api/quick-link", { params: { workspaceId } }),
    );
    // Newest first.
    expect(listed.map((link) => link.id)).toEqual([second.id, first.id]);
    // Quick links are personal.
    expect(
      await expectJson<QuickLink[]>(
        await world
          .as("member")
          .get("/api/quick-link", { params: { workspaceId } }),
      ),
    ).toEqual([]);
    await expectStatus(
      await world.as("member").patch(`/api/quick-link/${first.id}`, {
        params: { workspaceId },
        data: { title: "Not mine" },
      }),
      404,
    );

    const edited = await expectJson<QuickLink>(
      await viewer.patch(`/api/quick-link/${first.id}`, {
        params: { workspaceId },
        data: { url: "docs.example.com/handbook-v2", title: "  " },
      }),
    );
    expect(edited).toMatchObject({
      url: "https://docs.example.com/handbook-v2",
      title: null,
    });
    await expectStatus(
      await viewer.patch(`/api/quick-link/${first.id}`, {
        params: { workspaceId },
        data: {},
      }),
      400,
    );
    await expectStatus(
      await viewer.patch(`/api/quick-link/${first.id}`, {
        params: { workspaceId },
        data: { url: "https://status.example.com" },
      }),
      409,
    );

    expect(
      await expectJson(
        await viewer.delete(`/api/quick-link/${first.id}`, {
          params: { workspaceId },
        }),
      ),
    ).toEqual({ removed: true });
    await expectStatus(
      await viewer.delete(`/api/quick-link/${first.id}`, {
        params: { workspaceId },
      }),
      404,
    );
    await expectStatus(
      await world
        .as("anonymous")
        .get("/api/quick-link", { params: { workspaceId } }),
      401,
    );
    await expectStatus(
      await viewer.get("/api/quick-link", {
        params: { workspaceId: "e2e-unknown-workspace" },
      }),
      403,
    );
  },
);

test(
  "stickies: create, search, page, reorder, edit and delete",
  covers(
    "createSticky",
    "listStickies",
    "reorderStickies",
    "updateSticky",
    "deleteSticky",
  ),
  async () => {
    await skipUnlessDeployed(
      "createSticky",
      "listStickies",
      "reorderStickies",
      "updateSticky",
      "deleteSticky",
    );
    const member = world.as("member");
    const workspaceId = world.workspace.id;
    const create = async (content: string, color?: string) =>
      expectJson<Sticky>(
        await member.post("/api/sticky", {
          data: { workspaceId, content, ...(color ? { color } : {}) },
        }),
      );
    const groceries = await create("Buy **oat milk** for the team");
    expect(groceries).toMatchObject({ workspaceId, color: "yellow" });
    const standup = await create("Standup notes: ship the release", "teal");
    const retro = await create("Retro ideas", "pink");

    const page = async (params: Record<string, string> = {}) =>
      expectJson<StickyPage>(
        await member.get("/api/sticky", { params: { workspaceId, ...params } }),
      );

    // New stickies go on top.
    expect((await page()).items.map((sticky) => sticky.id)).toEqual([
      retro.id,
      standup.id,
      groceries.id,
    ]);
    // Search runs over the plain text, not the Markdown.
    expect(
      (await page({ q: "oat milk" })).items.map((sticky) => sticky.id),
    ).toEqual([groceries.id]);
    const firstPage = await page({ limit: "2" });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).toBeTruthy();
    const secondPage = await page({
      limit: "2",
      cursor: firstPage.nextCursor ?? "",
    });
    expect(secondPage.items.map((sticky) => sticky.id)).toEqual([groceries.id]);
    expect(secondPage.nextCursor).toBeNull();
    await expectStatus(
      await member.get("/api/sticky", {
        params: { workspaceId, cursor: "garbage" },
      }),
      400,
    );
    await expectStatus(
      await member.get("/api/sticky", { params: { workspaceId, limit: "0" } }),
      400,
    );

    const reordered = await expectJson<{ reordered: number }>(
      await member.put("/api/sticky/reorder", {
        params: { workspaceId },
        data: { stickyIds: [groceries.id, retro.id, standup.id] },
      }),
    );
    expect(reordered.reordered).toBeGreaterThan(0);
    expect((await page()).items.map((sticky) => sticky.id)).toEqual([
      groceries.id,
      retro.id,
      standup.id,
    ]);
    await expectStatus(
      await member.put("/api/sticky/reorder", {
        params: { workspaceId },
        data: { stickyIds: [groceries.id, groceries.id] },
      }),
      400,
    );

    const edited = await expectJson<Sticky>(
      await member.patch(`/api/sticky/${standup.id}`, {
        params: { workspaceId },
        data: { content: "Standup: release shipped", color: "green" },
      }),
    );
    expect(edited).toMatchObject({
      content: "Standup: release shipped",
      color: "green",
    });
    await expectStatus(
      await member.patch(`/api/sticky/${standup.id}`, {
        params: { workspaceId },
        data: { color: "neon" },
      }),
      400,
    );
    await expectStatus(
      await member.patch(`/api/sticky/${standup.id}`, {
        params: { workspaceId },
        data: { pinned: true },
      }),
      400,
    );

    // Stickies are personal.
    expect(
      (
        await expectJson<StickyPage>(
          await world
            .as("admin")
            .get("/api/sticky", { params: { workspaceId } }),
        )
      ).items,
    ).toEqual([]);
    await expectStatus(
      await world
        .as("admin")
        .delete(`/api/sticky/${retro.id}`, { params: { workspaceId } }),
      404,
    );
    await expectStatus(
      await world.as("admin").put("/api/sticky/reorder", {
        params: { workspaceId },
        data: { stickyIds: [retro.id] },
      }),
      400,
    );

    expect(
      await expectJson(
        await member.delete(`/api/sticky/${retro.id}`, {
          params: { workspaceId },
        }),
      ),
    ).toEqual({
      removed: true,
    });
    await expectStatus(
      await member.delete(`/api/sticky/${retro.id}`, {
        params: { workspaceId },
      }),
      404,
    );
    expect((await page()).items.map((sticky) => sticky.id)).toEqual([
      groceries.id,
      standup.id,
    ]);
  },
);

test(
  "home widget preferences: defaults, save and validation",
  covers("getHomePreferences", "updateHomePreferences"),
  async () => {
    await skipUnlessDeployed("getHomePreferences", "updateHomePreferences");
    const admin = world.as("admin");
    const workspaceId = world.workspace.id;
    const defaults = await expectJson<HomePreferences>(
      await admin.get("/api/home/preferences", { params: { workspaceId } }),
    );
    expect(defaults).toEqual({
      workspaceId,
      updatedAt: null,
      widgets: [
        { key: "quick-links", enabled: true },
        { key: "recents", enabled: true },
        { key: "stickies", enabled: true },
        { key: "risks", enabled: true },
        // Opt-in: off until the person turns it on.
        { key: "my-brief", enabled: false },
      ],
    });

    const widgets = [
      { key: "stickies", enabled: true },
      { key: "quick-links", enabled: false },
      { key: "recents", enabled: true },
      { key: "my-brief", enabled: true },
      { key: "risks", enabled: false },
    ];
    const saved = await expectJson<HomePreferences>(
      await admin.put("/api/home/preferences", {
        data: { workspaceId, widgets },
      }),
    );
    expect(saved.widgets).toEqual(widgets);
    expect(saved.updatedAt).not.toBeNull();
    expect(
      (
        await expectJson<HomePreferences>(
          await admin.get("/api/home/preferences", { params: { workspaceId } }),
        )
      ).widgets,
    ).toEqual(widgets);
    // Per user: another member still sees the defaults.
    expect(
      (
        await expectJson<HomePreferences>(
          await world
            .as("member")
            .get("/api/home/preferences", { params: { workspaceId } }),
        )
      ).updatedAt,
    ).toBeNull();

    // Every widget exactly once.
    await expectStatus(
      await admin.put("/api/home/preferences", {
        data: { workspaceId, widgets: [{ key: "stickies", enabled: true }] },
      }),
      400,
    );
    await expectStatus(
      await admin.put("/api/home/preferences", {
        data: {
          workspaceId,
          widgets: [...widgets, { key: "stickies", enabled: false }],
        },
      }),
      400,
    );
    await expectStatus(
      await admin.put("/api/home/preferences", {
        data: {
          workspaceId,
          widgets: [...widgets.slice(0, -1), { key: "weather", enabled: true }],
        },
      }),
      400,
    );
    // All off is allowed.
    const allOff = widgets.map((widget) => ({ ...widget, enabled: false }));
    expect(
      (
        await expectJson<HomePreferences>(
          await admin.put("/api/home/preferences", {
            data: { workspaceId, widgets: allOff },
          }),
        )
      ).widgets,
    ).toEqual(allOff);
  },
);

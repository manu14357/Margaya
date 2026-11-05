import { expect, test } from "../../fixtures";
import {
  expectJson,
  expectStatus,
  signUpUser,
  type TestUser,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";

// Instance administration (Settings > Instance): overview, settings with
// environment locks, workspaces, test email, admins and public boards. The
// seeded owner is the instance administrator; workspace roles do not count.

type Setting = {
  key: string;
  value: string | number | boolean;
  source: string;
  locked: boolean;
};
type Settings = { locked: boolean; settings: Setting[] };

let outsider: TestUser;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  outsider = await signUpUser("Instance outsider");
});

test.afterAll(async () => {
  await outsider?.ctx.dispose();
});

test(
  "only the instance admin reads recent delivery failures",
  covers("listInstanceDeliveryFailures"),
  async ({ apiAs }) => {
    const owner = await apiAs("owner");
    const failures = await expectJson<{ items: unknown[] }>(
      await owner.get("/api/instance-admin/delivery-failures"),
    );
    expect(Array.isArray(failures.items)).toBe(true);

    const admin = await apiAs("admin");
    await expectStatus(
      await admin.get("/api/instance-admin/delivery-failures"),
      403,
    );
  },
);

test(
  "the instance admin reads the overview, workspaces and public boards",
  covers(
    "getInstanceOverview",
    "listInstanceWorkspaces",
    "listInstancePublicBoards",
  ),
  async ({ apiAs, seed }) => {
    const owner = await apiAs("owner");
    const overview = await expectJson<Record<string, unknown>>(
      await owner.get("/api/instance-admin/overview"),
    );
    expect(Object.keys(overview).length).toBeGreaterThan(0);

    const workspaces = await expectJson<{ items: { id: string }[] }>(
      await owner.get("/api/instance-admin/workspaces", {
        params: { search: seed.workspace.name },
      }),
    );
    expect(workspaces.items.map((item) => item.id)).toContain(
      seed.workspace.id,
    );
    await expectJson(await owner.get("/api/instance-admin/public-boards"));

    // A workspace admin is not an instance admin.
    const admin = await apiAs("admin");
    for (const path of ["overview", "workspaces", "public-boards", "admins"]) {
      await expectStatus(await admin.get(`/api/instance-admin/${path}`), 403);
    }
    await expectStatus(
      await (await apiAs("anonymous")).get("/api/instance-admin/overview"),
      401,
    );
  },
);

test(
  "settings: a saved value takes effect and clears; environment locks hold",
  covers("getInstanceSettings", "updateInstanceSettings"),
  async ({ apiAs }) => {
    const owner = await apiAs("owner");
    const before = await expectJson<Settings>(
      await owner.get("/api/instance-admin/settings"),
    );
    const name = before.settings.find(
      (setting) => setting.key === "general.instanceName",
    );
    expect(name?.locked).toBe(false);
    const locked = before.settings.find((setting) => setting.locked);

    const temporary = uniqueName("Margaya E2E");
    try {
      const saved = await expectJson<Settings>(
        await owner.patch("/api/instance-admin/settings", {
          data: { values: { "general.instanceName": temporary } },
        }),
      );
      expect(
        saved.settings.find(
          (setting) => setting.key === "general.instanceName",
        ),
      ).toMatchObject({ value: temporary });
    } finally {
      await owner.patch("/api/instance-admin/settings", {
        data: { values: { "general.instanceName": null } },
      });
    }
    const after = await expectJson<Settings>(
      await owner.get("/api/instance-admin/settings"),
    );
    expect(
      after.settings.find((setting) => setting.key === "general.instanceName")
        ?.value,
    ).toBe(name?.value);

    if (locked) {
      await expectStatus(
        await owner.patch("/api/instance-admin/settings", {
          data: { values: { [locked.key]: locked.value } },
        }),
        409,
      );
    }
    await expectStatus(
      await outsider.ctx.patch("/api/instance-admin/settings", {
        data: { values: { "general.instanceName": "Hijacked" } },
      }),
      403,
    );
  },
);

test(
  "a test email goes to the caller through the configured SMTP server",
  covers("sendInstanceTestEmail"),
  async ({ apiAs, mailpit, seed }) => {
    const owner = await apiAs("owner");
    // MailPit stamps messages with its own clock, which can lag this one by a
    // moment; the subject keeps the slack from matching other mail.
    const since = new Date(Date.now() - 5_000);
    const result = await expectJson<{ sent: boolean }>(
      await owner.post("/api/instance-admin/email/test", { data: {} }),
    );
    expect(result.sent).toBe(true);
    await mailpit.waitForMessage({
      to: seed.users.owner.email,
      subject: "Test email from",
      since,
    });
  },
);

test(
  "instance admins are added and removed",
  covers("listInstanceAdmins", "addInstanceAdmin", "removeInstanceAdmin"),
  async ({ apiAs }) => {
    const owner = await apiAs("owner");
    const added = await expectJson<{ id: string } | { id: string }[]>(
      await owner.post("/api/instance-admin/admins", {
        data: { email: outsider.email },
      }),
    );
    expect(JSON.stringify(added)).toContain(outsider.id);
    const admins = await expectJson<{ id: string; isYou: boolean }[]>(
      await owner.get("/api/instance-admin/admins"),
    );
    expect(admins.map((admin) => admin.id)).toContain(outsider.id);
    expect(admins.some((admin) => admin.isYou)).toBe(true);

    await expectJson(
      await owner.delete(`/api/instance-admin/admins/${outsider.id}`),
    );
    const after = await expectJson<{ id: string }[]>(
      await owner.get("/api/instance-admin/admins"),
    );
    expect(after.map((admin) => admin.id)).not.toContain(outsider.id);
    await expectStatus(
      await owner.post("/api/instance-admin/admins", {
        data: { email: "nobody-e2e@margaya.test" },
      }),
      404,
    );
  },
);

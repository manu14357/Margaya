import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorld,
  eventually,
  expectJson,
  expectStatus,
  type Project,
  type World,
} from "../../helpers/api-kit";
import { covers, skipUnlessDeployed } from "../../helpers/openapi";

// The notification routes (list, inbox, counts, read state, archive, snooze,
// clear) and notification preferences, per user. End-to-end delivery (who
// is notified by which task event, email, webhooks, the bell) lives in
// specs/notifications/.

type Notification = {
  id: string;
  userId: string;
  type: string;
  title: string | null;
  content: string | null;
  isRead: boolean | null;
  resourceId: string | null;
  resourceType: string | null;
  workspaceId?: string | null;
  actorId?: string | null;
  archivedAt?: string | null;
  snoozedUntil?: string | null;
  eventData?: Record<string, unknown>;
};
type Inbox = { items: Notification[]; nextCursor: string | null };
type Preferences = {
  emailAddress: string | null;
  emailEnabled: boolean;
  webhookEnabled: boolean;
  webhookConfigured: boolean;
  webhookUrl: string | null;
  webhookSecretConfigured: boolean;
  maskedWebhookSecret: string | null;
  taskAssignmentEnabled: boolean;
  taskCommentEnabled: boolean;
  taskStatusChangeEnabled: boolean;
  dueDateReminderEnabled: boolean;
  dueDateReminderLeadTimeMinutes: number;
  workspaces: {
    workspaceId: string;
    isActive: boolean;
    emailEnabled: boolean;
    webhookEnabled: boolean;
    projectMode: string;
    selectedProjectIds: string[];
  }[];
} & Record<string, unknown>;

let world: World;
let project: Project;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Notify API");
  project = await createProject(world.as("owner"), world.workspace.id);
});

test.afterAll(async () => {
  await world?.dispose();
});

async function assignMember(): Promise<Notification> {
  const task = await createTask(world.as("owner"), project.id);
  await expectJson(
    await world.as("owner").put(`/api/task/assignees/${task.id}`, {
      data: { assigneeIds: [world.users.member.id] },
    }),
  );
  return eventually(
    async () => {
      const list = await expectJson<Notification[]>(
        await world.as("member").get("/api/notification"),
      );
      return list.find(
        (entry) =>
          entry.resourceId === task.id &&
          entry.type === "task_assignee_changed",
      );
    },
    { what: "the assignment notification" },
  );
}

test(
  "create and list notifications; mark one read and unread",
  covers("listNotifications", "createNotification", "markNotificationAsRead"),
  async () => {
    const member = world.as("member");
    const created = await expectJson<Notification>(
      await member.post("/api/notification", {
        data: {
          title: "Hello from a script",
          message: "Integrations may notify their own user",
          type: "system",
          relatedEntityId: world.workspace.id,
          relatedEntityType: "workspace",
        },
      }),
    );
    expect(created).toMatchObject({
      userId: world.users.member.id,
      title: "Hello from a script",
      content: "Integrations may notify their own user",
      isRead: false,
    });

    const assigned = await assignMember();
    expect(assigned).toMatchObject({
      isRead: false,
      actorId: world.users.owner.id,
    });

    const list = await expectJson<Notification[]>(
      await member.get("/api/notification"),
    );
    expect(list.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([created.id, assigned.id]),
    );
    // Notifications are per user.
    const ownerList = await expectJson<Notification[]>(
      await world.as("owner").get("/api/notification"),
    );
    expect(ownerList.map((entry) => entry.id)).not.toContain(created.id);

    const read = await expectJson<Notification>(
      await member.patch(`/api/notification/${created.id}/read`),
    );
    expect(read.isRead).toBe(true);
    // Repeating changes nothing.
    expect(
      (
        await expectJson<Notification>(
          await member.patch(`/api/notification/${created.id}/read`),
        )
      ).isRead,
    ).toBe(true);
    // Another user's notification is not found.
    await expectStatus(
      await world.as("owner").patch(`/api/notification/${created.id}/read`),
      404,
    );

    await expectStatus(
      await member.post("/api/notification", { data: { title: "No type" } }),
      400,
    );
  },
);

test(
  "the workspace inbox, counts and unread/archive/snooze states",
  covers(
    "listInboxNotifications",
    "getInboxCounts",
    "markNotificationAsUnread",
    "archiveNotification",
    "unarchiveNotification",
    "snoozeNotification",
    "unsnoozeNotification",
  ),
  async () => {
    await skipUnlessDeployed(
      "listInboxNotifications",
      "getInboxCounts",
      "markNotificationAsUnread",
      "archiveNotification",
      "unarchiveNotification",
      "snoozeNotification",
      "unsnoozeNotification",
    );
    const member = world.as("member");
    const workspaceId = world.workspace.id;
    const notification = await assignMember();

    const counts = async () =>
      expectJson<{ unread: number; unreadMentions: number }>(
        await member.get("/api/notification/counts", {
          params: { workspaceId },
        }),
      );
    const inbox = async (params: Record<string, string> = {}) =>
      expectJson<Inbox>(
        await member.get("/api/notification/inbox", {
          params: { workspaceId, ...params },
        }),
      );

    const before = await counts();
    expect(before.unread).toBeGreaterThanOrEqual(1);
    expect((await inbox()).items.map((entry) => entry.id)).toContain(
      notification.id,
    );
    expect(
      (await inbox({ unread: "true" })).items.map((entry) => entry.id),
    ).toContain(notification.id);

    await expectJson(
      await member.patch(`/api/notification/${notification.id}/read`),
    );
    expect((await counts()).unread).toBe(before.unread - 1);
    const unread = await expectJson<Notification>(
      await member.patch(`/api/notification/${notification.id}/unread`),
    );
    expect(unread.isRead).toBe(false);
    expect((await counts()).unread).toBe(before.unread);

    const archived = await expectJson<Notification>(
      await member.patch(`/api/notification/${notification.id}/archive`),
    );
    expect(archived.archivedAt).toBeTruthy();
    expect((await inbox()).items.map((entry) => entry.id)).not.toContain(
      notification.id,
    );
    expect(
      (await inbox({ view: "archived" })).items.map((entry) => entry.id),
    ).toContain(notification.id);
    const unarchived = await expectJson<Notification>(
      await member.patch(`/api/notification/${notification.id}/unarchive`),
    );
    expect(unarchived.archivedAt ?? null).toBeNull();

    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const snoozed = await expectJson<Notification>(
      await member.patch(`/api/notification/${notification.id}/snooze`, {
        data: { until },
      }),
    );
    expect(new Date(snoozed.snoozedUntil ?? 0).toISOString()).toBe(until);
    expect((await inbox()).items.map((entry) => entry.id)).not.toContain(
      notification.id,
    );
    expect(
      (await inbox({ view: "snoozed" })).items.map((entry) => entry.id),
    ).toContain(notification.id);
    await expectStatus(
      await member.patch(`/api/notification/${notification.id}/snooze`, {
        data: { until: new Date(Date.now() + 10_000).toISOString() },
      }),
      400,
    );
    const woke = await expectJson<Notification>(
      await member.patch(`/api/notification/${notification.id}/unsnooze`),
    );
    expect(woke.snoozedUntil ?? null).toBeNull();
    expect((await inbox()).items.map((entry) => entry.id)).toContain(
      notification.id,
    );

    // Paging.
    await assignMember();
    const firstPage = await inbox({ limit: "1" });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toBeTruthy();
    const secondPage = await inbox({
      limit: "1",
      cursor: firstPage.nextCursor ?? "",
    });
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);

    await expectStatus(
      await member.get("/api/notification/inbox", {
        params: { workspaceId, view: "later" },
      }),
      400,
    );
    await expectStatus(await member.get("/api/notification/counts"), 400);
    await expectStatus(
      await member.get("/api/notification/counts", {
        params: { workspaceId: "e2e-unknown-workspace" },
      }),
      403,
    );
    for (const action of ["unread", "archive", "unarchive", "unsnooze"]) {
      await expectStatus(
        await world
          .as("owner")
          .patch(`/api/notification/${notification.id}/${action}`),
        404,
      );
    }
  },
);

test(
  "mark everything read, then clear it",
  covers("markAllNotificationsAsRead", "clearAllNotifications"),
  async () => {
    const member = world.as("member");
    await assignMember();
    const marked = await expectJson<{
      success: boolean;
      updatedCount?: number;
    }>(
      await member.patch("/api/notification/read-all", {
        params: { workspaceId: world.workspace.id },
      }),
    );
    expect(marked.success).toBe(true);
    expect(marked.updatedCount).toBeGreaterThanOrEqual(1);
    const list = await expectJson<Notification[]>(
      await member.get("/api/notification"),
    );
    expect(
      list.filter(
        (entry) => entry.workspaceId === world.workspace.id && !entry.isRead,
      ),
    ).toEqual([]);

    await expectJson(await member.patch("/api/notification/read-all"));
    await expectStatus(
      await member.patch("/api/notification/read-all", {
        params: { workspaceId: world.workspace.id, tab: "later" },
      }),
      400,
    );

    const cleared = await expectJson<{ success: boolean }>(
      await member.delete("/api/notification/clear-all", {
        params: { workspaceId: world.workspace.id },
      }),
    );
    expect(cleared.success).toBe(true);
    const after = await expectJson<Notification[]>(
      await member.get("/api/notification"),
    );
    expect(
      after.filter((entry) => entry.workspaceId === world.workspace.id),
    ).toEqual([]);
    await expectJson(await member.delete("/api/notification/clear-all"));
    expect(
      await expectJson<Notification[]>(await member.get("/api/notification")),
    ).toEqual([]);
  },
);

test(
  "notification preferences: global switches and a workspace rule",
  covers(
    "getNotificationPreferences",
    "updateNotificationPreferences",
    "upsertNotificationPreferenceWorkspaceRule",
    "deleteNotificationPreferenceWorkspaceRule",
  ),
  async ({ webhookSink }) => {
    const viewer = world.as("viewer");
    const defaults = await expectJson<Preferences>(
      await viewer.get("/api/notification-preferences"),
    );
    expect(defaults).toMatchObject({
      emailAddress: world.users.viewer.email,
      taskAssignmentEnabled: true,
      taskCommentEnabled: true,
      taskStatusChangeEnabled: true,
    });

    const updated = await expectJson<Preferences>(
      await viewer.put("/api/notification-preferences", {
        data: {
          emailEnabled: true,
          webhookEnabled: true,
          webhookUrl: `${webhookSink.url}/prefs`,
          taskStatusChangeEnabled: false,
          dueDateReminderLeadTimeMinutes: 60,
        },
      }),
    );
    expect(updated).toMatchObject({
      emailEnabled: true,
      webhookEnabled: true,
      webhookConfigured: true,
      taskStatusChangeEnabled: false,
      dueDateReminderLeadTimeMinutes: 60,
    });
    // Your own webhook URL comes back so the settings page can show it.
    const reread = await expectJson<Preferences>(
      await viewer.get("/api/notification-preferences"),
    );
    expect(reread.webhookUrl).toBe(`${webhookSink.url}/prefs`);
    expect(reread.webhookSecretConfigured).toBe(false);

    const withRule = await expectJson<Preferences>(
      await viewer.put(
        `/api/notification-preferences/workspaces/${world.workspace.id}`,
        {
          data: {
            isActive: true,
            emailEnabled: true,
            ntfyEnabled: false,
            gotifyEnabled: false,
            webhookEnabled: true,
            projectMode: "selected",
            selectedProjectIds: [project.id],
          },
        },
      ),
    );
    expect(
      withRule.workspaces.find(
        (rule) => rule.workspaceId === world.workspace.id,
      ),
    ).toMatchObject({
      isActive: true,
      projectMode: "selected",
      selectedProjectIds: [project.id],
    });

    await expectStatus(
      await viewer.put(
        `/api/notification-preferences/workspaces/${world.workspace.id}`,
        {
          data: { isActive: true },
        },
      ),
      400,
    );
    await expectStatus(
      await viewer.put("/api/notification-preferences", {
        data: { webhookUrl: "not a url" },
      }),
      400,
    );
    await expectStatus(
      await viewer.put("/api/notification-preferences", {
        data: { dueDateReminderLeadTimeMinutes: -5 },
      }),
      400,
    );
    // A workspace the caller does not belong to.
    const outsider = await expectJson<{ id: string }>(
      await world
        .as("admin")
        .get("/api/auth/organization/get-full-organization", {
          params: { organizationId: world.workspace.id },
        }),
    );
    expect(outsider.id).toBe(world.workspace.id);
    await expectStatus(
      await viewer.put(
        "/api/notification-preferences/workspaces/e2e-unknown-workspace",
        {
          data: {
            isActive: true,
            emailEnabled: true,
            ntfyEnabled: false,
            gotifyEnabled: false,
            webhookEnabled: false,
            projectMode: "all",
          },
        },
      ),
      403,
    );

    const withoutRule = await expectJson<Preferences>(
      await viewer.delete(
        `/api/notification-preferences/workspaces/${world.workspace.id}`,
      ),
    );
    expect(
      withoutRule.workspaces.map((rule) => rule.workspaceId),
    ).not.toContain(world.workspace.id);
    await expectStatus(
      await viewer.delete(
        `/api/notification-preferences/workspaces/${world.workspace.id}`,
      ),
      404,
    );

    // Switch everything back off and remove the URL.
    const reset = await expectJson<Preferences>(
      await viewer.put("/api/notification-preferences", {
        data: {
          emailEnabled: false,
          webhookEnabled: false,
          webhookUrl: null,
          taskStatusChangeEnabled: true,
        },
      }),
    );
    expect(reset).toMatchObject({
      webhookEnabled: false,
      emailEnabled: false,
      webhookConfigured: false,
      webhookUrl: null,
    });
  },
);

test("a notification webhook URL can be removed", async ({ webhookSink }) => {
  const admin = world.as("admin");
  const url = `${webhookSink.url}/to-clear`;
  const setUrl = async () => {
    const stored = await expectJson<Preferences>(
      await admin.put("/api/notification-preferences", {
        data: { webhookEnabled: false, webhookUrl: url },
      }),
    );
    expect(stored).toMatchObject({ webhookConfigured: true, webhookUrl: url });
  };

  // null and "" both clear it.
  for (const cleared of [null, ""]) {
    await setUrl();
    const viaClear = await expectJson<Preferences>(
      await admin.put("/api/notification-preferences", {
        data: { webhookUrl: cleared },
      }),
    );
    expect(viaClear).toMatchObject({
      webhookConfigured: false,
      webhookUrl: null,
    });
    const reread = await expectJson<Preferences>(
      await admin.get("/api/notification-preferences"),
    );
    expect(reread.webhookUrl).toBeNull();
  }

  // An enabled channel still needs its destination.
  await expectJson(
    await admin.put("/api/notification-preferences", {
      data: { webhookEnabled: true, webhookUrl: url },
    }),
  );
  expect(
    await expectStatus(
      await admin.put("/api/notification-preferences", {
        data: { webhookUrl: null },
      }),
      400,
    ),
  ).toContain("Webhook notifications require an endpoint URL");
  const disabled = await expectJson<Preferences>(
    await admin.put("/api/notification-preferences", {
      data: { webhookEnabled: false, webhookUrl: null },
    }),
  );
  expect(disabled).toMatchObject({
    webhookEnabled: false,
    webhookConfigured: false,
    webhookUrl: null,
  });
});

test("storing a notification webhook secret masks it, and clearing it works", async ({
  webhookSink,
}) => {
  // Secrets are stored encrypted (NOTIFICATION_SECRET_ENCRYPTION_KEY, set for
  // the e2e API in helpers/env.ts) and only ever reported as set, with a
  // masked preview.
  const admin = world.as("admin");
  const secret = "e2e-preference-webhook-secret";
  const store = async () => {
    const updated = await expectJson<Preferences>(
      await admin.put("/api/notification-preferences", {
        data: {
          webhookEnabled: true,
          webhookUrl: `${webhookSink.url}/signed`,
          webhookSecret: secret,
        },
      }),
    );
    expect(updated).toMatchObject({
      webhookEnabled: true,
      webhookConfigured: true,
      webhookSecretConfigured: true,
      maskedWebhookSecret: "e2e-…cret",
    });
    expect(JSON.stringify(updated)).not.toContain(secret);
  };

  await store();
  const reread = await admin.get("/api/notification-preferences");
  expect(await reread.text()).not.toContain(secret);
  // Leaving the secret out keeps it.
  const unrelated = await expectJson<Preferences>(
    await admin.put("/api/notification-preferences", {
      data: { taskCommentEnabled: true },
    }),
  );
  expect(unrelated).toMatchObject({
    webhookSecretConfigured: true,
    maskedWebhookSecret: "e2e-…cret",
  });

  // null and "" both clear it.
  for (const cleared of [null, ""]) {
    const withoutSecret = await expectJson<Preferences>(
      await admin.put("/api/notification-preferences", {
        data: { webhookSecret: cleared },
      }),
    );
    expect(withoutSecret).toMatchObject({
      webhookConfigured: true,
      webhookSecretConfigured: false,
      maskedWebhookSecret: null,
    });
    if (cleared === null) await store();
  }

  const off = await expectJson<Preferences>(
    await admin.put("/api/notification-preferences", {
      data: { webhookEnabled: false, webhookUrl: null },
    }),
  );
  expect(off).toMatchObject({
    webhookEnabled: false,
    webhookConfigured: false,
    webhookSecretConfigured: false,
  });
});

test("a muted notification type is not created", async () => {
  const member = world.as("member");
  await expectJson(
    await member.put("/api/notification-preferences", {
      data: { taskAssignmentEnabled: false },
    }),
  );
  try {
    const task = await createTask(world.as("owner"), project.id);
    await expectJson(
      await world.as("owner").put(`/api/task/assignees/${task.id}`, {
        data: { assigneeIds: [world.users.member.id] },
      }),
    );
    // A sentinel created afterwards proves the pipeline had time to run.
    const sentinel = await expectJson<Notification>(
      await member.post("/api/notification", {
        data: { title: "Sentinel", message: "after", type: "system" },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const list = await expectJson<Notification[]>(
      await member.get("/api/notification"),
    );
    expect(list.map((entry) => entry.id)).toContain(sentinel.id);
    expect(list.filter((entry) => entry.resourceId === task.id)).toEqual([]);

    // The create route answers null for a muted type.
    const muted = await member.post("/api/notification", {
      data: { title: "Muted", message: "muted", type: "task_assignee_changed" },
    });
    expect(muted.status()).toBe(200);
    expect(await muted.json()).toBeNull();
  } finally {
    await expectJson(
      await member.put("/api/notification-preferences", {
        data: { taskAssignmentEnabled: true },
      }),
    );
  }
});

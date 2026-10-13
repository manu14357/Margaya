import { expect, test } from "../../fixtures";
import {
  createProject,
  createTask,
  createWorkspace,
  createWorld,
  expectJson,
  type Project,
  signUpUser,
  type TestUser,
  type World,
} from "../../helpers/api-kit";
import { E2E_WEB_URL } from "../../helpers/env";
import { extractLinks, type MailpitMessage } from "../../helpers/mailpit";
import {
  browserContextFor,
  openApp,
  settle,
  UI_TIMEOUT,
} from "../../helpers/notifications";
import { uniqueName } from "../../helpers/ui";

// Emails through MailPit: the workspace invitation, and notification emails
// that follow each user's delivery preferences. Every email is checked for
// its subject, recipient and links, and the action link is opened in a
// browser. Due-date reminders are in due-date-reminders.spec.ts.

const SENDER = "noreply@margaya.test";

/** Every link in the email is http(s); links to the app answer. */
async function expectWorkingLinks(message: MailpitMessage): Promise<string[]> {
  const links = extractLinks(message);
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    expect(link).toMatch(/^https?:\/\//);
    if (link.startsWith(E2E_WEB_URL)) {
      const response = await fetch(link);
      expect(response.status, `${link} should load`).toBe(200);
    }
  }
  return links;
}

test.describe("invitation email", () => {
  let owner: TestUser;

  test.beforeAll(async () => {
    owner = await signUpUser("Inviter");
  });

  test.afterAll(async () => {
    await owner?.ctx.dispose();
  });

  test("the invitee receives the invitation and its link joins the workspace", async ({
    browser,
    mailpit,
  }) => {
    test.setTimeout(240_000);
    const workspace = await createWorkspace(owner.ctx, "E2E Invite");
    const inviteeEmail = `e2e-invitee-${Date.now().toString(36)}@margaya.test`;
    const since = new Date(Date.now() - 1000);
    const invitation = await expectJson<{ id: string }>(
      await owner.ctx.post("/api/auth/organization/invite-member", {
        data: {
          email: inviteeEmail,
          role: "member",
          organizationId: workspace.id,
        },
      }),
    );

    const message = await mailpit.waitForMessage({
      to: inviteeEmail,
      subject: "invited you to join",
      since,
    });
    expect(message.Subject).toBe(
      `${owner.name} invited you to join ${workspace.name} on Margaya`,
    );
    expect(message.To.map((to) => to.Address)).toEqual([inviteeEmail]);
    expect(message.From.Address).toBe(SENDER);
    expect(message.HTML).toContain(workspace.name);

    const links = await expectWorkingLinks(message);
    const accept = links.find((link) =>
      link.includes(`/invitation/accept/${invitation.id}`),
    );
    expect(accept, `accept link in ${links.join(", ")}`).toBeTruthy();
    expect(accept?.startsWith(`${E2E_WEB_URL}/invitation/accept/`)).toBe(true);

    // Signed out, the link explains the invitation.
    // browser.newContext() inherits the config's owner storage state.
    const anonymous = await browser.newContext({
      baseURL: E2E_WEB_URL,
      locale: "en-US",
      storageState: { cookies: [], origins: [] },
    });
    try {
      const page = await anonymous.newPage();
      await openApp(page, accept ?? "");
      await expect(page.getByText("You've been invited!")).toBeVisible({
        timeout: UI_TIMEOUT,
      });
      await expect(page.getByText(workspace.name).first()).toBeVisible();
      await expect(
        page
          .getByRole("button", { name: "Create account" })
          .or(page.getByRole("link", { name: "Create account" }))
          .first(),
      ).toBeVisible();
    } finally {
      await anonymous.close();
    }

    // With an account, the same link accepts the invitation.
    const account = await signUpUser("Invitee", { email: inviteeEmail });
    const context = await browserContextFor(browser, account);
    try {
      const page = await context.newPage();
      await openApp(page, accept ?? "");
      await page
        .getByRole("button", { name: "Accept invitation" })
        .click({ timeout: UI_TIMEOUT });
      await expect(
        page.getByText("Invitation accepted! Welcome to the team."),
      ).toBeVisible();
      const members = await expectJson<{ id: string; role: string }[]>(
        await owner.ctx.get(`/api/workspace/${workspace.id}/members`),
      );
      expect(members).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: account.id, role: "member" }),
        ]),
      );
    } finally {
      await context.close();
      await account.ctx.dispose();
    }
  });
});

test.describe("notification emails", () => {
  let world: World;
  let project: Project;

  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    world = await createWorld("Email");
    project = await createProject(world.as("owner"), world.workspace.id);
    // The member opts into email, globally and for this workspace.
    await expectJson(
      await world
        .as("member")
        .put("/api/notification-preferences", { data: { emailEnabled: true } }),
    );
    await expectJson(
      await world
        .as("member")
        .put(`/api/notification-preferences/workspaces/${world.workspace.id}`, {
          data: {
            isActive: true,
            emailEnabled: true,
            ntfyEnabled: false,
            gotifyEnabled: false,
            webhookEnabled: false,
            projectMode: "all",
          },
        }),
    );
  });

  test.afterAll(async () => {
    await world?.dispose();
  });

  const taskUrl = (taskId: string) =>
    `${E2E_WEB_URL}/dashboard/workspace/${world.workspace.id}/project/${project.id}/task/${taskId}`;

  test("an assignment emails the assignee with a link to the task", async ({
    browser,
    mailpit,
  }) => {
    test.setTimeout(180_000);
    const member = world.users.member;
    const task = await createTask(world.as("owner"), project.id, {
      title: uniqueName("Emailed task"),
    });
    const since = new Date(Date.now() - 1000);
    await expectJson(
      await world.as("owner").put(`/api/task/assignees/${task.id}`, {
        data: { assigneeIds: [member.id] },
      }),
    );

    const message = await mailpit.waitForMessage({
      to: member.email,
      subject: "Task assigned to you",
      since,
    });
    expect(message.Subject).toBe("Task assigned to you");
    expect(message.To.map((to) => to.Address)).toEqual([member.email]);
    expect(message.From.Address).toBe(SENDER);
    expect(message.Text).toContain(`You were assigned to ${task.title}.`);

    const links = await expectWorkingLinks(message);
    expect(links).toContain(taskUrl(task.id));

    // The link opens the task for the recipient.
    const context = await browserContextFor(browser, member);
    try {
      const page = await context.newPage();
      await openApp(page, taskUrl(task.id));
      await expect(
        page.getByRole("textbox", { name: "Click to add a title" }),
      ).toHaveValue(task.title, {
        timeout: UI_TIMEOUT,
      });
    } finally {
      await context.close();
    }
  });

  test("status changes and mentions are emailed too", async ({ mailpit }) => {
    const member = world.users.member;
    const task = await createTask(world.as("owner"), project.id, {
      title: uniqueName("Status mail"),
      assigneeIds: [member.id],
    });
    const since = new Date(Date.now() - 1000);
    await expectJson(
      await world.as("admin").put(`/api/task/status/${task.id}`, {
        data: { status: "in-progress" },
      }),
    );
    const status = await mailpit.waitForMessage({
      to: member.email,
      subject: "Task status changed",
      since,
    });
    expect(status.Text).toContain(
      `${task.title} moved from to-do to in-progress.`,
    );
    expect(extractLinks(status)).toContain(taskUrl(task.id));

    await expectJson(
      await world.as("admin").post(`/api/comment/${task.id}`, {
        data: {
          content: `<p><margaya-mention id="${member.id}" label="${member.name}"></margaya-mention> look</p>`,
        },
      }),
    );
    const mentioned = await mailpit.waitForMessage({
      to: member.email,
      subject: `${world.users.admin.name} mentioned you`,
      since,
    });
    expect(mentioned.Text).toContain(
      `You were mentioned in a comment on ${task.title}.`,
    );
    await expectWorkingLinks(mentioned);
  });

  test("no email without the preference, or with the workspace rule off", async ({
    mailpit,
  }) => {
    const { viewer, member } = world.users;
    // The viewer never opted in.
    const quiet = await createTask(world.as("owner"), project.id, {
      title: uniqueName("Quiet task"),
    });
    const since = new Date(Date.now() - 1000);
    await expectJson(
      await world.as("owner").put(`/api/task/assignees/${quiet.id}`, {
        data: { assigneeIds: [viewer.id] },
      }),
    );
    await settle(viewer.ctx);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const viewerMail = (await mailpit.search(`to:${viewer.email}`)).filter(
      (entry) =>
        new Date(entry.Created) >= since && !/invited you/i.test(entry.Subject),
    );
    expect(viewerMail).toEqual([]);

    // The member switches this workspace's rule off.
    await expectJson(
      await member.ctx.put(
        `/api/notification-preferences/workspaces/${world.workspace.id}`,
        {
          data: {
            isActive: false,
            emailEnabled: true,
            ntfyEnabled: false,
            gotifyEnabled: false,
            webhookEnabled: false,
            projectMode: "all",
          },
        },
      ),
    );
    const muted = await createTask(world.as("owner"), project.id, {
      title: uniqueName("Muted task"),
    });
    const mutedSince = new Date(Date.now() - 1000);
    await expectJson(
      await world.as("owner").put(`/api/task/assignees/${muted.id}`, {
        data: { assigneeIds: [member.id] },
      }),
    );
    await settle(member.ctx);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const memberMail = (await mailpit.search(`to:${member.email}`)).filter(
      (entry) =>
        new Date(entry.Created) >= mutedSince &&
        !/invited you/i.test(entry.Subject),
    );
    expect(memberMail).toEqual([]);
  });
});

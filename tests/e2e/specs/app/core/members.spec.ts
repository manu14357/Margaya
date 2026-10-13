import type { Page } from "@playwright/test";
import { test } from "../../../fixtures";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { extractCode, extractLinks } from "../../../helpers/mailpit";
import {
  expect,
  newUserWithWorkspace,
  projectsPath,
  signUpViaApi,
  uniqueEmail,
  workspacePath,
} from "./_support";

// Multi-step flows against shared, often busy dev servers: allow more than
// the default 60 s per test and 30 s per navigation.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 60_000 });

// The inviting owner, the workspace and every invitee are created here, so
// seeded memberships stay untouched.

type Member = {
  id: string;
  userId: string;
  role: string;
  user: { email: string };
};

async function listMembers(page: Page, workspaceId: string): Promise<Member[]> {
  const response = await page.request.get(
    `${E2E_API_URL}/api/auth/organization/list-members`,
    {
      params: { organizationId: workspaceId },
      headers: { Origin: E2E_WEB_URL },
    },
  );
  expect(response.status()).toBe(200);
  const body = await response.json();
  return Array.isArray(body) ? body : body.members;
}

function membersPath(workspaceId: string) {
  return `${workspacePath(workspaceId)}/members`;
}

function memberRow(page: Page, email: string) {
  return page.getByRole("row").filter({ hasText: email });
}

async function inviteThroughUI(page: Page, email: string) {
  await page.getByRole("button", { name: "Invite member" }).click();
  // Toasts are role=dialog too, so dialogs are always picked by name.
  const dialog = page.getByRole("dialog", { name: "Invite team member" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Invitation sent successfully")).toBeVisible();
  const created = page.getByRole("dialog", { name: "Invitation created" });
  await expect(
    created.getByText(
      `Share this link with ${email} so they can join the workspace.`,
    ),
  ).toBeVisible();
  // The link is shown for instances without SMTP.
  await expect(
    created.getByRole("textbox", { name: "Invitation link" }),
  ).toHaveValue(new RegExp(`^${E2E_WEB_URL}/invitation/accept/`));
  await created.getByRole("button", { name: "Done" }).click();
  await expect(created).toBeHidden();
}

test.describe("invitations", () => {
  test("an emailed invitation is accepted by a new user who signs up from the link", async ({
    pageAs,
    mailpit,
  }) => {
    const {
      page: owner,
      user: inviter,
      workspace,
    } = await newUserWithWorkspace(pageAs);
    const inviteeEmail = uniqueEmail("invitee");

    await owner.goto(membersPath(workspace.id));
    await expect(memberRow(owner, inviter.email)).toContainText("(You)");
    await expect(memberRow(owner, inviter.email)).toContainText("Owner");

    const since = new Date();
    await inviteThroughUI(owner, inviteeEmail);

    // The pending invitation is listed with its role.
    const pending = memberRow(owner, inviteeEmail);
    await expect(pending).toContainText("pending");
    await expect(pending).toContainText("Member");

    const email = await mailpit.waitForMessage({
      to: inviteeEmail,
      subject: `invited you to join ${workspace.name}`,
      since,
    });
    expect(email.Subject).toBe(
      `${inviter.name} invited you to join ${workspace.name} on Margaya`,
    );
    const acceptLink = extractLinks(email).find((link) =>
      link.includes("/invitation/accept/"),
    );
    expect(acceptLink, "accept link in the invitation email").toBeTruthy();
    expect(acceptLink).toContain(E2E_WEB_URL);

    // The invitee opens the link signed out and creates an account.
    const invitee = await pageAs("anonymous");
    await invitee.goto(acceptLink as string);
    await expect(
      invitee.getByRole("heading", { name: "You've been invited!" }),
    ).toBeVisible();
    // Signed out, the workspace shows in a summary tile under the heading.
    await expect(
      invitee.getByText(workspace.name, { exact: true }),
    ).toBeVisible();
    await expect(invitee.getByText(inviteeEmail)).toBeVisible();
    await invitee.getByRole("button", { name: "Create account" }).click();

    await expect(invitee).toHaveURL(/\/auth\/sign-up\?/);
    await expect(
      invitee.getByText("Create an account to accept your invitation"),
    ).toBeVisible();
    await expect(invitee.getByLabel("Email")).toHaveValue(inviteeEmail);
    await expect(invitee.getByLabel("Email")).toBeDisabled();
    await invitee.getByLabel("Full name").fill("Ivy Invitee");
    await invitee.getByPlaceholder("••••••••").fill("Invitee-Password-2026!");
    await invitee.getByRole("button", { name: "Create account" }).click();

    await expect(invitee).toHaveURL(/\/invitation\/accept\//);
    await expect(
      invitee.getByRole("heading", { name: `Join ${workspace.name}` }),
    ).toBeVisible();
    await invitee.getByRole("button", { name: "Accept invitation" }).click();
    await expect(
      invitee.getByText("Invitation accepted! Welcome to the team."),
    ).toBeVisible();
    await expect(invitee).toHaveURL(new RegExp(workspacePath(workspace.id)));
    await expect(
      invitee.getByRole("button", {
        name: `Switch workspace: ${workspace.name}`,
        exact: true,
      }),
    ).toBeVisible();

    // The owner now sees a real member instead of a pending invitation.
    await owner.reload();
    const row = memberRow(owner, inviteeEmail);
    await expect(row).toContainText("Ivy Invitee");
    await expect(row).not.toContainText("pending");
    const members = await listMembers(owner, workspace.id);
    expect(
      members.find((member) => member.user.email === inviteeEmail)?.role,
    ).toBe("member");
  });

  test("an existing user signs in from the emailed link and accepts", async ({
    pageAs,
    mailpit,
  }) => {
    const { page: owner, workspace } = await newUserWithWorkspace(pageAs);
    const existing = await pageAs("anonymous");
    const existingUser = await signUpViaApi(existing.request);
    await existing.context().clearCookies();

    await owner.goto(membersPath(workspace.id));
    const since = new Date();
    await inviteThroughUI(owner, existingUser.email);
    const email = await mailpit.waitForMessage({
      to: existingUser.email,
      since,
    });
    const acceptLink = extractLinks(email).find((link) =>
      link.includes("/invitation/accept/"),
    ) as string;

    await existing.goto(acceptLink);
    await expect(existing.getByText("You've been invited!")).toBeVisible();
    await existing.getByRole("button", { name: "Sign in" }).click();
    await expect(existing).toHaveURL(/\/auth\/sign-in\?/);
    await expect(
      existing.getByText("Sign in to accept your invitation"),
    ).toBeVisible();
    await existing.getByLabel("Email").fill(existingUser.email);
    await existing.getByPlaceholder("••••••••").fill(existingUser.password);
    await existing
      .getByRole("button", { name: "Sign in", exact: true })
      .click();

    await expect(existing).toHaveURL(/\/invitation\/accept\//);
    await expect(
      existing.getByText(`Signed in as ${existingUser.email}`),
    ).toBeVisible();
    await existing.getByRole("button", { name: "Accept invitation" }).click();
    await expect(
      existing.getByText("Invitation accepted! Welcome to the team."),
    ).toBeVisible();
    await expect(existing).toHaveURL(new RegExp(workspacePath(workspace.id)));

    await expect
      .poll(async () =>
        (await listMembers(owner, workspace.id)).some(
          (member) => member.user.email === existingUser.email,
        ),
      )
      .toBe(true);
  });

  // Invitations to an unverified address stay hidden (someone could register
  // with another person's email), and password sign-ups start unverified. The
  // Invitations page offers a 6-digit code to verify the address.
  test("an existing user verifies their email, then sees and accepts an invitation on the Invitations page", async ({
    pageAs,
    mailpit,
  }) => {
    const { page: owner, workspace } = await newUserWithWorkspace(pageAs);
    const {
      page: existing,
      user: existingUser,
      workspace: ownWorkspace,
    } = await newUserWithWorkspace(pageAs);

    await owner.goto(membersPath(workspace.id));
    const since = new Date();
    await inviteThroughUI(owner, existingUser.email);
    await mailpit.waitForMessage({ to: existingUser.email, since });

    await existing.goto(workspacePath(ownWorkspace.id));
    // Unverified, the entry shows without a count and leads to the prompt.
    const invitationsNav = existing.getByRole("button", {
      name: /^Invitations/,
    });
    await invitationsNav.click();
    await expect(existing).toHaveURL(/\/dashboard\/invitations/);
    await expect(
      existing.getByText(
        `Verify your email to see invitations sent to ${existingUser.email}.`,
      ),
    ).toBeVisible();

    const codeSince = new Date();
    await existing.getByRole("button", { name: "Send code" }).click();
    const codeEmail = await mailpit.waitForMessage({
      to: existingUser.email,
      subject: "Verify your email",
      since: codeSince,
    });
    const code = extractCode(codeEmail);
    expect(code).toMatch(/^\d{6}$/);
    await existing.getByLabel("Verification code").fill(code as string);
    await existing.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(existing.getByText("Email verified")).toBeVisible();

    await expect(invitationsNav).toContainText("1");
    const item = existing
      .getByRole("listitem")
      .filter({ hasText: workspace.name });
    await expect(item).toBeVisible();
    await item
      .getByRole("button", { name: `Accept invitation to ${workspace.name}` })
      .click();
    await expect(
      existing.getByText("Invitation accepted! Welcome to the team."),
    ).toBeVisible();
  });

  test("a pending invitation can be cancelled", async ({ pageAs }) => {
    const { page, workspace } = await newUserWithWorkspace(pageAs);
    const inviteeEmail = uniqueEmail("cancelled");
    await page.goto(membersPath(workspace.id));
    await inviteThroughUI(page, inviteeEmail);

    const row = memberRow(page, inviteeEmail);
    await row.getByRole("button", { name: "Invitation actions" }).click();
    await page.getByRole("menuitem", { name: "Cancel invitation" }).click();
    const dialog = page.getByRole("alertdialog", {
      name: "Cancel invitation?",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(inviteeEmail)).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel invitation" }).click();

    await expect(
      page.getByText("Invitation cancelled successfully"),
    ).toBeVisible();
    await expect(row).toHaveCount(0);

    // The link no longer works for the invitee.
    const invitations = await (
      await page.request.get(
        `${E2E_API_URL}/api/auth/organization/list-invitations`,
        {
          params: { organizationId: workspace.id },
          headers: { Origin: E2E_WEB_URL },
        },
      )
    ).json();
    const invitation = (
      invitations as { email: string; status: string }[]
    ).find((candidate) => candidate.email === inviteeEmail);
    expect(invitation?.status).toBe("canceled");
  });
});

test.describe("members list", () => {
  test("the owner changes a member's role and removes them", async ({
    pageAs,
  }) => {
    const { page: owner, workspace } = await newUserWithWorkspace(pageAs);

    // A second user joins through an invitation accepted over the API.
    const memberPage = await pageAs("anonymous");
    const member = await signUpViaApi(memberPage.request);
    const invite = await owner.request.post(
      `${E2E_API_URL}/api/auth/organization/invite-member`,
      {
        data: {
          email: member.email,
          role: "member",
          organizationId: workspace.id,
        },
        headers: { Origin: E2E_WEB_URL },
      },
    );
    expect(invite.status()).toBe(200);
    const { id: invitationId } = await invite.json();
    const accepted = await memberPage.request.post(
      `${E2E_API_URL}/api/auth/organization/accept-invitation`,
      { data: { invitationId }, headers: { Origin: E2E_WEB_URL } },
    );
    expect(accepted.status()).toBe(200);

    await owner.goto(membersPath(workspace.id));
    const row = memberRow(owner, member.email);
    await expect(row).toContainText(member.name);
    const roleSelect = row.getByRole("combobox");
    await expect(roleSelect).toHaveText("Member");

    // Owner is not offered: ownership moves through the transfer flow.
    await roleSelect.click();
    const listbox = owner.getByRole("listbox");
    await expect(listbox.getByRole("option", { name: "Viewer" })).toBeVisible();
    await expect(listbox.getByRole("option", { name: "Admin" })).toBeVisible();
    await expect(listbox.getByRole("option", { name: "Owner" })).toHaveCount(0);
    await listbox.getByRole("option", { name: "Viewer" }).click();

    await expect(owner.getByText("Role updated")).toBeVisible();
    await expect(roleSelect).toHaveText("Viewer");
    await expect
      .poll(
        async () =>
          (await listMembers(owner, workspace.id)).find(
            (candidate) => candidate.user.email === member.email,
          )?.role,
      )
      .toBe("viewer");

    // The member's own view follows the new role: no project creation.
    await memberPage.goto(projectsPath(workspace.id));
    await expect(
      memberPage.getByRole("button", {
        name: `Switch workspace: ${workspace.name}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(memberPage.getByText("No projects yet")).toBeVisible();
    await expect(
      memberPage.getByRole("button", { name: "Add project" }),
    ).toHaveCount(0);

    // Owner rows never get a role picker or a remove action.
    const ownerRow = owner.getByRole("row").filter({ hasText: "(You)" });
    await expect(ownerRow.getByRole("combobox")).toHaveCount(0);
    await expect(
      ownerRow.getByRole("button", { name: "Remove member" }),
    ).toHaveCount(0);

    await row.getByRole("button", { name: "Remove member" }).click();
    await owner.getByRole("menuitem", { name: "Remove member" }).click();
    const dialog = owner.getByRole("alertdialog", {
      name: "Remove team member?",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Remove member" }).click();

    await expect(
      owner.getByText("Team member removed successfully"),
    ).toBeVisible();
    await expect(row).toHaveCount(0);
    expect(
      (await listMembers(owner, workspace.id)).map((m) => m.user.email),
    ).not.toContain(member.email);
  });
});

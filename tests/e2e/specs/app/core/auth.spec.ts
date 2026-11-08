import { asAnonymous, test } from "../../../fixtures";
import { E2E_API_URL, E2E_WEB_URL } from "../../../helpers/env";
import { signInViaUI, workspaceSwitcher } from "../../../helpers/ui";
import {
  createWorkspaceViaApi,
  expect,
  signUpViaApi,
  uniqueEmail,
  workspacePath,
} from "./_support";

// Multi-step flows against shared, often busy dev servers: allow more than
// the default 60 s per test and 30 s per navigation.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 60_000 });

// Every test starts signed out and works with accounts it creates, so signing
// out never revokes a shared storage state.
test.use(asAnonymous);

const PASSWORD = "Core-Password-2026!";

async function fillSignUp(
  page: import("@playwright/test").Page,
  { name, email, password }: { name: string; email: string; password: string },
) {
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByPlaceholder("••••••••").fill(password);
}

test.describe("sign up", () => {
  test("shows validation errors for a malformed email and a short password", async ({
    page,
  }) => {
    await page.goto("/auth/sign-up");
    await expect(
      page.getByText("Get started with your workspace"),
    ).toBeVisible();

    // Passes the browser's own type=email check but not the form's schema.
    await fillSignUp(page, {
      name: "Invalid Person",
      email: "person@nodomain",
      password: "short",
    });
    await page.getByRole("button", { name: "Create account" }).click();

    // The password policy: at least 10 characters, checked as the user types.
    await expect(page.getByText("Use at least 10 characters.")).toBeVisible();
    await expect(page.getByText(/invalid email/i)).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/sign-up/);
  });

  test("refuses a common password the server rejects", async ({ page }) => {
    await page.goto("/auth/sign-up");
    // Long enough for the form; a dictionary word with decoration is still
    // common, which only the server decides.
    await fillSignUp(page, {
      name: "Common Choice",
      email: uniqueEmail("common"),
      password: "Password2026!",
    });
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(
      page.getByText(
        "This password is too common and easy to guess. Choose another one.",
      ),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/sign-up/);
  });

  test("creates an account and sends a new user to workspace onboarding", async ({
    page,
  }) => {
    const email = uniqueEmail("signup");
    await page.goto("/auth/sign-up");
    await fillSignUp(page, {
      name: "Nadia Newcomer",
      email,
      password: PASSWORD,
    });
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Account created successfully")).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(
      page.getByRole("heading", { name: "Create workspace" }),
    ).toBeVisible();
  });

  test("rejects an email that already has an account", async ({ page }) => {
    const existing = await signUpViaApi(page.request);
    // The API call signed this browser in; start the UI flow signed out.
    await page.context().clearCookies();

    await page.goto("/auth/sign-up");
    await fillSignUp(page, {
      name: "Second Attempt",
      email: existing.email,
      password: PASSWORD,
    });
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText(/already exists/i)).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/sign-up/);
  });

  test("links to sign in from the sign-up page and back", async ({ page }) => {
    await page.goto("/auth/sign-up");
    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/auth\/sign-in/);
    await expect(page.getByText("Welcome back")).toBeVisible();
    await page.getByRole("link", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/auth\/sign-up/);
  });
});

test.describe("sign in", () => {
  test("a wrong password shows an error and keeps the user signed out", async ({
    page,
  }) => {
    const user = await signUpViaApi(page.request);
    await page.context().clearCookies();

    await page.goto("/auth/sign-in");
    await page.getByLabel("Email").fill(user.email);
    await page.getByPlaceholder("••••••••").fill("Definitely-Wrong-1!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/sign-in/);

    // Still signed out: the dashboard bounces back to sign-in.
    await page.goto("/dashboard", { waitUntil: "commit" });
    await expect(page).toHaveURL(/\/auth\/sign-in/);
  });

  test("signs in, keeps the session across a reload and signs out", async ({
    page,
  }) => {
    const user = await signUpViaApi(page.request);
    const workspace = await createWorkspaceViaApi(page.request);
    await page.context().clearCookies();

    await signInViaUI(page, user);
    await expect(page).toHaveURL(new RegExp(workspacePath(workspace.id)));
    await expect(workspaceSwitcher(page, workspace.name)).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(new RegExp(workspacePath(workspace.id)));
    await expect(workspaceSwitcher(page, workspace.name)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Account menu" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/auth\/sign-in/);
    await expect(page.getByText("Signed out successfully")).toBeVisible();

    // A new tab of the same browser is signed out too.
    const tab = await page.context().newPage();
    await tab.goto(workspacePath(workspace.id), { waitUntil: "commit" });
    await expect(tab).toHaveURL(/\/auth\/sign-in/);
    await expect(
      tab.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
  });

  // Regression: a copied session_token + session_data pair once kept
  // authorizing API calls for up to 5 minutes after sign-out (Better Auth's
  // session cookie cache).
  test("signing out revokes the session for every API call", async ({
    page,
    request,
  }) => {
    const user = await signUpViaApi(page.request);
    const workspace = await createWorkspaceViaApi(page.request);
    await page.context().clearCookies();
    await signInViaUI(page, user);

    const cookieHeader = (await page.context().cookies())
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const listProjects = () =>
      request.get(`${E2E_API_URL}/api/project`, {
        params: { workspaceId: workspace.id },
        headers: { Cookie: cookieHeader, Origin: E2E_WEB_URL },
      });
    // The copied cookies authorize while the session lives.
    expect((await listProjects()).status()).toBe(200);

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/auth\/sign-in/);
    // The sign-in page shows first; the session ends right after.
    await expect(page.getByText("Signed out successfully")).toBeVisible();

    expect((await listProjects()).status()).toBe(401);
  });

  test("signing out lands on a clean sign-in page without a reload", async ({
    page,
  }) => {
    const user = await signUpViaApi(page.request);
    await createWorkspaceViaApi(page.request);
    await page.context().clearCookies();
    await signInViaUI(page, user);

    const unauthorized: string[] = [];
    page.on("response", (response) => {
      if (response.status() === 401) unauthorized.push(response.url());
    });
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState("networkidle");

    expect(new URL(page.url()).searchParams.get("redirect")).toBeNull();
    expect(unauthorized).toEqual([]);
  });

  // The session ends once the requests already on the wire settle, up to
  // about 3 s after the sign-in page shows. Leaving the page in that time
  // must still end it: on a shared computer the next person would get in.
  for (const leave of ["closing the tab", "reloading"] as const) {
    test(`${leave} while the sign-out waits still ends the session`, async ({
      page,
      request,
    }) => {
      const user = await signUpViaApi(page.request);
      const workspace = await createWorkspaceViaApi(page.request);
      await page.context().clearCookies();
      // The dashboard's project list stays on the wire, so the sign-out has
      // to wait for it.
      await page.route(/\/api\/project(\?|$)/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 8000));
        await route.continue().catch(() => {});
      });
      await signInViaUI(page, user);

      const cookieHeader = (await page.context().cookies())
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");
      const listProjects = async () =>
        (
          await request.get(`${E2E_API_URL}/api/project`, {
            params: { workspaceId: workspace.id },
            headers: { Cookie: cookieHeader, Origin: E2E_WEB_URL },
          })
        ).status();
      expect(await listProjects()).toBe(200);

      await page.getByRole("button", { name: "Account menu" }).click();
      await page.getByRole("menuitem", { name: "Log out" }).click();
      await expect(page).toHaveURL(/\/auth\/sign-in/);
      if (leave === "closing the tab") {
        await page.close();
      } else {
        await page.unroute(/\/api\/project(\?|$)/);
        await page.reload();
        await expect(
          page.getByRole("button", { name: "Sign in", exact: true }),
        ).toBeVisible();
      }

      await expect.poll(listProjects).toBe(401);
    });
  }

  test("a protected page redirects to sign-in and returns there afterwards", async ({
    page,
  }) => {
    const user = await signUpViaApi(page.request);
    await createWorkspaceViaApi(page.request);
    await page.context().clearCookies();

    await page.goto("/dashboard/settings/account/preferences", {
      waitUntil: "commit",
    });
    await expect(page).toHaveURL(/\/auth\/sign-in\?redirect=/);
    expect(new URL(page.url()).searchParams.get("redirect")).toBe(
      "/dashboard/settings/account/preferences",
    );

    await page.getByLabel("Email").fill(user.email);
    await page.getByPlaceholder("••••••••").fill(user.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/dashboard\/settings\/account\/preferences/);
    await expect(
      page.getByRole("heading", { name: "Preferences" }),
    ).toBeVisible();
  });

  for (const path of [
    "/dashboard",
    "/dashboard/settings/workspace/general",
    "/onboarding",
  ]) {
    test(`signed-out visit to ${path} lands on sign-in`, async ({ page }) => {
      await page.goto(path, { waitUntil: "commit" });
      await expect(page).toHaveURL(/\/auth\/sign-in/);
      await expect(
        page.getByRole("button", { name: "Sign in", exact: true }),
      ).toBeVisible();
    });
  }
});

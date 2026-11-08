import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { asAnonymous, expect, test } from "../../../fixtures";
import {
  createWorkspace,
  expectJson,
  expectStatus,
  headerContext,
  signUpUser,
} from "../../../helpers/api-kit";
import { E2E_API_URL, E2E_WEB_URL, REPO_ROOT } from "../../../helpers/env";
import { uniqueName } from "../../../helpers/ui";
import { SEED_USERS } from "../../../seed/data";

// The screens for connecting an identity provider, and the sign-in screen. The
// seeded owner is the instance administrator. No real identity provider takes
// part: the sign-on address below answers from inside the test.

const SIGN_ON = "https://idp.margaya.test/sso";
const CERTIFICATE = readFileSync(
  path.join(REPO_ROOT, "tests/api-integration/fixtures/saml/idp.crt"),
  "utf8",
);

const safeSlug = (text: string) =>
  text.toLowerCase().replaceAll(/[^a-z0-9]/g, "");

/** Instance changes need a recent sign-in, and seeded sessions are older. */
async function confirmPassword(page: Page) {
  const response = await page.request.post(
    `${E2E_API_URL}/api/instance-admin/reauth`,
    {
      data: { password: SEED_USERS.owner.password },
      headers: { Origin: E2E_WEB_URL },
    },
  );
  expect(response.ok()).toBe(true);
}

test("an instance admin connects a provider, sees the token once and replaces it", async ({
  pageAs,
}) => {
  const workspaceOwner = await signUpUser("SCIM screen owner");
  const workspace = await createWorkspace(workspaceOwner.ctx);
  const page = await pageAs("owner");
  await confirmPassword(page);
  await page.goto("/dashboard/settings/instance/authentication");

  const section = page.locator("section", {
    has: page.getByRole("heading", { name: "Provisioning (SCIM)" }),
  });
  await section.getByRole("button", { name: "Connect provider" }).click();

  const name = uniqueName("Directory");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByLabel("Workspace", { exact: true }).click();
  await page.getByRole("option", { name: workspace.name }).click();
  await dialog.getByRole("button", { name: "Create token" }).click();

  const tokenField = page.getByLabel("Bearer token");
  await expect(tokenField).not.toHaveValue("");
  const token = await tokenField.inputValue();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(tokenField).toBeHidden();

  // The token really works, and only this once is it shown.
  const provider = await headerContext({ Authorization: `Bearer ${token}` });
  const email = `${safeSlug(uniqueName("scim"))}@margaya.test`;
  await expectJson(
    await provider.post("/api/auth/scim/v2/Users", {
      data: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: email,
        emails: [{ value: email, primary: true }],
      },
    }),
    201,
  );
  await page.reload();
  const row = section.getByRole("row", { name: new RegExp(name) });
  await expect(row).toContainText(workspace.name);
  await expect(row).toContainText("1");
  await expect(page.getByText(token)).toBeHidden();

  await row.getByRole("button", { name: "Replace token" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Replace token" })
    .click();
  await expect(page.getByLabel("Bearer token")).not.toHaveValue(token);
  await page.getByRole("button", { name: "Done" }).click();
  await expectStatus(await provider.get("/api/auth/scim/v2/Users"), 401);
  await provider.dispose();

  await row.getByRole("button", { name: "Remove" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(row).toBeHidden();
  await workspaceOwner.ctx.dispose();
});

test("an instance admin connects a SAML provider, and people on its domain reach it", async ({
  pageAs,
  browser,
}) => {
  const page = await pageAs("owner");
  await confirmPassword(page);
  await page.goto("/dashboard/settings/instance/authentication");

  const section = page.locator("section", {
    has: page.getByRole("heading", { name: "Company sign-in (SAML)" }),
  });
  await section.getByRole("button", { name: "Connect provider" }).click();

  const name = uniqueName("Company sign-in");
  const domain = `${safeSlug(uniqueName("saml"))}.margaya.test`;
  const sheet = page.getByRole("dialog");
  await expect(
    sheet.getByLabel("Assertion Consumer Service URL"),
  ).not.toHaveValue("");
  await sheet.getByLabel("Name", { exact: true }).fill(name);
  await sheet.getByLabel("Email domains").fill(domain);
  await sheet
    .getByLabel("Identity provider entity ID (issuer)")
    .fill("https://idp.margaya.test/entity");
  await sheet.getByLabel("Single sign-on URL").fill(SIGN_ON);
  await sheet.getByLabel("Signing certificate").fill(CERTIFICATE);
  await sheet.getByRole("button", { name: "Connect", exact: true }).click();

  const row = section.getByRole("row", { name: new RegExp(name) });
  await expect(row).toContainText(domain);

  try {
    const context = await browser.newContext(asAnonymous);
    const visitor = await context.newPage();
    // Only the first hop to the identity provider matters here.
    await visitor.route("https://idp.margaya.test/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "IdP" }),
    );
    await visitor.goto(`${E2E_WEB_URL}/auth/sign-in`);
    await visitor
      .getByRole("button", { name: "Continue with company sign-in" })
      .click();
    const email = visitor.getByLabel("Work email");

    await email.fill("pat@unconnected.margaya.test");
    await visitor
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await expect(
      visitor.getByText("Company sign-in isn't set up for that email domain."),
    ).toBeVisible();

    await email.fill(`pat@${domain}`);
    await visitor
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    await visitor.waitForURL(`${SIGN_ON}?**`);
    expect(new URL(visitor.url()).searchParams.get("SAMLRequest")).toBeTruthy();
    await context.close();
  } finally {
    await row.getByRole("button", { name: "Remove" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Remove" })
      .click();
    await expect(row).toBeHidden();
  }
});

test("the sign-in screen explains a refused SAML response in words", async ({
  browser,
}) => {
  const context = await browser.newContext(asAnonymous);
  const page = await context.newPage();
  await page.goto(`${E2E_WEB_URL}/auth/sign-in?error=unsolicited_response`);
  await expect(
    page.getByText(
      "Start company sign-in from this page. Sign-in that starts at your identity provider isn't accepted.",
    ),
  ).toBeVisible();
  await context.close();
});

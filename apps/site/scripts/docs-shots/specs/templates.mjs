/**
 * Screenshots for the project templates guides
 * (apps/docs/core/functional/templates): the create project dialog's Choose
 * and Set up steps, a new board's First steps list and example-task banner,
 * the first-run setup and the Add workspace dialog.
 *
 * LOCAL DEVELOPMENT ONLY. The dialog shots use the Studio North seed and
 * create nothing. templates/first-steps creates a "Bug tracker" project with
 * example tasks in Studio North and templates/examples-banner shows its
 * board; templates/onboarding-name deletes it again (to the trash, then
 * permanently), so run the section as a whole. The first-run and Add
 * workspace shots each sign up a new fictional account, so the Studio North
 * people and workspaces are not touched.
 */

const API = process.env.DOCS_SHOTS_API_URL ?? "http://localhost:1337";
const CLIENT = process.env.DOCS_SHOTS_CLIENT_URL ?? "http://localhost:5173";

const ws = (seed) => `/dashboard/workspace/${seed.workspace.id}`;

const NEW_PROJECT = "Bug tracker";
const DIALOG = { selector: "[role=dialog]", pad: 0 };

/** Studio North projects named like the one templates/first-steps creates. */
async function createdProjects(page, seed) {
  const response = await page.context().request.get(`${API}/api/project`, {
    params: { workspaceId: seed.workspace.id },
    headers: { Origin: CLIENT },
  });
  if (!response.ok()) return [];
  const body = await response.json();
  const list = Array.isArray(body) ? body : (body.projects ?? body.items ?? []);
  return list.filter((project) => project.name === NEW_PROJECT);
}

/** Deletes those projects for good: to the trash, then out of it. */
async function removeCreatedProjects(page, seed) {
  const request = page.context().request;
  const headers = { Origin: CLIENT };
  for (const project of await createdProjects(page, seed)) {
    await request.delete(`${API}/api/project/${project.id}`, { headers });
    await request.delete(`${API}/api/trash/projects/${project.id}`, {
      headers,
    });
  }
}

/**
 * Swaps the press session for a new fictional account. The address is new
 * on every run, so the account has no workspace yet.
 */
async function signUpFreshUser(page) {
  const context = page.context();
  await context.clearCookies();
  const stamp = Date.now().toString(36);
  const response = await context.request.post(`${API}/api/auth/sign-up/email`, {
    data: {
      name: "Nora Hale",
      email: `nora.hale.${stamp}@margaya.test`,
      password: "Margaya-Docs-Templates-2026!",
    },
    headers: { Origin: CLIENT },
  });
  if (!response.ok()) {
    throw new Error(`sign-up failed: ${response.status()}`);
  }
  await context.request.patch(`${API}/api/user/preferences`, {
    data: { theme: "light" },
    headers: { Origin: CLIENT },
  });
}

async function createWorkspaceViaApi(page, name, slug) {
  const request = page.context().request;
  const headers = { Origin: CLIENT };
  const created = await request.post(`${API}/api/auth/organization/create`, {
    data: { name, slug },
    headers,
  });
  if (!created.ok()) {
    throw new Error(`creating the workspace failed: ${created.status()}`);
  }
  const workspace = await created.json();
  await request.post(`${API}/api/auth/organization/set-active`, {
    data: { organizationId: workspace.id },
    headers,
  });
  return workspace;
}

/** Opens the create project dialog from + next to Projects in the side panel. */
async function openCreateProject(page) {
  await page
    .locator("[data-sidebar=group]")
    .filter({ has: page.getByText("Projects", { exact: true }) })
    .last()
    .getByRole("button", { name: "Add project" })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: /Create a project|Set up your project/,
  });
  await dialog.waitFor({ state: "visible" });
  await dialog
    .getByRole("radio", { name: /Blank project/ })
    .first()
    .waitFor({ state: "visible", timeout: 60_000 });
  return dialog;
}

async function selectTemplate(dialog, category, template) {
  await dialog.getByRole("tab", { name: category }).first().click();
  const tile = dialog.getByRole("radio", { name: new RegExp(`^${template}`) });
  await tile.first().click();
  await dialog
    .getByRole("region", { name: `Preview: ${template}` })
    .getByText("Statuses")
    .first()
    .waitFor({ state: "visible", timeout: 60_000 });
}

/** First-run setup, step 1, filled in. */
async function fillOnboardingName(page) {
  await page
    .getByRole("heading", { name: /Name your workspace/ })
    .first()
    .waitFor({ state: "visible", timeout: 60_000 });
  await page.getByLabel("Workspace name").first().fill("Studio North");
  await page.getByRole("button", { name: "Software", exact: true }).click();
}

/** First-run setup through step 1, so step 2 shows. */
async function reachFirstProjectStep(page) {
  await fillOnboardingName(page);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page
    .getByRole("heading", { name: /Start your first project/ })
    .first()
    .waitFor({ state: "visible", timeout: 60_000 });
}

const shots = [
  // ------------------------------------------------- create project dialog
  {
    name: "templates/gallery",
    url: (seed) => `${ws(seed)}/projects`,
    ready: "Website relaunch",
    prepare: async (page) => {
      const dialog = await openCreateProject(page);
      await dialog
        .getByRole("tab", { name: "Software development" })
        .first()
        .click();
      await dialog
        .getByRole("radio", { name: /^Scrum sprints/ })
        .first()
        .waitFor({ state: "visible" });
      await dialog
        .getByRole("region", { name: /^Preview: / })
        .getByText("Statuses")
        .first()
        .waitFor({ state: "visible", timeout: 60_000 });
    },
    clip: DIALOG,
  },
  {
    name: "templates/preview",
    url: (seed) => `${ws(seed)}/projects`,
    ready: "Website relaunch",
    // The dialog is at most 680px tall and the preview scrolls inside it;
    // a taller dialog shows the whole preview in one picture.
    viewport: { width: 1440, height: 1200 },
    prepare: async (page) => {
      const dialog = await openCreateProject(page);
      await selectTemplate(dialog, "Software development", "Bug tracker");
      await page.addStyleTag({
        content: "[role=dialog] { height: 1110px !important; }",
      });
    },
    clip: DIALOG,
  },
  {
    name: "templates/setup",
    url: (seed) => `${ws(seed)}/projects`,
    ready: "Website relaunch",
    prepare: async (page) => {
      const dialog = await openCreateProject(page);
      await selectTemplate(dialog, "Software development", "Bug tracker");
      await dialog.getByRole("button", { name: "Use template" }).click();
      await dialog
        .getByRole("heading", { name: /Set up your project/ })
        .waitFor({ state: "visible" });
    },
    clip: DIALOG,
  },
  {
    name: "templates/restricted-suggestion",
    url: (seed) => `${ws(seed)}/projects`,
    ready: "Website relaunch",
    prepare: async (page) => {
      const dialog = await openCreateProject(page);
      await selectTemplate(dialog, "Human resources", "HR service desk");
      await dialog.getByRole("button", { name: "Use template" }).click();
      await dialog
        .getByText("This template suggests a restricted project.", {
          exact: false,
        })
        .waitFor({ state: "visible" });
    },
    clip: DIALOG,
  },

  // ------------------------------------------- a board made from a template
  {
    name: "templates/first-steps",
    url: (seed) => `${ws(seed)}/projects`,
    ready: "Website relaunch",
    prepare: async (page, seed) => {
      await removeCreatedProjects(page, seed);
      const dialog = await openCreateProject(page);
      await selectTemplate(dialog, "Software development", NEW_PROJECT);
      await dialog.getByRole("button", { name: "Use template" }).click();
      const examples = dialog.getByRole("switch", {
        name: "Add example tasks",
      });
      if ((await examples.getAttribute("aria-checked")) !== "true") {
        await examples.click();
      }
      await dialog.getByRole("button", { name: "Create project" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 60_000 });
      await page.waitForURL(/\/project\/[^/]+\/board$/, { timeout: 60_000 });
      await page
        .getByRole("region", { name: "First steps" })
        .waitFor({ state: "visible", timeout: 60_000 });
      // "Bug tracker created." would sit on the board.
      await page.addStyleTag({
        content: "[data-slot=toast-viewport] { display: none !important; }",
      });
    },
  },
  {
    name: "templates/examples-banner",
    url: (seed) => `${ws(seed)}/projects`,
    ready: "Website relaunch",
    // A new browser has no First steps list for the project, so the banner
    // shows straight away for an Owner.
    prepare: async (page, seed) => {
      const [project] = await createdProjects(page, seed);
      if (!project) throw new Error("run templates/first-steps first");
      await page.goto(
        new URL(`${ws(seed)}/project/${project.id}/board`, CLIENT).href,
        { waitUntil: "domcontentloaded" },
      );
      await page
        .getByText("This project has example tasks.")
        .first()
        .waitFor({ state: "visible", timeout: 60_000 });
    },
    clip: { x: 312, y: 0, width: 1128, height: 360 },
  },

  // ---------------------------------------------------- first-run setup
  {
    name: "templates/onboarding-name",
    url: "/onboarding",
    before: async (page, seed) => {
      // Still signed in as the press account here: clean up after
      // templates/first-steps before switching accounts.
      await removeCreatedProjects(page, seed);
      await signUpFreshUser(page);
    },
    prepare: fillOnboardingName,
    clip: { x: 440, y: 248, width: 560, height: 464 },
  },
  {
    name: "templates/onboarding-first-project",
    url: "/onboarding",
    before: async (page) => signUpFreshUser(page),
    viewport: { width: 1440, height: 1000 },
    prepare: async (page) => {
      await reachFirstProjectStep(page);
      // A template shows the name, key and example tasks it fills in.
      await page
        .getByRole("radio", { name: /^Scrum sprints/ })
        .first()
        .click();
      await page
        .getByRole("switch", { name: "Add example tasks" })
        .first()
        .waitFor({ state: "visible" });
    },
    clip: { x: 316, y: 90, width: 808, height: 906 },
  },
  {
    name: "templates/workspace-starters",
    url: "/onboarding",
    before: async (page) => signUpFreshUser(page),
    prepare: async (page) => {
      await reachFirstProjectStep(page);
      const starter = page.getByRole("button", { name: /^Software team/ });
      await starter.first().click();
      await page
        .getByRole("button", { name: /^Create 4 projects/ })
        .first()
        .waitFor({ state: "visible" });
      await starter.first().scrollIntoViewIfNeeded();
    },
    clip: { x: 316, y: 90, width: 808, height: 806 },
  },

  // --------------------------------------------------- Add workspace dialog
  {
    name: "templates/workspace-ready",
    url: "/dashboard",
    before: async (page) => {
      await signUpFreshUser(page);
      await createWorkspaceViaApi(
        page,
        "Studio North",
        `studio-north-${Date.now().toString(36)}`,
      );
    },
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^Switch workspace/ })
        .first()
        .waitFor({ state: "visible", timeout: 60_000 });
      await page
        .getByRole("button", { name: /^Switch workspace/ })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Add workspace" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible" });
      await dialog.getByPlaceholder("Workspace name").fill("Studio North Labs");
      await dialog.getByRole("button", { name: "Create workspace" }).click();
      await dialog
        .getByText("Studio North Labs is ready")
        .waitFor({ state: "visible", timeout: 60_000 });
    },
    clip: DIALOG,
  },
];

// Docs screenshots are light mode only.
export default shots.map((shot) => ({ themes: ["light"], ...shot }));

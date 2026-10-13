import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import {
  brokenEntries,
  DOCS_PREFIX,
  docsNavigation,
  docsNavigationPages,
  docsUrl,
  fetchStatuses,
  findBrandLeaks,
  isDocsPath,
  snapshotPage,
  toLocalPath,
} from "../../helpers/docs-site";

// Opt-in docs-site project: E2E_DOCS_SITE=1 pnpm e2e --project=docs-site
//
// The rendered documentation, as linked from the public site under /docs.
// apps/site renders apps/docs (MDX plus docs.json) under /docs. The page list comes
// from apps/docs/docs.json plus whatever the rendered sidebar links to.

// The sidebar crawl visits every page (over 400) and `next dev` compiles on
// first request.
test.describe.configure({ timeout: 1_800_000 });
test.use({ navigationTimeout: 150_000 });

async function openDocs(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `${path} status`).toBe(200);
  return response;
}

/** Same-origin docs hrefs in the sidebar (the navigation holding the most docs links). */
async function sidebarLinks(page: Page): Promise<string[]> {
  const perNavigation = await page
    .locator("nav, aside, [id*=sidebar]")
    .evaluateAll((containers) =>
      containers.map((container) =>
        [...container.querySelectorAll("a[href]")].map(
          (a) => a.getAttribute("href") ?? "",
        ),
      ),
    );
  const docsOnly = perNavigation.map((hrefs) =>
    hrefs
      .map(toLocalPath)
      .filter((href): href is string => !!href && isDocsPath(href)),
  );
  return docsOnly.sort((a, b) => b.length - a.length)[0] ?? [];
}

test("the docs index loads with a sidebar of sections", async ({ page }) => {
  await openDocs(page, DOCS_PREFIX);
  await expect(page).toHaveTitle(/Margaya/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  // Every sidebar group from docs.json on the Guides tab is shown.
  const guideGroups = [
    ...new Set(
      docsNavigation()
        .filter((group) => group.tab === "Guides")
        .map((group) => group.group),
    ),
  ];
  for (const group of guideGroups) {
    await expect(page.getByText(group, { exact: true }).first()).toBeVisible();
  }
  expect((await sidebarLinks(page)).length).toBeGreaterThan(10);
});

test("every docs page reachable from the sidebar loads with one h1, clean branding and working links", async ({
  page,
  request,
}) => {
  await openDocs(page, docsUrl("core/index"));
  const pages = new Set([
    ...docsNavigationPages().map(docsUrl),
    ...(await sidebarLinks(page)),
  ]);

  const problems: string[] = [];
  const idsByPage = new Map<string, string[]>();
  const referrers = new Map<string, Set<string>>();
  const anchors: { from: string; path: string; id: string }[] = [];

  for (const path of pages) {
    const snapshot = await snapshotPage(page, path);
    if (snapshot.status !== 200) {
      problems.push(`${path}: HTTP ${snapshot.status}`);
      continue;
    }
    idsByPage.set(path, snapshot.ids);
    if (snapshot.h1Count !== 1)
      problems.push(`${path}: ${snapshot.h1Count} h1 elements`);
    if (!/\bMargaya\b/.test(snapshot.title))
      problems.push(`${path}: title "${snapshot.title}"`);
    if (!snapshot.metas.description)
      problems.push(`${path}: no meta description`);
    for (const leak of [
      ...findBrandLeaks(snapshot.title),
      ...findBrandLeaks(snapshot.visibleText),
      ...Object.values(snapshot.metas).flatMap(findBrandLeaks),
    ]) {
      problems.push(`${path}: brand leak ${leak}`);
    }
    for (const src of snapshot.imagesWithoutAlt)
      problems.push(`${path}: img without alt ${src}`);

    for (const href of [...snapshot.hrefs, ...snapshot.imageSources]) {
      const hash = href.includes("#") ? href.slice(href.indexOf("#") + 1) : "";
      const target = href.startsWith("#") ? path : toLocalPath(href);
      if (!target || target.startsWith("/_next/")) continue;
      if (!referrers.has(target)) referrers.set(target, new Set());
      referrers.get(target)?.add(path);
      if (hash && isDocsPath(target)) {
        anchors.push({
          from: path,
          path: target,
          id: decodeURIComponent(hash),
        });
      }
    }
  }

  const statuses = await fetchStatuses(request, referrers.keys());
  problems.push(...brokenEntries(statuses, referrers));

  for (const anchor of anchors) {
    let ids = idsByPage.get(anchor.path);
    if (!ids && statuses.get(anchor.path) === 200) {
      ids = (await snapshotPage(page, anchor.path)).ids;
      idsByPage.set(anchor.path, ids);
    }
    if (ids && !ids.includes(anchor.id)) {
      problems.push(
        `${anchor.from}: link to missing anchor ${anchor.path}#${anchor.id}`,
      );
    }
  }

  expect(problems).toEqual([]);
});

test("code blocks render with their content", async ({ page }) => {
  await openDocs(page, docsUrl("core/installation/docker-compose"));
  const code = page.locator("pre code, pre").first();
  await expect(code).toBeVisible();
  await expect(code).toContainText(/docker|services:/i);
  expect(await page.locator("pre").count()).toBeGreaterThan(1);
});

test("previous and next links follow the sidebar order", async ({ page }) => {
  const order = docsNavigationPages().filter(
    (id) => !id.startsWith("api-reference/"),
  );
  const index = order.indexOf("core/functional/cycles");
  const previous = order[index - 1] ?? "";
  const next = order[index + 1] ?? "";

  await openDocs(page, docsUrl("core/functional/cycles"));
  const main = page.getByRole("main").or(page.locator("article")).first();
  await main.getByRole("link", { name: /next/i }).last().click();
  await expect(page).toHaveURL(new RegExp(`${docsUrl(next)}$`));

  await openDocs(page, docsUrl("core/functional/cycles"));
  await main
    .getByRole("link", { name: /previous|prev/i })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`${docsUrl(previous)}$`));
});

test("docs search finds a guide", async ({ page }) => {
  await openDocs(page, DOCS_PREFIX);
  await page
    .getByRole("button", { name: /search/i })
    .first()
    .click();
  const input = page
    .getByRole("combobox")
    .or(page.getByRole("searchbox"))
    .first();
  await input.fill("Docker Compose");
  const result = page
    .getByRole("option")
    .or(page.getByRole("link", { name: /docker/i }))
    .first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(page).toHaveURL(/\/docs\/core\/installation/);
});

test.describe("API reference", () => {
  test("the introduction loads and links to the OpenAPI document", async ({
    page,
  }) => {
    await openDocs(page, docsUrl("api-reference/introduction"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "API Reference",
    );
    await expect(
      page.getByRole("link", { name: /OpenAPI Specification/ }),
    ).toBeVisible();
  });

  const spotChecks = [
    {
      id: "api-reference/endpoints/tasks/listTasks",
      method: "GET",
      route: "/task/tasks/{projectId}",
    },
    {
      id: "api-reference/endpoints/tasks/createTask",
      method: "POST",
      route: "/task/{projectId}",
    },
    {
      id: "api-reference/endpoints/projects/listProjects",
      method: "GET",
      route: "/project",
    },
    {
      id: "api-reference/endpoints/notifications/listNotifications",
      method: "GET",
      route: "/notification",
    },
  ];

  for (const check of spotChecks) {
    test(`${check.method} ${check.route} renders as an operation`, async ({
      page,
    }) => {
      await openDocs(page, docsUrl(check.id));
      const main = page.getByRole("main").first();
      await expect(
        main.getByText(check.method, { exact: true }).first(),
      ).toBeVisible();
      await expect(main.getByText(check.route).first()).toBeVisible();
    });
  }

  test("views, intake and home operations have reference pages", async ({
    request,
  }) => {
    const statuses = await fetchStatuses(request, [
      docsUrl("api-reference/endpoints/views/listViews"),
      docsUrl("api-reference/endpoints/intake/listIntakeItems"),
      docsUrl("api-reference/endpoints/home/getHomePreferences"),
    ]);
    expect(brokenEntries(statuses)).toEqual([]);
  });
});

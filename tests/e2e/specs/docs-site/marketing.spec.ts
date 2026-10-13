import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import {
  brokenEntries,
  fetchStatuses,
  isDocsPath,
  toLocalPath,
} from "../../helpers/docs-site";

// Opt-in docs-site project: E2E_DOCS_SITE=1 pnpm e2e --project=docs-site

const CLOUD_URL = "https://cloud.margaya.app";

// `next dev` compiles each route on first request, which can take a minute.
test.describe.configure({ timeout: 180_000 });
test.use({ navigationTimeout: 150_000 });

/** Same-origin hrefs in the header (Resources menu opened) and the footer. */
async function navigationAndFooterLinks(page: Page) {
  const header = page.getByRole("banner");
  await header.getByRole("button", { name: "Resources" }).click();
  await expect(
    header.getByRole("link", { name: "Documentation" }),
  ).toBeVisible();
  const hrefs = [
    ...(await header
      .locator("a[href]")
      .evaluateAll((anchors) =>
        anchors.map((a) => a.getAttribute("href") ?? ""),
      )),
    ...(await page
      .getByRole("contentinfo")
      .locator("a[href]")
      .evaluateAll((anchors) =>
        anchors.map((a) => a.getAttribute("href") ?? ""),
      )),
  ];
  return hrefs;
}

test.describe("landing page", () => {
  test("renders the hero, calls to action, navigation and footer", async ({
    page,
  }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Margaya/);

    const header = page.getByRole("banner");
    await expect(
      header.getByRole("link", { name: "Margaya home" }),
    ).toBeVisible();
    const nav = header.getByRole("navigation");
    await expect(nav.getByRole("link", { name: "Product" })).toHaveAttribute(
      "href",
      "/#features",
    );
    await expect(nav.getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "href",
      "/pricing",
    );
    await expect(nav.getByRole("link", { name: "Blog" })).toHaveAttribute(
      "href",
      "/blog",
    );
    await expect(nav.getByRole("button", { name: "Resources" })).toBeVisible();
    // No hosted service yet: the navbar has no Sign in button.
    await expect(header.getByRole("button", { name: "Sign in" })).toHaveCount(
      0,
    );
    await expect(
      header.getByRole("button", { name: "Get started" }),
    ).toBeVisible();

    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(
      /Project management\s*that doesn.t become the project\./,
    );
    await expect(
      main.getByRole("link", { name: "Try Margaya Cloud" }),
    ).toHaveAttribute("href", "/docs/core/installation");
    await expect(
      main.getByRole("link", { name: "Self-host Margaya" }).first(),
    ).toHaveAttribute("href", "/docs/core/installation");
    await expect(
      main.getByText("14-day cloud trial. No credit card required."),
    ).toBeVisible();
    await expect(
      main.getByRole("link", { name: "GitHub" }).first(),
    ).toHaveAttribute("href", "https://github.com/manu14357/Margaya");

    // "Product" points at the features section on the same page.
    await expect(page.locator("#features")).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "Big tasks. Clear next steps." }),
    ).toBeVisible();

    const footer = page.getByRole("contentinfo");
    await expect(
      footer.getByRole("link", { name: "Margaya home" }),
    ).toBeVisible();
    await expect(
      footer.getByText("Project management that doesn't become the project."),
    ).toBeVisible();
    for (const name of [
      "Open Cloud",
      "Getting Started",
      "Features",
      "Pricing",
      "Comparisons",
      "Guides",
      "Blog",
      "Press kit",
      "Documentation",
      "Privacy Policy",
      "Terms of Service",
    ]) {
      await expect(
        footer.getByRole("link", { name, exact: true }),
      ).toBeVisible();
    }
    await expect(
      footer.getByRole("link", { name: "support@margaya.app" }),
    ).toHaveAttribute("href", "mailto:support@margaya.app");
  });

  test("the Resources menu lists documentation, guides, comparisons and the roadmap", async ({
    page,
  }) => {
    await page.goto("/");
    const header = page.getByRole("banner");
    await header.getByRole("button", { name: "Resources" }).click();
    await expect(
      header.getByRole("link", { name: "Documentation" }),
    ).toHaveAttribute("href", "/docs/core");
    await expect(header.getByRole("link", { name: "Guides" })).toHaveAttribute(
      "href",
      "/guides",
    );
    await expect(
      header.getByRole("link", { name: "Compare tools" }),
    ).toHaveAttribute("href", "/alternatives");
    await expect(header.getByRole("link", { name: "Roadmap" })).toHaveAttribute(
      "href",
      new RegExp(`^${CLOUD_URL}/public-project/`),
    );

    await header.getByRole("link", { name: "Guides" }).click();
    await expect(page).toHaveURL(/\/guides$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 90_000,
    });
  });

  test("Get Started opens the self-host guide", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("banner")
      .getByRole("button", { name: "Get started" })
      .click();
    await expect(page).toHaveURL(/\/docs\/core\/installation$/);
  });

  test("internal navigation and footer links outside the docs resolve", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    const targets = (await navigationAndFooterLinks(page))
      .map(toLocalPath)
      .filter((value): value is string => value !== null && !isDocsPath(value));
    expect(targets).toEqual(
      expect.arrayContaining([
        "/",
        "/pricing",
        "/blog",
        "/guides",
        "/alternatives",
        "/press",
      ]),
    );
    const statuses = await fetchStatuses(request, targets);
    expect(brokenEntries(statuses)).toEqual([]);

    // The footer's in-page link lands on an existing section.
    await page.goto("/#features");
    await expect(page.locator("#features")).toBeInViewport();
  });

  test("documentation links in the hero, navigation and footer resolve", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    const docsLinks = [
      ...(await navigationAndFooterLinks(page)),
      ...(await page
        .getByRole("main")
        .locator('a[href^="/docs"]')
        .evaluateAll((anchors) =>
          anchors.map((a) => a.getAttribute("href") ?? ""),
        )),
    ]
      .map(toLocalPath)
      .filter((value): value is string => value !== null && isDocsPath(value));
    expect(docsLinks).toEqual(
      expect.arrayContaining([
        "/docs",
        "/docs/core",
        "/docs/core/installation",
      ]),
    );
    const statuses = await fetchStatuses(request, docsLinks);
    expect(brokenEntries(statuses)).toEqual([]);
  });

  test("the self-host call to action opens the installation guide", async ({
    page,
  }) => {
    await page.goto("/");
    const [response] = await Promise.all([
      page.waitForResponse((res) =>
        res.url().endsWith("/docs/core/installation"),
      ),
      page
        .getByRole("main")
        .getByRole("link", { name: "Self-host Margaya" })
        .first()
        .click(),
    ]);
    expect(response.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /install/i,
    );
  });
});

test.describe("marketing pages", () => {
  const pages = [
    {
      path: "/pricing",
      title: "Pricing | Margaya",
      h1: /Free to run yourself\.\s*Fair when we run it for you\./,
    },
    { path: "/press", title: "Press kit | Margaya", h1: "Margaya press kit" },
    {
      path: "/alternatives",
      title: "Margaya alternatives and comparisons | Margaya",
      h1: "How Margaya compares",
    },
    {
      path: "/guides",
      title: "Guides | Margaya",
      h1: "Straight answers about project tools",
    },
    {
      path: "/blog",
      title: "Blog | Margaya",
      h1: "Straight comparisons, no marketing maths",
    },
    {
      path: "/privacy",
      title: "Privacy Policy | Margaya",
      h1: "Privacy Policy",
    },
    {
      path: "/terms",
      title: "Terms of Service | Margaya",
      h1: "Terms of Service",
    },
  ];

  for (const entry of pages) {
    test(`${entry.path} renders inside the site chrome`, async ({ page }) => {
      const response = await page.goto(entry.path);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(entry.title);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        entry.h1,
      );
      await expect(
        page.getByRole("banner").getByRole("link", { name: "Margaya home" }),
      ).toBeVisible();
      await expect(page.getByRole("contentinfo")).toBeVisible();
    });
  }

  test("pricing shows the three plans and switches billing interval", async ({
    page,
  }) => {
    await page.goto("/pricing");
    const main = page.getByRole("main");
    for (const plan of ["Self-hosted", "Cloud Personal", "Cloud Team"]) {
      await expect(
        main.getByRole("heading", { name: plan, exact: true }),
      ).toBeVisible();
    }
    await expect(main.getByText("Most popular")).toBeVisible();

    const annual = main.getByRole("button", { name: /^annual/i });
    const monthly = main.getByRole("button", { name: /^monthly/i });
    await expect(annual).toHaveAttribute("aria-pressed", "true");
    const trialLinks = main.getByRole("link", {
      name: "Start 14-day free trial",
    });
    await expect(trialLinks.first()).toHaveAttribute(
      "href",
      `${CLOUD_URL}/auth/sign-up?checkout=personal-annual`,
    );

    await monthly.click();
    await expect(monthly).toHaveAttribute("aria-pressed", "true");
    await expect(annual).toHaveAttribute("aria-pressed", "false");
    await expect(main.getByText("Billed monthly").first()).toBeVisible();
    await expect(trialLinks.first()).toHaveAttribute(
      "href",
      `${CLOUD_URL}/auth/sign-up?checkout=personal-monthly`,
    );
    await expect(trialLinks.nth(1)).toHaveAttribute(
      "href",
      `${CLOUD_URL}/auth/sign-up?checkout=team-monthly`,
    );
    await expect(
      main.getByRole("link", { name: "Read installation guide" }),
    ).toHaveAttribute("href", "/docs/core/installation");
  });

  test("the comparisons index links to each comparison page", async ({
    page,
  }) => {
    await page.goto("/alternatives");
    const jira = page.getByRole("link", { name: /Margaya vs Jira/ });
    await expect(jira).toHaveAttribute("href", "/jira-alternative");
    await jira.click();
    await expect(page).toHaveURL(/\/jira-alternative$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "The open-source Jira alternative",
    );
    await expect(page).toHaveTitle("Open-source Jira alternative | Margaya");
  });

  test("the blog index opens a post and filters by category", async ({
    page,
  }) => {
    await page.goto("/blog");
    const categories = page.getByRole("navigation", {
      name: "Blog categories",
    });
    await expect(
      categories.getByRole("link", { name: "All posts" }),
    ).toHaveAttribute("aria-current", "page");
    await categories.getByRole("link", { name: "Alternatives" }).click();
    await expect(page).toHaveURL(/\/blog\/category\/alternatives$/);
    await expect(
      page
        .getByRole("navigation", { name: "Blog categories" })
        .getByRole("link", { name: "Alternatives" }),
    ).toHaveAttribute("aria-current", "page");

    const post = page.locator('main a[href^="/blog/best-"]').first();
    const href = await post.getAttribute("href");
    await post.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByRole("main")).toContainText("Margaya");
  });

  test("the guides index opens a guide", async ({ page }) => {
    await page.goto("/guides");
    const guide = page.locator('main a[href^="/guides/"]').first();
    const href = await guide.getAttribute("href");
    await guide.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 90_000,
    });
  });

  test("the press kit shows logos that load", async ({ page }) => {
    await page.goto("/press");
    for (const name of [
      "Dark Margaya logo on a light background",
      "Light Margaya logo on a dark background",
      "Margaya app icon",
    ]) {
      const image = page
        .getByRole("main")
        .getByRole("img", { name, exact: true });
      await expect(image).toBeVisible();
      await expect
        .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBeGreaterThan(0);
    }
  });

  test("the press kit download and product screenshots exist", async ({
    page,
    request,
  }) => {
    await page.goto("/press");
    const assets = await page
      .getByRole("main")
      .locator("a[download], img[src]")
      .evaluateAll((elements) =>
        elements.map(
          (el) => el.getAttribute("href") ?? el.getAttribute("src") ?? "",
        ),
      );
    const statuses = await fetchStatuses(
      request,
      assets
        .map(toLocalPath)
        .filter((value): value is string => value !== null),
    );
    expect(brokenEntries(statuses)).toEqual([]);
  });
});

test.describe("mobile viewport", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("the hamburger menu opens, navigates and closes", async ({ page }) => {
    await page.goto("/");
    const header = page.getByRole("banner");
    // The desktop navigation collapses into the menu button.
    await expect(header.getByRole("link", { name: "Pricing" })).toBeHidden();
    const menuButton = header.getByRole("button", { name: "Menu" });
    await expect(menuButton).toBeVisible();

    await menuButton.click();
    const dialog = page.getByRole("dialog", { name: "Menu" });
    await expect(dialog).toBeVisible();
    const menu = dialog.getByRole("navigation", { name: "Menu" });
    for (const name of [
      "Product",
      "Pricing",
      "Blog",
      "Documentation",
      "Guides",
      "Compare tools",
      "Roadmap",
    ]) {
      await expect(menu.getByRole("link", { name, exact: true })).toBeVisible();
    }
    await expect(dialog.getByRole("link", { name: "Sign in" })).toHaveCount(0);
    await expect(
      dialog.getByRole("link", { name: "Get started" }),
    ).toHaveAttribute("href", "/docs/core/installation");

    await dialog.getByRole("button", { name: "Close menu" }).click();
    await expect(dialog).toBeHidden();

    await menuButton.click();
    await page
      .getByRole("dialog", { name: "Menu" })
      .getByRole("link", { name: "Pricing", exact: true })
      .click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
      timeout: 90_000,
    });
  });

  for (const path of [
    "/",
    "/pricing",
    "/press",
    "/blog",
    "/jira-alternative",
  ]) {
    test(`${path} fits the viewport without horizontal scrolling`, async ({
      page,
    }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
        timeout: 90_000,
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});

test.describe("color scheme", () => {
  for (const scheme of ["dark", "light"] as const) {
    test.describe(`${scheme} preference`, () => {
      test.use({ colorScheme: scheme });

      test(`the site follows a ${scheme} system preference`, async ({
        page,
      }) => {
        await page.goto("/");
        const html = page.locator("html");
        if (scheme === "dark") {
          await expect(html).toHaveClass(/\bdark\b/);
        } else {
          await expect(html).not.toHaveClass(/\bdark\b/);
        }
        await expect(html).toHaveCSS("color-scheme", scheme);

        // Text stays readable: foreground and background differ in lightness.
        const [background, foreground] = await page.evaluate(() => {
          // Computed colors may be oklch() or lab(); a canvas converts to sRGB.
          const context = document.createElement("canvas").getContext("2d");
          const luminance = (color: string) => {
            if (!context) return Number.NaN;
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const main = document.querySelector("main") ?? document.body;
          const style = getComputedStyle(main);
          return [luminance(style.backgroundColor), luminance(style.color)];
        });
        if (scheme === "dark") {
          expect(background).toBeLessThan(80);
          expect(foreground).toBeGreaterThan(160);
        } else {
          expect(background).toBeGreaterThan(200);
          expect(foreground).toBeLessThan(100);
        }
      });
    });
  }
});

import { expect, test } from "../../fixtures";
import {
  brokenEntries,
  fetchStatuses,
  findBrandLeaks,
  isDocsPath,
  type PageSnapshot,
  parseSitemapLocations,
  SITE_ORIGIN,
  sitemapPagePaths,
  snapshotPage,
  toLocalPath,
} from "../../helpers/docs-site";

// Opt-in docs-site project: E2E_DOCS_SITE=1 pnpm e2e --project=docs-site
// Visits every page in the site's sitemap once, then checks SEO, branding,
// accessibility and links on the captured snapshots.

test.describe.configure({ timeout: 600_000 });
test.use({ navigationTimeout: 150_000 });

// The press kit download and product screenshots, also checked on their own.
const PRESS_ASSETS =
  /^\/(press\/margaya-press-kit\.zip|images\/product\/[\w-]+\.png)$/;

let snapshots: PageSnapshot[] = [];

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  testInfo.setTimeout(900_000);
  const baseURL = testInfo.project.use.baseURL;
  const request = await playwright.request.newContext({ baseURL });
  const paths = await sitemapPagePaths(request);
  await request.dispose();
  const context = await browser.newContext({ baseURL, locale: "en-US" });
  const page = await context.newPage();
  snapshots = [];
  for (const path of paths) snapshots.push(await snapshotPage(page, path));
  await context.close();
});

/** Fail with one line per page that has a problem. */
function expectNoProblems(
  check: (snapshot: PageSnapshot) => string[] | string | null | undefined,
) {
  expect(snapshots.length).toBeGreaterThan(0);
  const problems = snapshots.flatMap((snapshot) => {
    const result = check(snapshot);
    const list =
      result == null ? [] : Array.isArray(result) ? result : [result];
    return list.map((problem) => `${snapshot.path}: ${problem}`);
  });
  expect(problems).toEqual([]);
}

test.describe("sitemap and robots", () => {
  test("robots.txt allows crawling and points at the sitemap", async ({
    request,
  }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toMatch(/User-Agent:\s*\*/i);
    expect(body).toMatch(/^Allow:\s*\/\s*$/m);
    expect(body).not.toMatch(/^Disallow:\s*\/\s*$/m);
    expect(body).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
  });

  test("sitemap.xml is an index that includes the page sitemap", async ({
    request,
  }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("xml");
    const children = parseSitemapLocations(await response.text());
    expect(children).toContain("/sitemap-pages.xml");
    const pages = await request.get("/sitemap-pages.xml");
    expect(pages.status()).toBe(200);
    expect(parseSitemapLocations(await pages.text())).toEqual(
      expect.arrayContaining([
        "/",
        "/pricing",
        "/press",
        "/blog",
        "/guides",
        "/alternatives",
      ]),
    );
  });

  test("every sitemap in the index resolves", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    const children = parseSitemapLocations(await response.text());
    expect(children).toContain("/docs/sitemap.xml");
    expect(brokenEntries(await fetchStatuses(request, children))).toEqual([]);
  });

  test("every page in the sitemap returns 200", async () => {
    expect(snapshots.length).toBeGreaterThanOrEqual(40);
    expectNoProblems((s) => (s.status === 200 ? null : `HTTP ${s.status}`));
  });

  test("the RSS feed and llms.txt are served", async ({ request }) => {
    const rss = await request.get("/blog/rss.xml");
    expect(rss.status()).toBe(200);
    expect(await rss.text()).toContain("<rss");
    const llms = await request.get("/llms.txt");
    expect(llms.status()).toBe(200);
    expect(await llms.text()).toMatch(/^# Margaya/);
  });
});

test.describe("SEO basics", () => {
  test("every page has a Margaya title, a meta description and a canonical URL", async () => {
    expectNoProblems((s) => {
      const problems: string[] = [];
      if (!/\bMargaya\b/.test(s.title))
        problems.push(`title "${s.title}" lacks Margaya`);
      if ((s.metas.description ?? "").trim().length < 25) {
        problems.push(
          `meta description missing or trivial: "${s.metas.description ?? ""}"`,
        );
      }
      if (
        !s.links.some(
          (link) =>
            link.rel === "canonical" && link.href.startsWith(SITE_ORIGIN),
        )
      ) {
        problems.push("no canonical link");
      }
      if (!s.metas["og:title"]) problems.push("no og:title");
      return problems;
    });
  });

  test("page titles and descriptions are unique", async () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const s of snapshots) {
      for (const key of [
        `title:${s.title}`,
        `description:${s.metas.description}`,
      ]) {
        const first = seen.get(key);
        if (first) duplicates.push(`${s.path} repeats ${key} from ${first}`);
        else seen.set(key, s.path);
      }
    }
    expect(duplicates).toEqual([]);
  });

  test("the favicon and app icons resolve", async ({ request }) => {
    const home = snapshots.find((s) => s.path === "/");
    expect(home).toBeDefined();
    const icons = (home?.links ?? [])
      .filter((link) => /icon/.test(link.rel))
      .map((link) => toLocalPath(link.href))
      .filter((value): value is string => value !== null);
    expect(icons).toEqual(
      expect.arrayContaining(["/favicon.svg", "/apple-touch-icon.png"]),
    );
    const statuses = await fetchStatuses(request, [...icons, "/favicon.ico"]);
    expect(brokenEntries(statuses)).toEqual([]);
    const svg = await request.get("/favicon.svg");
    expect(svg.headers()["content-type"]).toContain("image/svg+xml");
  });

  test("Open Graph and Twitter images resolve", async ({ request }) => {
    const images = new Set<string>();
    for (const s of snapshots) {
      for (const key of ["og:image", "twitter:image"]) {
        const local = toLocalPath(s.metas[key] ?? "");
        if (local) images.add(local);
      }
    }
    expect(images.size).toBeGreaterThan(0);
    const statuses = await fetchStatuses(request, images);
    expect(brokenEntries(statuses)).toEqual([]);
  });
});

test.describe("branding", () => {
  test("no page shows a legacy brand name in text, title or meta tags", async () => {
    expectNoProblems((s) => [
      ...findBrandLeaks(s.title).map((leak) => `title: ${leak}`),
      ...findBrandLeaks(s.visibleText).map((leak) => `text: ${leak}`),
      ...Object.entries(s.metas).flatMap(([name, content]) =>
        findBrandLeaks(content).map((leak) => `meta ${name}: ${leak}`),
      ),
    ]);
  });

  test("the product name appears in every title and in the site name", async () => {
    expectNoProblems((s) => {
      const problems: string[] = [];
      if (!s.title.includes("Margaya")) problems.push(`title "${s.title}"`);
      const siteName = s.metas["og:site_name"];
      if (siteName && siteName !== "Margaya")
        problems.push(`og:site_name "${siteName}"`);
      return problems;
    });
    const home = snapshots.find((s) => s.path === "/");
    expect(home?.metas["application-name"]).toBe("Margaya");
  });
});

test.describe("accessibility smoke", () => {
  test("every page declares its language and has exactly one h1", async () => {
    expectNoProblems((s) => {
      const problems: string[] = [];
      if (s.lang !== "en") problems.push(`lang="${s.lang}"`);
      if (s.h1Count !== 1)
        problems.push(`${s.h1Count} h1 elements: ${JSON.stringify(s.h1Text)}`);
      else if (!s.h1Text[0]) problems.push("empty h1");
      return problems;
    });
  });

  test("every image has alt text", async () => {
    expectNoProblems((s) =>
      s.imagesWithoutAlt.map((src) => `img without alt: ${src}`),
    );
  });

  test("every page has a banner, a main region and a footer", async () => {
    expectNoProblems((s) => {
      const problems: string[] = [];
      if (s.landmarks.banner !== 1)
        problems.push(`${s.landmarks.banner} banner landmarks`);
      if (s.landmarks.main < 1) problems.push("no main landmark");
      if (s.landmarks.main > 1) {
        problems.push(`${s.landmarks.main} main landmarks`);
      }
      if (s.landmarks.contentinfo !== 1) {
        problems.push(`${s.landmarks.contentinfo} contentinfo landmarks`);
      }
      return problems;
    });
  });

  test("the landing page exposes a single main landmark", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("main")).toHaveCount(1);
  });

  test("skip links, where present, target an element on the page", async () => {
    expectNoProblems((s) =>
      s.skipLink && !s.ids.includes(s.skipLink.target)
        ? `skip link "${s.skipLink.text}" targets missing #${s.skipLink.target}`
        : null,
    );
  });

  test("every same-page anchor link targets an element on the page", async () => {
    expectNoProblems((s) =>
      s.hrefs
        .filter((href) => href.startsWith("#") && href.length > 1)
        .filter((href) => !s.ids.includes(decodeURIComponent(href.slice(1))))
        .map((href) => `link to missing ${href}`),
    );
  });
});

test.describe("links", () => {
  function collectTargets(filter: (path: string) => boolean) {
    const referrers = new Map<string, Set<string>>();
    for (const s of snapshots) {
      for (const raw of [...s.hrefs, ...s.imageSources]) {
        const local = toLocalPath(raw);
        if (!local || local.startsWith("/_next/") || !filter(local)) continue;
        if (!referrers.has(local)) referrers.set(local, new Set());
        referrers.get(local)?.add(s.path);
      }
    }
    return referrers;
  }

  test("internal links and images outside the docs resolve", async ({
    request,
  }) => {
    const referrers = collectTargets((path) => !isDocsPath(path));
    expect(referrers.size).toBeGreaterThan(40);
    const statuses = await fetchStatuses(request, referrers.keys());
    expect(brokenEntries(statuses, referrers)).toEqual([]);
  });

  test("links into the documentation resolve", async ({ request }) => {
    const referrers = collectTargets(isDocsPath);
    expect(referrers.size).toBeGreaterThan(0);
    const statuses = await fetchStatuses(request, referrers.keys());
    expect(brokenEntries(statuses, referrers)).toEqual([]);
  });

  test("press kit assets resolve", async ({ request }) => {
    const referrers = collectTargets((path) => PRESS_ASSETS.test(path));
    expect(referrers.size).toBeGreaterThan(0);
    const statuses = await fetchStatuses(request, referrers.keys());
    expect(brokenEntries(statuses, referrers)).toEqual([]);
  });

  test("images on every page load", async ({ page }) => {
    // Rendered check on the pages that carry the most imagery.
    const problems: string[] = [];
    for (const path of ["/", "/blog", "/alternatives", "/guides"]) {
      await page.goto(path, { waitUntil: "load" });
      const broken = await page.evaluate(() =>
        [...document.images]
          .filter((img) => img.complete && img.naturalWidth === 0 && img.src)
          .map((img) => img.getAttribute("src")),
      );
      problems.push(...broken.map((src) => `${path}: broken image ${src}`));
    }
    expect(problems).toEqual([]);
  });
});

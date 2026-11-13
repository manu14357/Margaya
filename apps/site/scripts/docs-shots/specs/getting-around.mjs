/**
 * Screenshots for the "getting around" docs: Home, Your work, Inbox,
 * favorites, keyboard shortcuts, member profiles, creating a workspace or
 * project, a project's calendar feed, and Send feedback and the survey card
 * (apps/docs/core/functional). The survey card's config and check are
 * answered in the browser.
 *
 * LOCAL DEVELOPMENT ONLY. Everything comes from the Studio North seed. The
 * favorites shot stars a few items for the press account and the inbox shot
 * opens (and so reads) one notification; the last shot puts both back so
 * other docs screenshots keep the seeded sidebar and unread count.
 */

const API = process.env.DOCS_SHOTS_API_URL ?? "http://localhost:1337";

const ws = (seed) => `/dashboard/workspace/${seed.workspace.id}`;
const web = (seed) => seed.projects.web;

/** Calls the API from the page, so the browser's session cookie is used. */
async function api(page, method, path, body) {
  return page.evaluate(
    async ([url, method, body]) => {
      const response = await fetch(url, {
        method,
        credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },
    [`${API}/api${path}`, method, body],
  );
}

/**
 * Marks the union of several elements' boxes with an invisible overlay, so
 * a shot can crop to, say, a button and the menu it opened.
 */
async function markClip(page, selectors, pad = 12) {
  await page.evaluate(
    ([selectors, pad]) => {
      document.getElementById("docs-shot-clip")?.remove();
      const boxes = selectors
        .map((s) => document.querySelector(s)?.getBoundingClientRect())
        .filter(Boolean);
      const left = Math.max(0, Math.min(...boxes.map((b) => b.left)) - pad);
      const top = Math.max(0, Math.min(...boxes.map((b) => b.top)) - pad);
      const right = Math.max(...boxes.map((b) => b.right)) + pad;
      const bottom = Math.max(...boxes.map((b) => b.bottom)) + pad;
      const mark = document.createElement("div");
      mark.id = "docs-shot-clip";
      Object.assign(mark.style, {
        position: "fixed",
        left: `${left}px`,
        top: `${top}px`,
        width: `${right - left}px`,
        height: `${bottom - top}px`,
        pointerEvents: "none",
        zIndex: "-1",
      });
      document.body.append(mark);
    },
    [selectors, pad],
  );
}

const CLIP_MARK = { selector: "#docs-shot-clip" };
const MAIN = { selector: "[data-slot=shell-main]" };

/** The notification the inbox shot opens: Priya's mention on WEB-1. */
async function pricingMention(page, seed) {
  const inbox = await api(
    page,
    "GET",
    `/notification/inbox?workspaceId=${seed.workspace.id}`,
  );
  return (inbox.items ?? []).find(
    (n) => n.type === "task_mention" && n.task?.key === "WEB-1",
  );
}

async function restorePricingMention(page, seed) {
  const mention = await pricingMention(page, seed);
  if (mention?.isRead) {
    await api(page, "PATCH", `/notification/${mention.id}/unread`);
  }
}

/** What the favorites shot stars, in sidebar order (newest on top). */
const favorites = (seed) => [
  ["page", web(seed).page?.id],
  ["cycle", web(seed).cycles["Sprint 14"].id],
  ["project", web(seed).id],
];

const shots = [
  // Quick start hero and the top of the Home guide: the whole screen.
  {
    name: "getting-around/home",
    url: (seed) => ws(seed),
    ready: "Quick links",
    prepare: async (page, seed) => {
      // Fills Recents with a realistic mix of tasks, a project and a page.
      const visits = [
        ["project", web(seed).id],
        ["page", web(seed).page?.id],
        ["task", seed.projects.mobile.tasks.biometric.id],
        ["task", web(seed).tasks.stories.id],
        ["task", web(seed).tasks.pricing.id],
      ];
      for (const [entityType, entityId] of visits) {
        if (!entityId) continue;
        await api(page, "POST", "/recent-visit", {
          workspaceId: seed.workspace.id,
          entityType,
          entityId,
        });
      }
      await page.reload({ waitUntil: "domcontentloaded" });
      await page
        .getByText("Redesign the pricing page")
        .first()
        .waitFor({ state: "visible", timeout: 60_000 });
    },
  },
  {
    name: "getting-around/home-manage-widgets",
    url: (seed) => ws(seed),
    ready: "Quick links",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Manage widgets" }).click();
      await page
        .getByRole("dialog")
        .getByText("Stickies")
        .waitFor({ state: "visible" });
    },
    clip: { selector: "[role=dialog]", pad: 0 },
  },
  {
    name: "getting-around/home-add-link",
    url: (seed) => ws(seed),
    ready: "Quick links",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Add link" }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible" });
      const inputs = dialog.locator("input");
      await inputs.nth(0).fill("https://roadmap.studionorth.example");
      await inputs.nth(1).fill("Public roadmap");
    },
    clip: { selector: "[role=dialog]", pad: 0 },
  },
  {
    name: "getting-around/stickies",
    url: (seed) => `${ws(seed)}/stickies`,
    ready: "Friday demo",
    clip: { x: 312, y: 0, width: 1128, height: 300 },
  },

  {
    name: "getting-around/workspace-switcher",
    url: (seed) => ws(seed),
    ready: "Quick links",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^Switch workspace/ })
        .first()
        .click();
      await page
        .getByRole("menuitem", { name: "Add workspace" })
        .waitFor({ state: "visible" });
      await page
        .getByRole("menu")
        .evaluate((el) => el.setAttribute("data-docs-shot", "menu"));
      await markClip(page, ["[data-docs-shot=menu]"], 12);
      await page.evaluate(() => {
        // Starts the crop at the rail so the switcher button shows too.
        const mark = document.getElementById("docs-shot-clip");
        const width = mark.getBoundingClientRect().right;
        Object.assign(mark.style, {
          left: "0px",
          top: "0px",
          width: `${width}px`,
        });
        mark.style.height = `${mark.getBoundingClientRect().height + 12}px`;
      });
    },
    clip: CLIP_MARK,
  },
  {
    name: "getting-around/create-workspace",
    url: (seed) => ws(seed),
    ready: "Quick links",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^Switch workspace/ })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Add workspace" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible" });
      await dialog.getByPlaceholder("Workspace name").fill("Studio North Labs");
    },
    clip: { selector: "[role=dialog]", pad: 0 },
  },
  {
    name: "getting-around/create-project",
    url: (seed) => `${ws(seed)}/projects`,
    ready: "Website relaunch",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "Create project" })
        .first()
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible" });
      await dialog.getByPlaceholder("Project name").fill("Brand refresh");
    },
    clip: { selector: "[role=dialog]", pad: 0 },
  },
  {
    name: "getting-around/project-views",
    url: (seed) => `${ws(seed)}/project/${web(seed).id}/board`,
    ready: "Annual billing toggle",
    clip: { x: 312, y: 0, width: 1128, height: 128 },
  },
  {
    name: "getting-around/project-calendar-feed",
    url: (seed) => `${ws(seed)}/project/${web(seed).id}/board`,
    ready: "Annual billing toggle",
    // Opens the dialog only; no link is created.
    prepare: async (page) => {
      const row = page
        .locator("li[data-sidebar=menu-item]")
        .filter({
          has: page.getByRole("button", {
            name: "Website relaunch",
            exact: true,
          }),
        })
        .first();
      await row.hover();
      await row.getByRole("button", { name: "More" }).first().click();
      await page
        .getByRole("menuitem", { name: "Subscribe in calendar" })
        .click();
      await page
        .getByRole("dialog")
        .getByText("Website relaunch", { exact: false })
        .first()
        .waitFor();
    },
    clip: { selector: "[role=dialog]", pad: 0 },
  },

  // ------------------------------------------------------------- feedback
  {
    name: "feedback/send-feedback",
    url: "/dashboard/settings/account/preferences",
    ready: "Subscribe in calendar",
    // Filled for the picture and never sent.
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "Send feedback", exact: true })
        .first()
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("radio", { name: "Happy", exact: true }).click();
      await dialog
        .getByRole("textbox")
        .fill("Cycles keep our sprints honest. A burndown chart would help.");
    },
    clip: { selector: "[role=dialog]", pad: 0 },
  },
  {
    name: "feedback/survey-card",
    url: (seed) => `${ws(seed)}/project/${web(seed).id}/board`,
    ready: "Annual billing toggle",
    // The survey asks a while after the app opens, and only when the server
    // says this account is due: both are answered here, and the clock runs
    // ahead so the card shows now.
    before: async (page) => {
      await page.clock.install();
      await page.route(
        (url) => url.pathname === "/api/feedback/config",
        (route) =>
          route.fulfill({
            status: 200,
            json: {
              enabled: true,
              survey: { enabled: true, format: "faces5", optedOut: false },
            },
          }),
      );
      await page.route(
        (url) => url.pathname === "/api/feedback/survey/check",
        (route) =>
          route.fulfill({
            status: 200,
            json: { show: true, format: "faces5" },
          }),
      );
    },
    prepare: async (page) => {
      await page.clock.fastForward("03:00");
      await page.getByText("How is Margaya working for you?").waitFor();
    },
  },

  {
    name: "getting-around/your-work-summary",
    url: (seed) => `${ws(seed)}/my-work?tab=summary`,
    ready: "Assigned and open",
    clip: MAIN,
  },
  {
    name: "getting-around/your-work-assigned",
    url: (seed) => `${ws(seed)}/my-work?tab=assigned`,
    ready: "Redesign the pricing page",
    clip: { x: 312, y: 0, width: 1128, height: 449 },
  },

  {
    name: "getting-around/inbox",
    url: (seed) => `${ws(seed)}/inbox`,
    ready: "Redesign the pricing page",
    prepare: async (page, seed) => {
      await restorePricingMention(page, seed);
      await page
        .getByRole("option")
        .filter({ hasText: "Redesign the pricing page" })
        .filter({ hasText: "mentioned" })
        .first()
        .click();
      await page
        .getByText("Unsubscribe")
        .first()
        .waitFor({ state: "visible", timeout: 60_000 });
      // The preview scrolls to the comment; go back up so the shot shows the
      // description and Show properties too.
      const show = page
        .getByRole("button", { name: "Show properties" })
        .first();
      await show.waitFor({ state: "attached", timeout: 30_000 });
      // Sub-tasks and activity load separately, and show empty states until then.
      await page
        .getByText("Draft the plan comparison table")
        .last()
        .waitFor({ state: "attached", timeout: 60_000 });
      await page
        .getByText("Looks great. I tightened the FAQ answers")
        .last()
        .waitFor({ state: "attached", timeout: 60_000 });
      await show.evaluate((el) => el.scrollIntoView({ block: "start" }));
    },
    clip: MAIN,
  },
  {
    name: "getting-around/inbox-snooze",
    url: (seed) => `${ws(seed)}/inbox`,
    ready: "Redesign the pricing page",
    keepPointer: true,
    prepare: async (page, seed) => {
      await restorePricingMention(page, seed);
      const row = page
        .getByRole("option")
        .filter({ hasText: "Public API v2 reference docs" })
        .filter({ hasText: "mentioned" })
        .first();
      await row.hover();
      await row.getByRole("button", { name: "Snooze" }).click();
      await page
        .getByRole("menuitem", { name: "2 weeks" })
        .waitFor({ state: "visible" });
      await row.evaluate((el) => el.setAttribute("data-docs-shot", "row"));
      await page
        .getByRole("menu")
        .evaluate((el) => el.setAttribute("data-docs-shot", "menu"));
      await markClip(page, ["[data-docs-shot=row]", "[data-docs-shot=menu]"]);
    },
    clip: CLIP_MARK,
  },
  {
    name: "getting-around/inbox-filters",
    url: (seed) => `${ws(seed)}/inbox`,
    ready: "Redesign the pricing page",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Filters" }).click();
      await page
        .getByRole("menuitemcheckbox", { name: "Unread only" })
        .waitFor({ state: "visible" });
    },
    clip: { x: 64, y: 0, width: 648, height: 420 },
  },

  {
    name: "getting-around/favorite-star",
    url: (seed) => `${ws(seed)}/project/${web(seed).id}/board`,
    ready: "Annual billing toggle",
    keepPointer: true,
    prepare: async (page, seed) => {
      // The star reads "Add to favorites" only while the project isn't one.
      await api(
        page,
        "DELETE",
        `/favorite/entity/project/${web(seed).id}?workspaceId=${seed.workspace.id}`,
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      const star = page.getByRole("button", { name: "Add to favorites" });
      await star.first().waitFor({ state: "visible", timeout: 60_000 });
      await star.first().hover();
      const tip = page.getByText("Add to favorites", { exact: true }).last();
      await tip.waitFor({ state: "visible" });
      await tip.evaluate((el) => el.setAttribute("data-docs-shot", "tip"));
      await star
        .first()
        .evaluate((el) => el.setAttribute("data-docs-shot", "star"));
      await page
        .locator("header")
        .getByText("Website relaunch")
        .first()
        .evaluate((el) => el.setAttribute("data-docs-shot", "title"));
      await markClip(page, [
        "[data-docs-shot=title]",
        "[data-docs-shot=star]",
        "[data-docs-shot=tip]",
      ]);
    },
    clip: CLIP_MARK,
  },
  {
    name: "getting-around/favorites-sidebar",
    url: (seed) => `${ws(seed)}/projects`,
    ready: "Website relaunch",
    prepare: async (page, seed) => {
      for (const [entityType, entityId] of favorites(seed)) {
        if (!entityId) continue;
        await api(page, "POST", "/favorite", {
          workspaceId: seed.workspace.id,
          entityType,
          entityId,
        });
      }
      await page.reload({ waitUntil: "domcontentloaded" });
      await page
        .locator("[data-slot=context-panel]")
        .getByText("Sprint 14")
        .first()
        .waitFor({ state: "visible", timeout: 60_000 });
    },
    clip: { x: 0, y: 0, width: 312, height: 520 },
  },

  {
    name: "getting-around/member-profile",
    url: (seed) => `${ws(seed)}/members`,
    ready: "Priya Raman",
    prepare: async (page) => {
      await page.getByRole("link", { name: "Priya Raman" }).first().click();
      await page
        .getByText("Open work by priority")
        .waitFor({ state: "visible", timeout: 60_000 });
    },
    clip: MAIN,
  },
  {
    name: "getting-around/member-profile-hover",
    url: (seed) => `${ws(seed)}/task/WEB-1`,
    ready: "Sub-tasks",
    keepPointer: true,
    prepare: async (page) => {
      const faces = page.locator(
        "[data-property=assignees] [data-slot=preview-card-trigger]",
      );
      await faces.first().hover();
      await page.mouse.move(1, 1);
      await faces.first().hover();
      await page
        .getByRole("link", { name: /^View .*'s profile$/ })
        .first()
        .waitFor({ state: "visible", timeout: 30_000 });
      await page
        .getByRole("link", { name: /^View .*'s profile$/ })
        .first()
        .evaluate((el) =>
          el
            .closest("[data-slot=preview-card-content]")
            ?.setAttribute("data-docs-shot", "card"),
        );
      // The avatar stack's own name tooltip would sit on top of the card.
      await page.addStyleTag({
        content: "[data-slot=tooltip-positioner] { display: none !important; }",
      });
      await markClip(page, [
        "[data-property=assignees]",
        "[data-docs-shot=card]",
      ]);
    },
    clip: CLIP_MARK,
  },

  {
    name: "getting-around/command-bar",
    url: (seed) => ws(seed),
    ready: "Quick links",
    prepare: async (page) => {
      await page.keyboard.press("Control+k");
      await page
        .getByRole("dialog")
        .getByText("Suggestions")
        .waitFor({ state: "visible" });
    },
    clip: { selector: "[role=dialog]", pad: 0 },
  },
  // Last: also puts back what the favorites and inbox shots changed.
  {
    name: "getting-around/keyboard-shortcuts",
    url: (seed) => ws(seed),
    ready: "Quick links",
    prepare: async (page, seed) => {
      for (const [entityType, entityId] of favorites(seed)) {
        if (!entityId) continue;
        await api(
          page,
          "DELETE",
          `/favorite/entity/${entityType}/${entityId}?workspaceId=${seed.workspace.id}`,
        );
      }
      await restorePricingMention(page, seed);
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.keyboard.press("Shift+Slash");
      await page
        .getByRole("dialog")
        .getByText("Open command palette")
        .waitFor({ state: "visible" });
    },
    clip: { selector: "[role=dialog]", pad: 0 },
  },
];

// Docs screenshots are light mode only.
export default shots.map((shot) => ({ themes: ["light"], ...shot }));

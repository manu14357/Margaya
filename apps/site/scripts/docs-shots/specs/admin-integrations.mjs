/**
 * Screenshots for the self-hosting docs: instance administration, sign-in
 * providers, project integrations, MCP and the first sign-up
 * (apps/docs/core/installation, integrations, social-providers, deployments).
 *
 * LOCAL DEVELOPMENT ONLY. Admin screens use the owner account (an instance
 * admin); everything else uses the Studio North press account. Forms are
 * filled for the picture and panels are opened, never submitted. Two shots
 * write: the Feedback page turns the survey on and files ten fictional
 * answers from the demo accounts, once. The MCP consent and device shots
 * create short-lived pending requests that expire on their own. A connected
 * Slack app and a Slack link prompt are answered in the browser, since real
 * ones need live Slack tokens. Rows for accounts outside the
 * margaya.test demo domain are hidden so no real person appears in the docs.
 */

const API = process.env.DOCS_SHOTS_API_URL ?? "http://localhost:1337";
const CLIENT = process.env.DOCS_SHOTS_CLIENT_URL ?? "http://localhost:5173";

const HIDE = `
  [data-sonner-toaster], [data-sonner-toast], .tsqd-parent-container,
  [aria-label="Open Tanstack query devtools"], [class*="devtools"] {
    display: none !important;
  }
  *, *::before, *::after {
    caret-color: transparent !important;
    transition-duration: 0s !important;
    animation-duration: 0s !important;
    animation-delay: 0s !important;
  }
`;

const instance = (page) => `/dashboard/settings/instance/${page}`;
const integrations = (seed) =>
  `/dashboard/settings/projects/${seed.projects.web.id}/integrations`;

/** A settings section, found by its heading. */
const section = (title) =>
  `section:has(> div h2:text-is(${JSON.stringify(title)}))`;

/** One collapsible integration on the project integrations page. */
const integration = (title) =>
  `div:has(> button h3:text-is(${JSON.stringify(title)}))`;

/** Hides table rows for accounts outside the fictional demo domain. */
async function hideOutsiders(page) {
  await page.evaluate(() => {
    for (const row of document.querySelectorAll("tbody tr")) {
      if (!row.textContent?.includes("margaya.test")) {
        row.style.display = "none";
      }
    }
  });
}

/** Navigates again inside prepare; the runner's hiding styles are re-added. */
async function goto(page, url, ready) {
  await page.goto(new URL(url, CLIENT).href, { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: HIDE });
  await page
    .getByText(ready, { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 60_000 });
}

async function openIntegration(page, title) {
  await page.getByRole("heading", { name: title, exact: true }).click();
  await page
    .locator(`${integration(title)} input`)
    .first()
    .waitFor({ state: "visible" });
  // The crop must fit in the viewport, so bring the section to the top.
  await page
    .locator(integration(title))
    .first()
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
}

/**
 * Marks the integration's header plus its first card (the connection
 * fields) with an invisible overlay, so the shot can stop before the long
 * event list that the page text already covers.
 */
async function markConnectionCard(page, title, cardTitle) {
  await page.evaluate(
    ([title, cardTitle]) => {
      document.getElementById("docs-shot-clip")?.remove();
      const heading = [...document.querySelectorAll("h3")].find(
        (element) => element.textContent?.trim() === title,
      );
      const root = heading?.closest("button")?.parentElement;
      let card = [...document.querySelectorAll("body *")].find(
        (element) =>
          element.children.length === 0 &&
          element.textContent?.trim() === cardTitle,
      );
      while (
        card &&
        !(
          typeof card.className === "string" &&
          card.className.includes("border") &&
          card.className.includes("rounded")
        )
      ) {
        card = card.parentElement;
      }
      if (!root || !card) throw new Error(`No card "${cardTitle}"`);
      const outer = root.getBoundingClientRect();
      const inner = card.getBoundingClientRect();
      const mark = document.createElement("div");
      mark.id = "docs-shot-clip";
      Object.assign(mark.style, {
        position: "fixed",
        left: `${outer.left - 8}px`,
        top: `${outer.top - 8}px`,
        width: `${outer.width + 16}px`,
        height: `${inner.bottom - outer.top + 24}px`,
        pointerEvents: "none",
      });
      document.body.append(mark);
    },
    [title, cardTitle],
  );
}

/** Fills the nth text input of an expanded integration, for the picture. */
async function fill(page, title, index, value) {
  await page
    .locator(`${integration(title)} input:not([type=checkbox])`)
    .nth(index)
    .fill(value);
}

async function configureProvider(page, index) {
  await page.getByRole("button", { name: "Configure" }).nth(index).click();
  await page.locator("[role=dialog]").waitFor({ state: "visible" });
}

// Pending requests are reused across the light and dark captures of a run.
let consentUrl = null;
let deviceCode = null;

async function mcpConsentUrl(page) {
  if (consentUrl) return consentUrl;
  const request = page.context().request;
  const redirectUri = "http://127.0.0.1:33418/callback";
  const registered = await request.post(`${API}/api/mcp/register`, {
    data: { client_name: "Cursor", redirect_uris: [redirectUri] },
    headers: { Origin: CLIENT },
  });
  if (!registered.ok()) {
    throw new Error(`MCP client registration failed: ${registered.status()}`);
  }
  const { client_id } = await registered.json();
  const params = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: redirectUri,
    // Any 43-character base64url value is a well-formed S256 challenge; the
    // flow is never completed, so no verifier is needed.
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    state: "docs",
  });
  const started = await request.get(`${API}/api/mcp/authorize?${params}`, {
    maxRedirects: 0,
  });
  const location = started.headers().location;
  if (!location) {
    throw new Error(`MCP authorize gave no redirect: ${started.status()}`);
  }
  consentUrl = location;
  return location;
}

async function mcpDeviceCode(page) {
  if (deviceCode) return deviceCode;
  const response = await page
    .context()
    .request.post(`${API}/api/auth/device/code`, {
      data: { client_id: "margaya-mcp" },
      headers: { Origin: CLIENT },
    });
  if (!response.ok()) {
    throw new Error(`Device code request failed: ${response.status()}`);
  }
  deviceCode = (await response.json()).user_code;
  return deviceCode;
}

const tall = { width: 1440, height: 1200 };

/**
 * Answers one GET in the browser. Identity connections hold real addresses and
 * a real one would need a token, so these shots show a connection nobody made.
 */
function mockGet(page, path, json) {
  return page.route(
    (url) => url.pathname === `/api${path}`,
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 200, json })
        : route.fallback(),
  );
}

/**
 * Marks the settings page from its title down to the bottom of the section
 * titled `lastTitle`, so a long page can be cropped after that section.
 */
async function markPageThrough(page, lastTitle) {
  await page.evaluate((lastTitle) => {
    document.getElementById("docs-shot-clip")?.remove();
    const root = document.querySelector("[data-slot=settings-page]");
    const heading = [...document.querySelectorAll("h2")].find(
      (element) => element.textContent?.trim() === lastTitle,
    );
    const last = heading?.closest("section");
    if (!root || !last) throw new Error(`No section "${lastTitle}"`);
    const outer = root.getBoundingClientRect();
    const inner = last.getBoundingClientRect();
    const mark = document.createElement("div");
    mark.id = "docs-shot-clip";
    Object.assign(mark.style, {
      position: "fixed",
      left: `${outer.left}px`,
      top: `${outer.top}px`,
      width: `${outer.width}px`,
      height: `${inner.bottom - outer.top + 16}px`,
      pointerEvents: "none",
    });
    document.body.append(mark);
  }, lastTitle);
}

const OWNER = { email: "owner@margaya.test", password: "Margaya-Owner-2026!" };
const DEMO_PASSWORD = "Margaya-Press-Demo-2026!";

/** Signs a demo account in with plain fetch and returns its cookie header. */
async function demoCookie(email) {
  const response = await fetch(`${API}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: CLIENT },
    body: JSON.stringify({ email, password: DEMO_PASSWORD }),
  });
  if (!response.ok) throw new Error(`Sign-in ${email}: ${response.status}`);
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** Fictional answers on the 5-face scale: [account, kind, score, comment?]. */
const FEEDBACK = [
  ["press", "survey", 5, "The board is fast even with a few hundred tasks."],
  ["press", "general", 4, null],
  ["priya.raman", "survey", 4, "Cycles are great. I'd like a burndown chart."],
  ["priya.raman", "general", 5, null],
  ["jonas.weber", "survey", 3, "Search sometimes misses older tasks."],
  ["jonas.weber", "general", 4, null],
  ["theo.okafor", "survey", 5, null],
  ["theo.okafor", "general", 2, "Notifications on my phone arrive late."],
  [
    "sofia.duarte",
    "survey",
    4,
    "Love the page editor. Tables are a bit fiddly.",
  ],
  ["sofia.duarte", "general", 5, null],
];

/**
 * Turns the survey on and files the fictional answers above, once. Admin
 * changes need a recent sign-in, so the owner confirms the password first.
 */
async function ensureFeedbackDemo(page) {
  const request = page.context().request;
  const headers = { Origin: CLIENT };
  await request.post(`${API}/api/instance-admin/reauth`, {
    data: { password: OWNER.password },
    headers,
  });
  const saved = await request.patch(`${API}/api/instance-admin/settings`, {
    data: { values: { "feedback.survey.enabled": true } },
    headers,
  });
  if (!saved.ok()) throw new Error(`Survey setting: ${saved.status()}`);
  const existing = await request.get(
    `${API}/api/instance-admin/feedback?limit=100`,
  );
  // Each answer is filed once, matched by person, kind and score.
  const filed = ((await existing.json()).items ?? []).map(
    (item) => `${item.user.email}|${item.kind}|${item.score}`,
  );
  const cookies = {};
  for (const [account, kind, score, comment] of FEEDBACK) {
    const email = `${account}@margaya.test`;
    if (filed.includes(`${email}|${kind}|${score}`)) continue;
    cookies[email] ??= await demoCookie(email);
    const response = await fetch(`${API}/api/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: CLIENT,
        Cookie: cookies[email],
      },
      body: JSON.stringify({
        kind,
        format: "faces5",
        score,
        ...(comment ? { comment } : {}),
        pageType: kind === "survey" ? "board" : "home",
        client: "web",
      }),
    });
    if (!response.ok) {
      throw new Error(`Feedback from ${email}: ${response.status}`);
    }
  }
}

/**
 * A connected Slack app, answered in the browser: connecting a real one
 * needs live Slack tokens. The setup part is the server's own, with a public
 * host so the localhost link-preview warning stays out of the picture.
 */
function mockSlackApp(page, seed) {
  return page.route(
    (url) => url.pathname === `/api/slack-app/workspace/${seed.workspace.id}`,
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: {
          connection: {
            id: "docs-shot-slack-app",
            workspaceId: seed.workspace.id,
            mode: "socket",
            teamId: "T0DOCSSHOT",
            teamName: "Studio North",
            botUserId: "U0DOCSBOT",
            botTokenConfigured: true,
            maskedBotToken: "xoxb-…k2Qf",
            appTokenConfigured: true,
            maskedAppToken: "xapp-…7RtA",
            signingSecretConfigured: false,
            maskedSigningSecret: "",
            credentialsReadable: true,
            defaultProjectId: seed.projects.web.id,
            expandTaskKeys: true,
            isActive: true,
            lastConnectedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
            lastError: null,
            createdAt: "2026-10-02T09:00:00.000Z",
            updatedAt: "2026-10-02T09:00:00.000Z",
          },
          setup: {
            ...body.setup,
            eventsUrl:
              "https://margaya.studionorth.example/api/slack-app/events",
            unfurlDomain: "margaya.studionorth.example",
          },
        },
      });
    },
  );
}

/** The link prompt /margaya link opens, answered in the browser. */
async function mockSlackLink(page, seed) {
  await page.route(
    (url) => url.pathname === "/api/slack-app/links/preview",
    (route) =>
      route.fulfill({
        status: 200,
        json: {
          workspaceId: seed.workspace.id,
          workspaceName: "Studio North",
          teamName: "Studio North",
          slackUserName: "elena.marsh",
          linkedToYou: false,
          linkedToSomeoneElse: false,
        },
      }),
  );
  await mockGet(page, "/slack-app/links", []);
}

const shots = [
  // ---------------------------------------------------------------- admin
  {
    name: "admin/general",
    account: "owner",
    url: instance("general"),
    ready: "Instance name",
    viewport: tall,
    // The capture server's own failures pile up from every seeded webhook,
    // so the list shows two typical ones instead.
    before: (page) => {
      const failedAt = new Date(Date.now() - 3 * 3_600_000).toISOString();
      const failure = (id, webhookName) => ({
        id,
        workspaceName: "Studio North",
        webhookName,
        event: "task.created",
        error: "Timed out after 10 seconds",
        responseStatus: null,
        attemptCount: 5,
        failedAt,
      });
      return mockGet(page, "/instance-admin/delivery-failures", {
        items: [
          failure("docs-shot-failure-1", "Support desk sync"),
          failure("docs-shot-failure-2", "Release notifier"),
        ],
      });
    },
    clip: { selector: "[data-slot=settings-page]" },
  },
  {
    name: "admin/sign-up",
    account: "owner",
    url: instance("authentication"),
    ready: "Anyone can sign up",
    clip: { selector: section("Sign-up"), pad: 16 },
  },
  {
    name: "admin/sign-in-methods",
    account: "owner",
    url: instance("authentication"),
    ready: "Email and password",
    viewport: tall,
    clip: { selector: section("Sign-in methods"), pad: 16 },
  },
  {
    name: "admin/sign-in-policy",
    account: "owner",
    url: instance("authentication"),
    ready: "Allowed email domains",
    viewport: { width: 1440, height: 1800 },
    clip: { selector: section("Sign-in policy"), pad: 16 },
  },
  {
    name: "admin/saml-connect",
    account: "owner",
    url: instance("authentication"),
    ready: "Company sign-in (SAML)",
    // Just tall enough for the form, so the sheet has no empty space.
    viewport: { width: 1440, height: 920 },
    before: (page) =>
      mockGet(page, "/instance-admin/identity/saml/new", {
        key: "examplekey01",
        acsUrl:
          "https://margaya.example.com/api/auth/sso/saml2/sp/acs/saml_examplekey01",
        entityId:
          "https://margaya.example.com/api/auth/sso/saml2/sp/metadata?providerId=saml_examplekey01",
      }),
    // Filled for the picture and never submitted; the certificate stays empty.
    prepare: async (page) => {
      await page
        .locator(section("Company sign-in (SAML)"))
        .getByRole("button", { name: "Connect provider" })
        .click();
      const sheet = page.locator("[role=dialog]");
      await sheet.waitFor({ state: "visible" });
      await sheet.getByLabel("Name", { exact: true }).fill("Company directory");
      await sheet.getByLabel("Email domains").fill("studionorth.example");
      await sheet
        .getByLabel("Identity provider entity ID (issuer)")
        .fill("https://id.studionorth.example/saml");
      await sheet
        .getByLabel("Single sign-on URL")
        .fill("https://id.studionorth.example/sso");
    },
    clip: { selector: "[role=dialog]" },
  },
  {
    name: "admin/scim-connections",
    account: "owner",
    url: instance("authentication"),
    ready: "Provisioning (SCIM)",
    // The last section of a long page.
    viewport: { width: 1440, height: 2600 },
    before: (page, seed) =>
      mockGet(page, "/instance-admin/identity/scim", {
        baseUrl: "https://margaya.example.com/api/auth/scim/v2",
        items: [
          {
            id: "docs-scim-connection",
            name: "Company directory",
            workspaceId: seed.workspace.id,
            workspaceName: "Studio North",
            provisionedUsers: 12,
            createdAt: "2026-01-15T09:00:00.000Z",
            updatedAt: "2026-01-15T09:00:00.000Z",
          },
        ],
      }),
    clip: { selector: section("Provisioning (SCIM)"), pad: 16 },
  },
  {
    name: "admin/oauth-github",
    account: "owner",
    url: instance("authentication"),
    ready: "Email and password",
    // A short viewport keeps the sheet free of empty space.
    viewport: { width: 1440, height: 520 },
    prepare: (page) => configureProvider(page, 0),
    clip: { selector: "[role=dialog]" },
  },
  {
    name: "admin/oauth-google",
    account: "owner",
    url: instance("authentication"),
    ready: "Email and password",
    // A short viewport keeps the sheet free of empty space.
    viewport: { width: 1440, height: 520 },
    prepare: (page) => configureProvider(page, 1),
    clip: { selector: "[role=dialog]" },
  },
  {
    name: "admin/oauth-discord",
    account: "owner",
    url: instance("authentication"),
    ready: "Email and password",
    // A short viewport keeps the sheet free of empty space.
    viewport: { width: 1440, height: 520 },
    prepare: (page) => configureProvider(page, 2),
    clip: { selector: "[role=dialog]" },
  },
  {
    name: "admin/oauth-custom",
    account: "owner",
    url: instance("authentication"),
    ready: "Email and password",
    viewport: { width: 1440, height: 1080 },
    prepare: (page) => configureProvider(page, 3),
    clip: { selector: "[role=dialog]" },
  },
  {
    name: "admin/email",
    account: "owner",
    url: instance("email"),
    ready: "SMTP server",
    viewport: tall,
    clip: { selector: "[data-slot=settings-page]" },
  },
  {
    name: "admin/workspaces",
    account: "owner",
    url: instance("workspaces"),
    ready: "All workspaces",
    prepare: hideOutsiders,
    clip: { selector: "[data-slot=settings-page]" },
  },
  {
    name: "admin/public-boards",
    account: "owner",
    url: instance("public-boards"),
    ready: "Published boards",
    clip: { selector: "[data-slot=settings-page]" },
  },
  {
    name: "admin/users",
    account: "owner",
    url: instance("users"),
    ready: "Jonas Weber",
    viewport: tall,
    prepare: async (page) => {
      await hideOutsiders(page);
      await page
        .getByRole("button", { name: "Actions for Jonas Weber" })
        .click();
      await page.getByRole("menu").waitFor({ state: "visible" });
    },
    keepPointer: true,
    clip: { selector: "[data-slot=settings-page]" },
  },
  {
    name: "admin/admins",
    account: "owner",
    url: instance("admins"),
    ready: "Audit trail",
    prepare: hideOutsiders,
    clip: { selector: "[data-slot=settings-page]" },
  },
  {
    name: "admin/health",
    account: "owner",
    url: instance("health"),
    ready: "Database migrations",
    viewport: tall,
    // Summary, Services and the Update notice; the queue counts, jobs and
    // failures below only describe this capture server.
    prepare: async (page) => {
      await page.getByText("Answering.").first().waitFor();
      await markPageThrough(page, "Update notice");
    },
    clip: { selector: "#docs-shot-clip" },
  },
  {
    name: "feedback/admin-feedback",
    account: "owner",
    url: instance("feedback"),
    ready: "Occasional survey",
    viewport: { width: 1440, height: 1700 },
    // The survey is turned on and the answers filed before the page loads.
    before: ensureFeedbackDemo,
    prepare: async (page) => {
      await page.getByText("Search sometimes misses older tasks.").waitFor();
    },
    clip: { selector: "[data-slot=settings-page]" },
  },

  // ---------------------------------------------------- first sign-up
  {
    name: "install/sign-up",
    url: "/auth/sign-up",
    prepare: async (page) => {
      await page.context().clearCookies();
      await goto(page, "/auth/sign-up", "Full name");
    },
    clip: { x: 815, y: 170, width: 470, height: 560 },
  },

  // ------------------------------------------------- project integrations
  {
    name: "integrations/overview",
    url: integrations,
    ready: "GitHub integration",
    clip: { selector: "[data-slot=settings-page]" },
  },
  {
    name: "integrations/github",
    url: integrations,
    ready: "GitHub integration",
    prepare: async (page) => {
      await openIntegration(page, "GitHub integration");
      await fill(page, "GitHub integration", 0, "studio-north");
      await fill(page, "GitHub integration", 1, "website");
    },
    clip: { selector: integration("GitHub integration"), pad: 8 },
  },
  {
    name: "integrations/gitea",
    url: integrations,
    ready: "Gitea integration",
    prepare: async (page) => {
      await openIntegration(page, "Gitea integration");
      await fill(
        page,
        "Gitea integration",
        0,
        "https://git.studionorth.example",
      );
      await fill(page, "Gitea integration", 2, "studio-north");
      await fill(page, "Gitea integration", 3, "website");
    },
    clip: { selector: integration("Gitea integration"), pad: 8 },
  },
  {
    name: "integrations/discord",
    url: integrations,
    ready: "Discord integration",
    viewport: tall,
    prepare: async (page) => {
      await openIntegration(page, "Discord integration");
      await fill(
        page,
        "Discord integration",
        0,
        "https://discord.com/api/webhooks/000000000000000000/xxxxxxxxxxxxxxxx",
      );
      await fill(page, "Discord integration", 1, "#web-releases");
    },
    clip: { selector: integration("Discord integration"), pad: 8 },
  },
  {
    name: "integrations/slack",
    url: integrations,
    ready: "Slack integration",
    viewport: tall,
    prepare: async (page) => {
      await openIntegration(page, "Slack integration");
      await fill(
        page,
        "Slack integration",
        0,
        "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXX",
      );
      await fill(page, "Slack integration", 1, "#web-releases");
    },
    clip: { selector: integration("Slack integration"), pad: 8 },
  },
  {
    name: "integrations/slack-app",
    url: "/dashboard/settings/workspace/slack",
    ready: "Slack app on",
    before: mockSlackApp,
    viewport: { width: 1440, height: 2000 },
    prepare: async (page) => {
      // The manifest box is resizable; a short one keeps all four steps in
      // the picture.
      await page
        .getByLabel("Slack app manifest")
        .evaluate((box) => Object.assign(box.style, { height: "9rem" }));
      await markPageThrough(page, "Set up");
    },
    clip: { selector: "#docs-shot-clip" },
  },
  {
    name: "integrations/slack-app-link",
    url: "/dashboard/settings/account/slack?link=docs-shot-link",
    ready: "Link your Slack account",
    before: mockSlackLink,
    clip: { selector: "[data-slot=settings-page]" },
  },
  {
    name: "integrations/mattermost",
    url: integrations,
    ready: "Mattermost integration",
    viewport: tall,
    prepare: async (page) => {
      await openIntegration(page, "Mattermost integration");
      await fill(
        page,
        "Mattermost integration",
        0,
        "https://chat.studionorth.example/hooks/xxxxxxxxxxxxxxxxxxxxxxxxxx",
      );
      await fill(page, "Mattermost integration", 1, "web-releases");
    },
    clip: { selector: integration("Mattermost integration"), pad: 8 },
  },
  {
    name: "integrations/telegram",
    url: integrations,
    ready: "Telegram integration",
    viewport: { width: 1440, height: 1500 },
    prepare: async (page) => {
      await openIntegration(page, "Telegram integration");
      await fill(page, "Telegram integration", 1, "-1001234567890");
      await fill(page, "Telegram integration", 3, "Web releases");
      await markConnectionCard(
        page,
        "Telegram integration",
        "Telegram bot connection",
      );
    },
    clip: { selector: "#docs-shot-clip" },
  },
  {
    name: "integrations/generic-webhook",
    url: integrations,
    ready: "Generic webhooks",
    viewport: { width: 1440, height: 1500 },
    prepare: async (page) => {
      await openIntegration(page, "Generic webhooks");
      await fill(
        page,
        "Generic webhooks",
        0,
        "https://hooks.studionorth.example/margaya",
      );
      await markConnectionCard(
        page,
        "Generic webhooks",
        "Outgoing webhook connection",
      );
    },
    clip: { selector: "#docs-shot-clip" },
  },

  // ------------------------------------------------------------------ MCP
  {
    name: "mcp/consent",
    url: "/dashboard/settings/account/developer",
    ready: "Create API key",
    prepare: async (page) => {
      await goto(page, await mcpConsentUrl(page), "Cursor");
      // The card from its title to the buttons; its height depends on how
      // many warnings it shows.
      await page.getByRole("button", { name: "Deny" }).evaluate((deny) => {
        let card = deny.parentElement;
        while (
          card &&
          !card.textContent?.includes("Review this request before granting")
        ) {
          card = card.parentElement;
        }
        card?.setAttribute("data-docs-shot", "");
      });
    },
    viewport: { width: 1440, height: 1100 },
    clip: { selector: "[data-docs-shot]", pad: 24 },
  },
  {
    name: "mcp/device-approve",
    url: "/dashboard/settings/account/developer",
    ready: "Create API key",
    prepare: async (page) => {
      const code = await mcpDeviceCode(page);
      await goto(
        page,
        `/device/approve?user_code=${encodeURIComponent(code)}`,
        "Approve",
      );
    },
    clip: { x: 815, y: 340, width: 470, height: 225 },
  },
  {
    name: "mcp/create-api-key",
    url: "/dashboard/settings/account/developer",
    ready: "Create API key",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Create API key" }).click();
      const dialog = page.locator("[role=dialog]");
      await dialog.waitFor({ state: "visible" });
      await dialog.locator("input").first().fill("Cursor MCP");
    },
    clip: { selector: "[role=dialog]" },
  },
];

// The docs use light-mode screenshots only.
export default shots.map((shot) => ({ themes: ["light"], ...shot }));

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkCsrf, csrfGuard } from "../../../apps/api/src/utils/csrf-guard";

const COOKIE = "better-auth.session_token=abc.def";
const SECURE_COOKIE = "__Secure-better-auth.session_token=abc.def";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("MARGAYA_CLIENT_URL", "https://app.example.com");
  vi.stubEnv("MARGAYA_API_URL", "https://api.example.com");
  vi.stubEnv(
    "CORS_ORIGINS",
    "https://extra.example.com, https://other.example.com",
  );
});

afterEach(() => vi.unstubAllEnvs());

function verdict(
  headers: Record<string, string>,
  method = "POST",
  path = "/api/project",
) {
  return checkCsrf(method, path, new Headers(headers)).ok;
}

describe("checkCsrf", () => {
  it("allows the web app, the API itself and every CORS_ORIGINS entry", () => {
    for (const origin of [
      "https://app.example.com",
      "https://api.example.com",
      "https://extra.example.com",
      "https://other.example.com",
    ]) {
      expect(verdict({ cookie: COOKIE, origin })).toBe(true);
    }
  });

  it("refuses a foreign or null origin on a cookie-authenticated write", () => {
    expect(
      verdict({ cookie: COOKIE, origin: "https://attacker.example" }),
    ).toBe(false);
    expect(verdict({ cookie: SECURE_COOKIE, origin: "null" })).toBe(false);
    // Same host, other scheme or port is another origin.
    expect(verdict({ cookie: COOKIE, origin: "http://app.example.com" })).toBe(
      false,
    );
  });

  it("checks every state-changing method, never safe ones", () => {
    const foreign = { cookie: COOKIE, origin: "https://attacker.example" };
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(verdict(foreign, method)).toBe(false);
    }
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(verdict(foreign, method)).toBe(true);
    }
  });

  it("falls back to the Referer when there is no Origin", () => {
    expect(
      verdict({ cookie: COOKIE, referer: "https://app.example.com/dashboard" }),
    ).toBe(true);
    expect(
      verdict({ cookie: COOKIE, referer: "https://attacker.example/form" }),
    ).toBe(false);
  });

  it("with a cookie but no Origin, refuses a browser that says cross-site", () => {
    expect(verdict({ cookie: COOKIE, "sec-fetch-site": "cross-site" })).toBe(
      false,
    );
    expect(verdict({ cookie: COOKIE, "sec-fetch-site": "same-site" })).toBe(
      false,
    );
    expect(verdict({ cookie: COOKIE, "sec-fetch-site": "same-origin" })).toBe(
      true,
    );
  });

  it("with a cookie and no browser headers at all, lets a script through", () => {
    expect(verdict({ cookie: COOKIE })).toBe(true);
  });

  it("ignores requests without a session cookie", () => {
    expect(verdict({ origin: "https://attacker.example" })).toBe(true);
    expect(
      verdict({ cookie: "theme=dark", origin: "https://attacker.example" }),
    ).toBe(true);
  });

  it("exempts API-key and Bearer callers, which carry no ambient credential", () => {
    const foreign = { cookie: COOKIE, origin: "https://attacker.example" };
    expect(verdict({ ...foreign, "x-api-key": "margaya_key" })).toBe(true);
    expect(verdict({ ...foreign, authorization: "Bearer token-123" })).toBe(
      true,
    );
    // A malformed Authorization header is no exemption.
    expect(verdict({ ...foreign, authorization: "Basic abc" })).toBe(false);
  });

  it("leaves OAuth callbacks, MCP and signed webhooks to their own checks", () => {
    const foreign = { cookie: COOKIE, origin: "https://attacker.example" };
    for (const path of [
      "/api/auth/callback/github",
      "/api/auth/oauth2/callback/custom",
      "/api/mcp",
      "/api/mcp/token",
      "/api/.well-known/oauth-authorization-server/api",
      "/api/github-integration/webhook",
      "/api/gitea-integration/webhook/integration-1",
      "/api/billing/webhook",
    ]) {
      expect(verdict(foreign, "POST", path)).toBe(true);
    }
    // Other GitHub integration routes are ordinary cookie writes, and so
    // are Better Auth's account routes.
    expect(verdict(foreign, "POST", "/api/github-integration/connect")).toBe(
      false,
    );
    expect(verdict(foreign, "POST", "/api/auth/change-password")).toBe(false);
  });
});

describe("csrfGuard middleware", () => {
  function app() {
    const hono = new Hono();
    hono.use("/api/*", csrfGuard());
    hono.post("/api/thing", (c) => c.json({ ok: true }));
    return hono;
  }

  it("answers 403 to a forged write and passes a trusted one", async () => {
    const forged = await app().request("/api/thing", {
      method: "POST",
      headers: { cookie: COOKIE, origin: "https://attacker.example" },
    });
    expect(forged.status).toBe(403);
    expect(await forged.text()).toContain("Cross-site request refused");

    const trusted = await app().request("/api/thing", {
      method: "POST",
      headers: { cookie: COOKIE, origin: "https://app.example.com" },
    });
    expect(trusted.status).toBe(200);
  });
});

describe("development defaults", () => {
  it("trusts the local web and API ports when no URLs are configured", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("MARGAYA_CLIENT_URL", "");
    vi.stubEnv("MARGAYA_API_URL", "");
    vi.stubEnv("CORS_ORIGINS", "");
    expect(verdict({ cookie: COOKIE, origin: "http://localhost:5173" })).toBe(
      true,
    );
    expect(
      verdict({ cookie: COOKIE, origin: "https://attacker.example" }),
    ).toBe(false);
  });
});

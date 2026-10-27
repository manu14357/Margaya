import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { securityHeaders } from "../../../apps/api/src/utils/security-headers";

afterEach(() => vi.unstubAllEnvs());

function app() {
  const hono = new Hono();
  hono.use("*", securityHeaders());
  hono.get("/api/thing", (c) => c.json({ ok: true }));
  hono.get("/api/broken", () => {
    throw new Error("boom");
  });
  hono.onError((_error, c) => c.json({ message: "failed" }, 500));
  return hono;
}

describe("securityHeaders", () => {
  it("forbids framing and content on API responses", async () => {
    vi.stubEnv("MARGAYA_API_URL", "http://localhost:1337");
    const response = await app().request("/api/thing");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("sends HSTS only when the API is served over HTTPS", async () => {
    vi.stubEnv("MARGAYA_API_URL", "http://localhost:1337");
    const plain = await app().request("/api/thing");
    expect(plain.headers.get("strict-transport-security")).toBeNull();

    vi.stubEnv("MARGAYA_API_URL", "https://api.example.com");
    const secure = await app().request("/api/thing");
    expect(secure.headers.get("strict-transport-security")).toBe(
      "max-age=15552000",
    );
  });

  it("covers error responses too", async () => {
    const response = await app().request("/api/broken");
    expect(response.status).toBe(500);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });
});

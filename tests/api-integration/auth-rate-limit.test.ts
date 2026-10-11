import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { authPost, resetInstanceState } from "./helpers/instance-admin";

// Better Auth reads the switch when the auth module loads, and the
// integration setup turns it off; turn it back on for this file only.
vi.hoisted(() => {
  process.env.AUTH_RATE_LIMIT_ENABLED = "true";
});

beforeEach(async () => {
  await resetInstanceState();
});

describe("auth rate limiting (on by default)", () => {
  it("answers 429 to a burst of password sign-ins from one client", async () => {
    const { app } = createApp();
    // The Node transport sets the client IP; app.request() has none, so
    // every attempt here lands in Better Auth's shared bucket.
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await authPost(app, "/sign-in/email", {
        email: "burst@example.com",
        password: "wrong password every time",
      });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it("does not limit reading the session", async () => {
    const { app } = createApp();
    for (let attempt = 0; attempt < 110; attempt++) {
      const response = await app.request("/api/auth/get-session");
      expect(response.status).toBe(200);
    }
  });
});

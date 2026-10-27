import { expect, test } from "../../fixtures";
import {
  createApiKey,
  createWorld,
  expectJson,
  expectStatus,
  headerContext,
  signUpUser,
  type World,
} from "../../helpers/api-kit";
import { E2E_API_URL, E2E_WEB_URL } from "../../helpers/env";
import { createApiContext } from "../../helpers/http";
import { covers } from "../../helpers/openapi";

// Time zones (user and workspace), member profiles and the account's
// sessions.

// Only the time zone is checked here; the settings carry other workspace
// switches too.
type Settings = { timezone: string };
type UserTimezone = { timezone: string | null };
type MemberProfile = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  joinedAt: string;
};
type Security = {
  hasPassword: boolean;
  sessions: { id: string; current: boolean; userAgent: string | null }[];
};

let world: World;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  world = await createWorld("Settings");
});

test.afterAll(async () => {
  await world?.dispose();
});

test(
  "the workspace time zone is read by members and set by the owner",
  covers("getWorkspaceSettings", "updateWorkspaceSettings"),
  async () => {
    const path = `/api/workspace/${world.workspace.id}/settings`;
    expect(
      await expectJson<Settings>(await world.as("viewer").get(path)),
    ).toMatchObject({ timezone: "UTC" });

    await expectStatus(
      await world.as("member").patch(path, {
        data: { timezone: "Europe/Berlin" },
      }),
      403,
    );
    await expectStatus(
      await world.as("owner").patch(path, { data: { timezone: "+02:00" } }),
      400,
    );
    expect(
      await expectJson<Settings>(
        await world.as("owner").patch(path, {
          data: { timezone: "Europe/Berlin" },
        }),
      ),
    ).toMatchObject({ timezone: "Europe/Berlin" });
    expect(
      await expectJson<Settings>(await world.as("member").get(path)),
    ).toMatchObject({ timezone: "Europe/Berlin" });

    // And back.
    expect(
      await expectJson<Settings>(
        await world.as("owner").patch(path, { data: { timezone: "UTC" } }),
      ),
    ).toMatchObject({ timezone: "UTC" });
    await expectStatus(await world.anonymous.get(path), 401);
  },
);

test(
  "a member's profile header is visible to other members only",
  covers("getWorkspaceMember"),
  async () => {
    const member = world.users.member;
    const base = `/api/workspace/${world.workspace.id}/members`;
    const profile = await expectJson<MemberProfile>(
      await world.as("viewer").get(`${base}/${member.id}`),
    );
    expect(profile).toMatchObject({
      id: member.id,
      name: member.name,
      email: member.email,
      role: "member",
    });
    expect(Number.isNaN(Date.parse(profile.joinedAt))).toBe(false);

    const outsider = await signUpUser("Profile outsider");
    try {
      await expectStatus(
        await world.as("viewer").get(`${base}/${outsider.id}`),
        404,
      );
      await expectStatus(await outsider.ctx.get(`${base}/${member.id}`), 403);
    } finally {
      await outsider.ctx.dispose();
    }
  },
);

test(
  "a user stores, changes and clears their time zone",
  covers("getUserTimezone", "updateUserTimezone"),
  async () => {
    const user = world.as("member");
    expect(
      await expectJson<UserTimezone>(await user.get("/api/user/timezone")),
    ).toEqual({ timezone: null });

    expect(
      await expectJson<UserTimezone>(
        await user.put("/api/user/timezone", {
          data: { timezone: "America/New_York" },
        }),
      ),
    ).toEqual({ timezone: "America/New_York" });
    expect(
      await expectJson<UserTimezone>(await user.get("/api/user/timezone")),
    ).toEqual({ timezone: "America/New_York" });

    await expectStatus(
      await user.put("/api/user/timezone", { data: { timezone: "+05:00" } }),
      400,
    );
    await expectStatus(
      await user.put("/api/user/timezone", {
        data: { timezone: "Not/AZone" },
      }),
      400,
    );

    expect(
      await expectJson<UserTimezone>(
        await user.put("/api/user/timezone", { data: { timezone: null } }),
      ),
    ).toEqual({ timezone: null });
    await expectStatus(await world.anonymous.get("/api/user/timezone"), 401);
  },
);

test(
  "the account lists its sessions and signs out another one",
  covers("getAccountSecurity", "revokeUserSession"),
  async () => {
    const user = world.users.viewer;
    // A second session for the same account, as from another device.
    const other = await createApiContext({
      apiURL: E2E_API_URL,
      clientURL: E2E_WEB_URL,
    });
    try {
      await expectJson(
        await other.post("/api/auth/sign-in/email", {
          data: { email: user.email, password: user.password },
        }),
      );

      const security = await expectJson<Security>(
        await user.ctx.get("/api/user/security"),
      );
      expect(security.hasPassword).toBe(true);
      // Session tokens are never listed.
      expect(JSON.stringify(security)).not.toContain(user.token);
      const current = security.sessions.filter((session) => session.current);
      expect(current).toHaveLength(1);
      const fromOther = await expectJson<Security>(
        await other.get("/api/user/security"),
      );
      const otherId = fromOther.sessions.find((session) => session.current)?.id;
      expect(otherId).toBeTruthy();
      expect(security.sessions.map((session) => session.id)).toContain(otherId);

      // The current session ends by signing out, not through this route.
      await expectStatus(
        await user.ctx.delete(`/api/user/sessions/${current[0]?.id}`),
        400,
      );
      await expectStatus(
        await user.ctx.delete("/api/user/sessions/e2e-unknown-session"),
        404,
      );
      // Another account's session is not found for this user.
      await expectStatus(
        await world.as("member").delete(`/api/user/sessions/${otherId}`),
        404,
      );

      expect(
        await expectJson<{ revoked: boolean }>(
          await user.ctx.delete(`/api/user/sessions/${otherId}`),
        ),
      ).toEqual({ revoked: true });
      await expectStatus(await other.get("/api/user/security"), 401);
      const remaining = await expectJson<Security>(
        await user.ctx.get("/api/user/security"),
      );
      expect(remaining.sessions.map((session) => session.id)).not.toContain(
        otherId,
      );
    } finally {
      await other.dispose();
    }

    // API keys can neither read nor end sessions.
    const key = await createApiKey(world.as("owner"));
    const viaKey = await headerContext({ "x-api-key": key.key });
    try {
      await expectStatus(await viaKey.get("/api/user/security"), 403);
    } finally {
      await viaKey.dispose();
    }
  },
);

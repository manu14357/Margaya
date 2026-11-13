import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db from "../../apps/api/src/database";
import * as schema from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { resetRateLimitMemory } from "../../apps/api/src/utils/rate-limit";
import {
  adminRequest,
  resetInstanceState,
  signUpWithSession,
} from "./helpers/instance-admin";

type App = ReturnType<typeof createApp>["app"];

let app: App;
let admin: { cookie: string; user: { id: string } };
let member: { cookie: string; user: { id: string } };

beforeEach(async () => {
  await resetInstanceState();
  resetRateLimitMemory();
  app = createApp().app;
  // The first account on an empty instance is the instance admin.
  admin = await signUpWithSession(app, "admin@example.com");
  member = await signUpWithSession(app, "member@example.com");
});

function request(method: string, path: string, cookie: string, body?: unknown) {
  return app.request(`/api/feedback${path}`, {
    method,
    headers: {
      cookie,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function saveSettings(values: Record<string, unknown>) {
  const response = await adminRequest(app, "PATCH", "/settings", admin.cookie, {
    values,
  });
  expect(response.status).toBe(200);
}

async function ageAccount(userId: string, days: number) {
  await db
    .update(schema.userTable)
    .set({ createdAt: new Date(Date.now() - days * 24 * 60 * 60 * 1000) })
    .where(eq(schema.userTable.id, userId));
}

describe("Send feedback", () => {
  it("stores coarse context and lets only instance admins read it", async () => {
    const sent = await request("POST", "", member.cookie, {
      kind: "general",
      format: "faces5",
      score: 4,
      comment: "Boards are quick",
      pageType: "board",
      appVersion: "1.2.3",
      client: "web",
    });
    expect(sent.status).toBe(200);

    expect(
      (await adminRequest(app, "GET", "/feedback", member.cookie)).status,
    ).toBe(403);

    const list = await adminRequest(app, "GET", "/feedback", admin.cookie);
    expect(list.status).toBe(200);
    const page = (await list.json()) as {
      items: { comment: string; pageType: string; user: { email: string } }[];
    };
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      comment: "Boards are quick",
      pageType: "board",
      user: { email: "member@example.com" },
    });

    const summary = await adminRequest(
      app,
      "GET",
      "/feedback/summary?format=faces5",
      admin.cookie,
    );
    expect(await summary.json()).toMatchObject({
      count: 1,
      average: 4,
      satisfaction: 100,
      comments: 1,
      byKind: { general: 1, survey: 0, feature: 0 },
    });

    const csv = await adminRequest(
      app,
      "GET",
      "/feedback/export",
      admin.cookie,
    );
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain("Boards are quick");
  });

  it("refuses a score outside the scale and answers 409 when turned off", async () => {
    expect(
      (
        await request("POST", "", member.cookie, {
          kind: "general",
          format: "faces3",
          score: 5,
        })
      ).status,
    ).toBe(400);

    await saveSettings({ "feedback.enabled": false });
    expect(
      (
        await request("POST", "", member.cookie, {
          kind: "general",
          format: "faces5",
          score: 3,
        })
      ).status,
    ).toBe(409);
    const config = await request("GET", "/config", member.cookie);
    expect(await config.json()).toMatchObject({ enabled: false });
  });

  it("lets people copy and delete their own feedback", async () => {
    await request("POST", "", member.cookie, {
      kind: "general",
      format: "faces5",
      comment: "Hello",
    });
    const mine = await request("GET", "/mine", member.cookie);
    expect(((await mine.json()) as { items: unknown[] }).items).toHaveLength(1);

    const deleted = await request("DELETE", "/mine", member.cookie);
    expect(await deleted.json()).toEqual({ deleted: 1 });
    const after = await adminRequest(app, "GET", "/feedback", admin.cookie);
    expect(((await after.json()) as { items: unknown[] }).items).toHaveLength(
      0,
    );
  });

  it("goes with the account when it is deleted", async () => {
    await request("POST", "", member.cookie, {
      kind: "general",
      format: "faces5",
      score: 2,
    });
    await db
      .delete(schema.userTable)
      .where(eq(schema.userTable.id, member.user.id));
    const rows = await db.select().from(schema.feedbackTable);
    expect(rows).toHaveLength(0);
  });

  it("lets an admin delete one answer or old ones", async () => {
    await request("POST", "", member.cookie, {
      kind: "general",
      format: "faces5",
      score: 5,
    });
    const [row] = await db.select().from(schema.feedbackTable);
    const removed = await adminRequest(
      app,
      "DELETE",
      `/feedback/${row?.id}`,
      admin.cookie,
    );
    expect(await removed.json()).toEqual({ deleted: 1 });
    expect(
      (await adminRequest(app, "DELETE", `/feedback/${row?.id}`, admin.cookie))
        .status,
    ).toBe(404);

    const purge = await adminRequest(
      app,
      "DELETE",
      "/feedback?olderThanDays=0",
      admin.cookie,
    );
    expect(await purge.json()).toEqual({ deleted: 0 });
  });
});

describe("the occasional survey", () => {
  it("never asks while it is off or in the first week", async () => {
    let check = await request("POST", "/survey/check", member.cookie);
    expect(await check.json()).toMatchObject({ show: false });

    await saveSettings({
      "feedback.survey.enabled": true,
      "feedback.survey.activeDays": 1,
    });
    check = await request("POST", "/survey/check", member.cookie);
    expect(await check.json()).toMatchObject({ show: false });
  });

  it("asks once a trigger is reached, then waits the interval", async () => {
    await saveSettings({
      "feedback.survey.enabled": true,
      "feedback.survey.format": "nps",
      "feedback.survey.activeDays": 1,
    });
    await ageAccount(member.user.id, 8);

    const first = await request("POST", "/survey/check", member.cookie);
    expect(await first.json()).toEqual({ show: true, format: "nps" });
    const second = await request("POST", "/survey/check", member.cookie);
    expect(await second.json()).toEqual({ show: false, format: "nps" });

    const answer = await request("POST", "", member.cookie, {
      kind: "survey",
      format: "nps",
      score: 9,
    });
    expect(answer.status).toBe(200);
  });

  it("snoozes on close and stops after Don't ask again", async () => {
    await saveSettings({
      "feedback.survey.enabled": true,
      "feedback.survey.activeDays": 1,
    });
    await ageAccount(member.user.id, 8);

    const snoozed = await request("POST", "/survey/dismiss", member.cookie);
    const state = (await snoozed.json()) as { snoozedUntil: string };
    expect(new Date(state.snoozedUntil).getTime()).toBeGreaterThan(Date.now());
    let check = await request("POST", "/survey/check", member.cookie);
    expect(await check.json()).toMatchObject({ show: false });

    await db
      .update(schema.feedbackSurveyStateTable)
      .set({ snoozedUntil: null })
      .where(eq(schema.feedbackSurveyStateTable.userId, member.user.id));
    await request("PUT", "/survey/preference", member.cookie, {
      optedOut: true,
    });
    check = await request("POST", "/survey/check", member.cookie);
    expect(await check.json()).toMatchObject({ show: false });
    const config = await request("GET", "/config", member.cookie);
    expect(await config.json()).toMatchObject({
      survey: { enabled: true, optedOut: true },
    });
  });
});

import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../../fixtures";
import {
  createApiKey,
  deleteApiKey,
  expectJson,
  expectStatus,
  headerContext,
  signUpUser,
  type TestUser,
} from "../../helpers/api-kit";
import { covers } from "../../helpers/openapi";
import { uniqueName } from "../../helpers/ui";
import { SEED_USERS } from "../../seed/data";

// Product feedback: what a signed-in person sends (ratings, comments, the
// occasional survey and its snooze / Don't ask again), their own copy and
// deletion, and what instance admins read, export and delete. Session only:
// API keys are refused. A fresh account sends everything, so the instance
// admins' list is searched by a marker unique to this run.

type FeedbackConfig = {
  enabled: boolean;
  survey: { enabled: boolean; format: string; optedOut: boolean };
};
type OwnFeedback = {
  id: string;
  kind: "general" | "survey" | "feature";
  format: string;
  score: number | null;
  comment: string | null;
  pageType: string | null;
  feature: string | null;
  appVersion: string | null;
  client: "web" | "desktop" | null;
  createdAt: string;
};
type AdminFeedback = OwnFeedback & {
  user: { id: string; name: string; email: string };
};
type AdminPage = { items: AdminFeedback[]; nextCursor: string | null };
type SurveyState = { optedOut: boolean; snoozedUntil: string | null };

const DAY_MS = 24 * 60 * 60 * 1000;
const marker = uniqueName("feedback-marker").replace(/\s+/g, "-");

let author: TestUser;
let bystander: TestUser;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  author = await signUpUser("Feedback author");
  bystander = await signUpUser("Feedback bystander");
});

test.afterAll(async () => {
  await author?.ctx.dispose();
  await bystander?.ctx.dispose();
});

async function confirmOwner(owner: APIRequestContext) {
  await expectJson(
    await owner.post("/api/instance-admin/reauth", {
      data: { password: SEED_USERS.owner.password },
    }),
  );
}

async function setSettings(
  owner: APIRequestContext,
  values: Record<string, unknown>,
) {
  await expectJson(
    await owner.patch("/api/instance-admin/settings", { data: { values } }),
  );
}

test(
  "a person reads availability; anonymous callers and API keys are refused",
  covers("getFeedbackConfig"),
  async ({ apiAs }) => {
    const config = await expectJson<FeedbackConfig>(
      await author.ctx.get("/api/feedback/config"),
    );
    // Send feedback is on by default, the survey is off by default.
    expect(config).toMatchObject({
      enabled: true,
      survey: { enabled: false, optedOut: false },
    });
    expect(["faces3", "faces5", "stars", "nps"]).toContain(
      config.survey.format,
    );

    const anonymous = await apiAs("anonymous");
    await expectStatus(await anonymous.get("/api/feedback/config"), 401);
    await expectStatus(
      await anonymous.post("/api/feedback", {
        data: { kind: "general", format: "faces5", score: 3 },
      }),
      401,
    );

    const key = await createApiKey(author.ctx);
    const viaKey = await headerContext({ "x-api-key": key.key });
    try {
      await expectStatus(await viaKey.get("/api/feedback/config"), 403);
      await expectStatus(
        await viaKey.post("/api/feedback", {
          data: { kind: "general", format: "faces5", score: 3 },
        }),
        403,
      );
      await expectStatus(await viaKey.get("/api/feedback/mine"), 403);
      await expectStatus(await viaKey.delete("/api/feedback/mine"), 403);
    } finally {
      await viaKey.dispose();
      await deleteApiKey(author.ctx, key.id);
    }
  },
);

test(
  "send a rating, a comment and a feature thumbs; invalid answers are refused",
  covers("submitFeedback", "listOwnFeedback"),
  async () => {
    const rated = await expectJson<{ id: string }>(
      await author.ctx.post("/api/feedback", {
        data: {
          kind: "general",
          format: "faces5",
          score: 4,
          comment: `${marker} rated`,
          pageType: "board",
          appVersion: "1.2.3-e2e",
          client: "web",
        },
      }),
    );
    expect(rated.id).toBeTruthy();
    const commentOnly = await expectJson<{ id: string }>(
      await author.ctx.post("/api/feedback", {
        data: {
          kind: "general",
          format: "stars",
          comment: `${marker} comment only`,
        },
      }),
    );
    const thumbs = await expectJson<{ id: string }>(
      await author.ctx.post("/api/feedback", {
        data: {
          kind: "feature",
          format: "thumbs",
          score: 1,
          feature: "cycles",
          comment: `${marker} thumbs`,
          client: "desktop",
        },
      }),
    );

    const invalid: Record<string, unknown>[] = [
      // Out of the scale's range.
      { kind: "general", format: "faces5", score: 6 },
      { kind: "general", format: "faces3", score: 0 },
      // Neither a score nor a comment.
      { kind: "general", format: "faces5" },
      // Thumbs only for features; features only with thumbs and a name.
      { kind: "general", format: "thumbs", score: 1 },
      { kind: "feature", format: "thumbs", score: 1 },
      { kind: "feature", format: "faces5", score: 3, feature: "cycles" },
      // A survey answer needs a score.
      { kind: "survey", format: "faces5", comment: "no score" },
      // Never ids or free-form context.
      { kind: "general", format: "faces5", score: 3, projectId: "x" },
      { kind: "general", format: "faces5", score: 3, pageType: "/p/WEB-1" },
      { kind: "general", format: "faces5", score: 3, appVersion: "1.0 beta" },
      { kind: "general", format: "faces5", comment: "x".repeat(1001) },
    ];
    for (const data of invalid) {
      await expectStatus(await author.ctx.post("/api/feedback", { data }), 400);
    }
    // The survey is off on this instance, so a survey answer conflicts.
    await expectStatus(
      await author.ctx.post("/api/feedback", {
        data: { kind: "survey", format: "faces5", score: 5 },
      }),
      409,
    );

    const mine = await expectJson<{ items: OwnFeedback[] }>(
      await author.ctx.get("/api/feedback/mine"),
    );
    expect(mine.items.map((item) => item.id)).toEqual([
      thumbs.id,
      commentOnly.id,
      rated.id,
    ]);
    expect(mine.items[0]).toMatchObject({
      kind: "feature",
      format: "thumbs",
      score: 1,
      feature: "cycles",
      client: "desktop",
      pageType: null,
    });
    expect(mine.items[1]).toMatchObject({
      kind: "general",
      format: "stars",
      score: null,
      comment: `${marker} comment only`,
    });
    expect(mine.items[2]).toMatchObject({
      score: 4,
      pageType: "board",
      appVersion: "1.2.3-e2e",
      client: "web",
    });

    // Nobody else sees them.
    const theirs = await expectJson<{ items: OwnFeedback[] }>(
      await bystander.ctx.get("/api/feedback/mine"),
    );
    expect(theirs.items).toEqual([]);
  },
);

test(
  "the survey: never asks a new account, closes for 30 days, Don't ask again",
  covers(
    "checkFeedbackSurvey",
    "snoozeFeedbackSurvey",
    "setFeedbackSurveyPreference",
  ),
  async () => {
    const check = await expectJson<{ show: boolean; format: string }>(
      await author.ctx.post("/api/feedback/survey/check"),
    );
    expect(check.show).toBe(false);
    expect(["faces3", "faces5", "stars", "nps"]).toContain(check.format);

    const before = Date.now();
    const snoozed = await expectJson<SurveyState>(
      await author.ctx.post("/api/feedback/survey/dismiss"),
    );
    expect(snoozed.optedOut).toBe(false);
    const until = new Date(snoozed.snoozedUntil ?? 0).getTime();
    expect(until).toBeGreaterThan(before + 29 * DAY_MS);
    expect(until).toBeLessThan(Date.now() + 31 * DAY_MS);

    const optedOut = await expectJson<SurveyState>(
      await author.ctx.put("/api/feedback/survey/preference", {
        data: { optedOut: true },
      }),
    );
    // The snooze is kept; the preference is separate.
    expect(optedOut).toEqual({
      optedOut: true,
      snoozedUntil: snoozed.snoozedUntil,
    });
    const config = await expectJson<FeedbackConfig>(
      await author.ctx.get("/api/feedback/config"),
    );
    expect(config.survey.optedOut).toBe(true);
    // Send feedback stays available.
    expect(config.enabled).toBe(true);

    const optedIn = await expectJson<SurveyState>(
      await author.ctx.put("/api/feedback/survey/preference", {
        data: { optedOut: false },
      }),
    );
    expect(optedIn.optedOut).toBe(false);
    expect(
      (
        await expectJson<FeedbackConfig>(
          await author.ctx.get("/api/feedback/config"),
        )
      ).survey.optedOut,
    ).toBe(false);
    // Another person's preference is their own.
    expect(
      (
        await expectJson<FeedbackConfig>(
          await bystander.ctx.get("/api/feedback/config"),
        )
      ).survey.optedOut,
    ).toBe(false);

    for (const data of [{}, { optedOut: "yes" }, { optedOut: true, x: 1 }]) {
      await expectStatus(
        await author.ctx.put("/api/feedback/survey/preference", { data }),
        400,
      );
    }
  },
);

test(
  "instance switches: the survey on takes answers; feedback off refuses them",
  covers("getFeedbackConfig", "submitFeedback", "checkFeedbackSurvey"),
  async ({ apiAs }) => {
    const owner = await apiAs("owner");
    await confirmOwner(owner);
    try {
      await setSettings(owner, { "feedback.survey.enabled": true });
      const on = await expectJson<FeedbackConfig>(
        await author.ctx.get("/api/feedback/config"),
      );
      expect(on.survey.enabled).toBe(true);
      const answer = await expectJson<{ id: string }>(
        await author.ctx.post("/api/feedback", {
          data: {
            kind: "survey",
            format: on.survey.format,
            score: on.survey.format === "faces3" ? 3 : 5,
            comment: `${marker} survey`,
          },
        }),
      );
      expect(answer.id).toBeTruthy();
      // A week-old account at the earliest: this one is new.
      expect(
        (
          await expectJson<{ show: boolean }>(
            await author.ctx.post("/api/feedback/survey/check"),
          )
        ).show,
      ).toBe(false);

      await setSettings(owner, { "feedback.enabled": false });
      const off = await expectJson<FeedbackConfig>(
        await author.ctx.get("/api/feedback/config"),
      );
      expect(off).toMatchObject({ enabled: false, survey: { enabled: false } });
      await expectStatus(
        await author.ctx.post("/api/feedback", {
          data: { kind: "general", format: "faces5", score: 2 },
        }),
        409,
      );
      expect(
        (
          await expectJson<{ show: boolean }>(
            await author.ctx.post("/api/feedback/survey/check"),
          )
        ).show,
      ).toBe(false);
    } finally {
      await setSettings(owner, {
        "feedback.enabled": null,
        "feedback.survey.enabled": null,
      });
    }
    const restored = await expectJson<FeedbackConfig>(
      await author.ctx.get("/api/feedback/config"),
    );
    expect(restored).toMatchObject({
      enabled: true,
      survey: { enabled: false },
    });
  },
);

test(
  "instance admins list, filter, page, summarise and export feedback",
  covers(
    "listInstanceFeedback",
    "getInstanceFeedbackSummary",
    "exportInstanceFeedback",
  ),
  async ({ apiAs }) => {
    const owner = await apiAs("owner");
    const all = await expectJson<AdminPage>(
      await owner.get("/api/instance-admin/feedback", {
        params: { search: marker },
      }),
    );
    expect(all.items.map((item) => item.kind).sort()).toEqual([
      "feature",
      "general",
      "general",
      "survey",
    ]);
    for (const item of all.items) {
      expect(item.user).toEqual({
        id: author.id,
        name: author.name,
        email: author.email,
      });
    }

    // One at a time, newest first, with a cursor.
    const first = await expectJson<AdminPage>(
      await owner.get("/api/instance-admin/feedback", {
        params: { search: marker, limit: "1" },
      }),
    );
    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.id).toBe(all.items[0]?.id);
    expect(first.nextCursor).toBeTruthy();
    const second = await expectJson<AdminPage>(
      await owner.get("/api/instance-admin/feedback", {
        params: {
          search: marker,
          limit: "1",
          cursor: first.nextCursor ?? "",
        },
      }),
    );
    expect(second.items[0]?.id).toBe(all.items[1]?.id);

    const thumbs = await expectJson<AdminPage>(
      await owner.get("/api/instance-admin/feedback", {
        params: { search: author.email, kind: "feature" },
      }),
    );
    expect(thumbs.items).toHaveLength(1);
    expect(thumbs.items[0]).toMatchObject({ format: "thumbs", score: 1 });
    const scored = await expectJson<AdminPage>(
      await owner.get("/api/instance-admin/feedback", {
        params: { search: marker, score: "4", hasComment: "true" },
      }),
    );
    expect(scored.items.map((item) => item.comment)).toEqual([
      `${marker} rated`,
    ]);

    for (const params of <Record<string, string>[]>[
      { limit: "0" },
      { limit: "101" },
      { cursor: "not-a-cursor" },
      { kind: "rumour" },
      { days: "0" },
    ]) {
      await expectStatus(
        await owner.get("/api/instance-admin/feedback", { params }),
        400,
      );
    }

    const summary = await expectJson<{
      format: string;
      days: number;
      count: number;
      satisfaction: number | null;
      total: number;
      comments: number;
      byKind: Record<"general" | "survey" | "feature", number>;
      distribution: { score: number; count: number }[];
      trend: { week: string; count: number }[];
    }>(
      await owner.get("/api/instance-admin/feedback/summary", {
        params: { format: "thumbs", days: "7" },
      }),
    );
    expect(summary).toMatchObject({ format: "thumbs", days: 7 });
    expect(summary.count).toBeGreaterThanOrEqual(1);
    expect(summary.byKind.feature).toBeGreaterThanOrEqual(1);
    expect(summary.byKind.general).toBeGreaterThanOrEqual(2);
    expect(summary.total).toBeGreaterThanOrEqual(4);
    expect(summary.comments).toBeGreaterThanOrEqual(4);
    expect(summary.distribution.map((entry) => entry.score)).toEqual([0, 1]);
    expect(summary.satisfaction).not.toBeNull();
    for (const week of summary.trend) {
      expect(week.week).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const byDefault = await expectJson<{ days: number }>(
      await owner.get("/api/instance-admin/feedback/summary"),
    );
    expect(byDefault.days).toBe(180);
    for (const params of <Record<string, string>[]>[
      { days: "6" },
      { format: "emoji" },
    ]) {
      await expectStatus(
        await owner.get("/api/instance-admin/feedback/summary", { params }),
        400,
      );
    }

    const exported = await owner.get("/api/instance-admin/feedback/export", {
      params: { search: marker },
    });
    expect(exported.status()).toBe(200);
    expect(exported.headers()["content-type"]).toContain("text/csv");
    expect(exported.headers()["content-disposition"]).toMatch(
      /^attachment; filename="feedback-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const csv = (await exported.body()).toString("utf8");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(`${marker} rated`);
    expect(csv).toContain(author.email);
    // A header row and one row per answer.
    expect(csv.trim().split(/\r?\n/)).toHaveLength(5);

    // A workspace admin is not an instance admin.
    const admin = await apiAs("admin");
    for (const path of ["", "/summary", "/export"]) {
      await expectStatus(
        await admin.get(`/api/instance-admin/feedback${path}`),
        403,
      );
      await expectStatus(
        await author.ctx.get(`/api/instance-admin/feedback${path}`),
        403,
      );
    }
    await expectStatus(
      await (await apiAs("anonymous")).get("/api/instance-admin/feedback"),
      401,
    );
    const key = await createApiKey(owner);
    const viaKey = await headerContext({ "x-api-key": key.key });
    try {
      await expectStatus(await viaKey.get("/api/instance-admin/feedback"), 403);
    } finally {
      await viaKey.dispose();
      await deleteApiKey(owner, key.id);
    }
  },
);

test(
  "deleting: one answer, old answers, and everything a person sent",
  covers(
    "deleteInstanceFeedback",
    "purgeInstanceFeedback",
    "deleteOwnFeedback",
  ),
  async ({ apiAs }) => {
    const owner = await apiAs("owner");
    const listed = await expectJson<AdminPage>(
      await owner.get("/api/instance-admin/feedback", {
        params: { search: marker, kind: "feature" },
      }),
    );
    const target = listed.items[0];
    expect(target).toBeTruthy();

    const admin = await apiAs("admin");
    await expectStatus(
      await admin.delete(`/api/instance-admin/feedback/${target?.id}`),
      403,
    );
    await expectStatus(
      await admin.delete("/api/instance-admin/feedback", {
        params: { olderThanDays: "3650" },
      }),
      403,
    );

    await confirmOwner(owner);
    expect(
      await expectJson(
        await owner.delete(`/api/instance-admin/feedback/${target?.id}`),
      ),
    ).toEqual({ deleted: 1 });
    await expectStatus(
      await owner.delete(`/api/instance-admin/feedback/${target?.id}`),
      404,
    );
    const mine = await expectJson<{ items: OwnFeedback[] }>(
      await author.ctx.get("/api/feedback/mine"),
    );
    expect(mine.items.map((item) => item.id)).not.toContain(target?.id);
    expect(mine.items).toHaveLength(3);

    // Ten years back: nothing this suite wrote is that old.
    const purged = await expectJson<{ deleted: number }>(
      await owner.delete("/api/instance-admin/feedback", {
        params: { olderThanDays: "3650" },
      }),
    );
    expect(purged.deleted).toBeGreaterThanOrEqual(0);
    for (const params of <Record<string, string>[]>[
      {},
      { olderThanDays: "-1" },
      { olderThanDays: "x" },
    ]) {
      await expectStatus(
        await owner.delete("/api/instance-admin/feedback", { params }),
        400,
      );
    }
    expect(
      (
        await expectJson<AdminPage>(
          await owner.get("/api/instance-admin/feedback", {
            params: { search: marker },
          }),
        )
      ).items,
    ).toHaveLength(3);

    expect(
      await expectJson(await author.ctx.delete("/api/feedback/mine")),
    ).toEqual({ deleted: 3 });
    expect(
      await expectJson(await author.ctx.get("/api/feedback/mine")),
    ).toEqual({ items: [] });
    expect(
      await expectJson(await author.ctx.delete("/api/feedback/mine")),
    ).toEqual({ deleted: 0 });
    expect(
      (
        await expectJson<AdminPage>(
          await owner.get("/api/instance-admin/feedback", {
            params: { search: marker },
          }),
        )
      ).items,
    ).toEqual([]);
  },
);

import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  decodeInboxCursor,
  encodeInboxCursor,
  INVALID_CURSOR,
  inboxCondition,
  inboxOrderBy,
  inboxViewCondition,
  parseInboxTypes,
} from "../../../apps/api/src/notification/inbox";

const dialect = new PgDialect();
const render = (fragment: Parameters<PgDialect["sqlToQuery"]>[0]) =>
  dialect.sqlToQuery(fragment);

const now = new Date("2026-09-26T10:00:00.000Z");

function errorOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

describe("inbox cursor", () => {
  it("round-trips the view, value and id", () => {
    const cursor = {
      view: "inbox" as const,
      value: "2026-09-26T10:00:00.123456Z",
      id: "n1",
    };
    const raw = encodeInboxCursor(cursor);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeInboxCursor(raw, "inbox")).toEqual(cursor);
  });

  it("rejects tampering, garbage and another view's cursor", () => {
    const raw = encodeInboxCursor({
      view: "snoozed",
      value: "2026-09-26T10:00:00Z",
      id: "n1",
    });
    expect(errorOf(() => decodeInboxCursor(raw, "inbox"))).toBe(INVALID_CURSOR);
    expect(errorOf(() => decodeInboxCursor("not-a-cursor", "inbox"))).toBe(
      INVALID_CURSOR,
    );
    const badDate = Buffer.from(
      JSON.stringify(["inbox", "yesterday", "n1"]),
    ).toString("base64url");
    expect(errorOf(() => decodeInboxCursor(badDate, "inbox"))).toBe(
      INVALID_CURSOR,
    );
    const missingId = Buffer.from(
      JSON.stringify(["inbox", "2026-09-26T10:00:00Z", ""]),
    ).toString("base64url");
    expect(errorOf(() => decodeInboxCursor(missingId, "inbox"))).toBe(
      INVALID_CURSOR,
    );
  });
});

describe("inbox type filters", () => {
  it("parses a comma list, deduplicated", () => {
    expect(parseInboxTypes(undefined)).toEqual([]);
    expect(parseInboxTypes("")).toEqual([]);
    expect(parseInboxTypes("assigned, subscribed,assigned")).toEqual([
      "assigned",
      "subscribed",
    ]);
  });

  it("rejects unknown values", () => {
    expect(parseInboxTypes("assigned,watching")).toBeNull();
  });
});

describe("inbox predicates", () => {
  it("builds each view against the clock", () => {
    const inbox = render(inboxViewCondition("inbox", now));
    expect(inbox.sql).toContain('"notification"."archived_at" is null');
    expect(inbox.sql).toContain('"notification"."snoozed_until" <= $1');
    expect(inbox.params).toEqual([now]);

    const snoozed = render(inboxViewCondition("snoozed", now));
    expect(snoozed.sql).toContain('"notification"."snoozed_until" > $1');

    const archived = render(inboxViewCondition("archived", now));
    expect(archived.sql).toBe('"notification"."archived_at" is not null');
  });

  it("scopes to the caller and the workspace, and narrows by tab and unread", () => {
    const query = render(
      inboxCondition({
        userId: "u1",
        workspaceId: "w1",
        view: "inbox",
        tab: "mentions",
        unread: true,
        types: [],
        now,
      }),
    );
    expect(query.sql).toContain('"notification"."user_id" = $1');
    expect(query.sql).toContain('"notification"."workspace_id" is null');
    // The Mentions tab covers task and page mentions.
    expect(query.sql).toContain('"notification"."type" in ');
    expect(query.sql).toContain('"notification"."is_read" is not true');
    expect(query.params).toContain("task_mention");
    expect(query.params).toContain("page_mention");
    expect(query.params).toContain("w1");
  });

  it("adds type filters only when asked", () => {
    const base = {
      userId: "u1",
      workspaceId: "w1",
      view: "inbox" as const,
      tab: "all" as const,
      unread: false,
      now,
    };
    const plain = render(inboxCondition({ ...base, types: [] }));
    expect(plain.sql).not.toContain("task_subscriber");
    const typed = render(inboxCondition({ ...base, types: ["subscribed"] }));
    expect(typed.sql).toContain('"task"."created_by" is distinct from');
    expect(typed.sql).toContain("task_subscriber");
  });

  it("orders snoozed soonest first and the others newest first", () => {
    const snoozed = inboxOrderBy("snoozed").map((part) => render(part).sql);
    expect(snoozed[0]).toContain("asc");
    const inbox = inboxOrderBy("inbox").map((part) => render(part).sql);
    expect(inbox[0]).toContain("coalesce");
    expect(inbox[0]).toContain("desc");
    expect(inbox[1]).toContain("desc nulls last");
  });
});

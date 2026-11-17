import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDays,
  type Member,
  matchMember,
  parseQuickAdd,
} from "./quick-add-parse";

const members: Member[] = [
  { id: "u1", name: "Ada Lovelace", handle: "ada" },
  { id: "u2", name: "Grace Hopper", handle: "ghopper" },
  { id: "u3", name: "Alan Turing", handle: "alan.t" },
  { id: "u4", name: "Zoë Ångström", handle: "zoe" },
  { id: "u5", name: "Sam Lee", handle: "sam.lee" },
  { id: "u6", name: "Sam Park", handle: "spark" },
];

/** Local calendar day as yyyy-mm-dd, whatever the time zone. */
function day(date: Date | null) {
  if (!date) return null;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// A Wednesday afternoon.
const wednesday = new Date(2026, 10, 18, 15, 30);

function parse(input: string, now = wednesday, ignored?: Set<string>) {
  return parseQuickAdd(input, { now, members, ignored });
}

describe("due dates", () => {
  it("reads today, tomorrow and next week", () => {
    expect(day(parse("Ship it today").dueDate)).toBe("2026-11-18");
    expect(day(parse("Ship it tomorrow").dueDate)).toBe("2026-11-19");
    expect(day(parse("Ship it next week").dueDate)).toBe("2026-11-25");
    expect(parse("Ship it Tomorrow").title).toBe("Ship it");
  });

  it("reads weekday names as the next such day", () => {
    expect(day(parse("Call friday").dueDate)).toBe("2026-11-20");
    expect(day(parse("Call monday").dueDate)).toBe("2026-11-23");
    // Today is Wednesday: "wednesday" means next week's.
    expect(day(parse("Call wednesday").dueDate)).toBe("2026-11-25");
    expect(day(parse("Call Sunday").dueDate)).toBe("2026-11-22");
  });

  it("reads in N days and weeks", () => {
    expect(day(parse("Renew in 3 days").dueDate)).toBe("2026-11-21");
    expect(day(parse("Renew in 1 day").dueDate)).toBe("2026-11-19");
    expect(day(parse("Renew in 2 weeks").dueDate)).toBe("2026-12-02");
    expect(parse("Renew in 3 days").title).toBe("Renew");
    // Not a date phrase: the words stay.
    expect(parse("Log in 3 places").dueDate).toBeNull();
    expect(parse("Log in 3 places").title).toBe("Log in 3 places");
  });

  it("reads dd/mm, dd/mm/yyyy and yyyy-mm-dd", () => {
    expect(day(parse("Report 25/12").dueDate)).toBe("2026-12-25");
    // Already past this year: next year.
    expect(day(parse("Report 01/02").dueDate)).toBe("2027-02-01");
    // Today itself is not in the past.
    expect(day(parse("Report 18/11").dueDate)).toBe("2026-11-18");
    expect(day(parse("Report 3/4/2027").dueDate)).toBe("2027-04-03");
    expect(day(parse("Report 2027-01-05").dueDate)).toBe("2027-01-05");
    expect(parse("Report 2027-01-05").title).toBe("Report");
  });

  it("rejects days that don't exist", () => {
    expect(parse("Report 31/02").dueDate).toBeNull();
    expect(parse("Report 2026-02-29").dueDate).toBeNull();
    expect(parse("Report 13/13").dueDate).toBeNull();
    expect(parse("Report 0/5").dueDate).toBeNull();
    expect(parse("Report 31/02").title).toBe("Report 31/02");
    // 2028 is a leap year.
    expect(day(parse("Report 29/02/2028").dueDate)).toBe("2028-02-29");
  });

  it("crosses month and year ends", () => {
    const endOfJanuary = new Date(2026, 0, 31, 23, 59);
    expect(day(parse("x tomorrow", endOfJanuary).dueDate)).toBe("2026-02-01");
    expect(day(parse("x in 30 days", endOfJanuary).dueDate)).toBe("2026-03-02");
    const newYearsEve = new Date(2026, 11, 31, 22, 0);
    expect(day(parse("x tomorrow", newYearsEve).dueDate)).toBe("2027-01-01");
    expect(day(parse("x next week", newYearsEve).dueDate)).toBe("2027-01-07");
    expect(day(parse("x friday", newYearsEve).dueDate)).toBe("2027-01-01");
    const leapDay = new Date(2028, 1, 28, 9, 0);
    expect(day(parse("x tomorrow", leapDay).dueDate)).toBe("2028-02-29");
    expect(day(parse("x in 2 days", leapDay).dueDate)).toBe("2028-03-01");
  });

  it("takes the word before a date when it introduces it", () => {
    expect(parse("Pay rent due friday").title).toBe("Pay rent");
    expect(parse("Call mom on sunday").title).toBe("Call mom");
    expect(parse("Finish by tomorrow.").title).toBe("Finish");
    // "due" alone is a word of the title.
    expect(parse("Fix due date bug").title).toBe("Fix due date bug");
  });

  it("uses the first date and leaves later ones as text", () => {
    const parsed = parse("Plan today for tomorrow");
    expect(day(parsed.dueDate)).toBe("2026-11-18");
    expect(parsed.title).toBe("Plan for tomorrow");
  });

  it("leaves a removed date chip as text and finds the next date", () => {
    const parsed = parse(
      "Plan today for tomorrow",
      wednesday,
      new Set(["due:today"]),
    );
    expect(day(parsed.dueDate)).toBe("2026-11-19");
    expect(parsed.title).toBe("Plan today for");
  });

  it("doesn't read words that only contain a keyword", () => {
    expect(parse("Review today's notes").dueDate).toBeNull();
    expect(parse("Mondays standup").dueDate).toBeNull();
  });
});

describe("time zones", () => {
  const original = process.env.TZ;
  afterAll(() => {
    process.env.TZ = original;
  });

  // Minutes behind UTC on 31 March 2026 (daylight saving in both zones).
  const offsets: Record<string, number> = {
    "Pacific/Auckland": -780,
    "America/Los_Angeles": 420,
    UTC: 0,
  };
  for (const [zone, offset] of Object.entries(offsets)) {
    describe(zone, () => {
      beforeAll(() => {
        process.env.TZ = zone;
      });

      it("sends the local midnight of the due day", () => {
        // 23:30 local on 31 March: tomorrow is 1 April in this zone.
        const late = new Date(2026, 2, 31, 23, 30);
        // The zone really applies.
        expect(late.getTimezoneOffset()).toBe(offset);
        const parsed = parseQuickAdd("x tomorrow", { now: late, members });
        const due = parsed.dueDate as Date;
        expect(day(due)).toBe("2026-04-01");
        expect([due.getHours(), due.getMinutes()]).toEqual([0, 0]);
        // The ISO string the API gets is that same instant.
        expect(new Date(due.toISOString()).getTime()).toBe(due.getTime());
      });

      it("keeps midnight across a daylight saving change", () => {
        // Early April (Auckland ends DST) and early March (US starts DST).
        for (const start of [
          new Date(2026, 3, 4, 12),
          new Date(2026, 2, 7, 12),
        ]) {
          const due = addDays(start, 2);
          expect([due.getHours(), due.getMinutes()]).toEqual([0, 0]);
          expect(due.getDate()).toBe(start.getDate() + 2);
        }
      });
    });
  }
});

describe("priorities", () => {
  it("reads named and numbered priorities", () => {
    expect(parse("Fix !urgent").priority).toBe("urgent");
    expect(parse("Fix !HIGH").priority).toBe("high");
    expect(parse("Fix !medium").priority).toBe("medium");
    expect(parse("Fix !med").priority).toBe("medium");
    expect(parse("Fix !low").priority).toBe("low");
    expect(parse("Fix !1").priority).toBe("urgent");
    expect(parse("Fix !2").priority).toBe("high");
    expect(parse("Fix !3").priority).toBe("medium");
    expect(parse("Fix !4").priority).toBe("low");
    expect(parse("Fix !urgent").title).toBe("Fix");
  });

  it("ignores unknown priorities and keeps the first", () => {
    expect(parse("Fix !5").priority).toBeNull();
    expect(parse("Fix !5").title).toBe("Fix !5");
    expect(parse("Wow!").priority).toBeNull();
    const twice = parse("Fix !low !high");
    expect(twice.priority).toBe("low");
    expect(twice.title).toBe("Fix !high");
  });

  it("keeps a removed priority as text", () => {
    const parsed = parse("Fix !high", wednesday, new Set(["priority:!high"]));
    expect(parsed.priority).toBeNull();
    expect(parsed.title).toBe("Fix !high");
  });
});

describe("assignees", () => {
  it("matches handles, first names and full names", () => {
    expect(parse("Review @ada").assignees.map((m) => m.id)).toEqual(["u1"]);
    expect(parse("Review @grace").assignees.map((m) => m.id)).toEqual(["u2"]);
    expect(parse("Review @ghopper").assignees.map((m) => m.id)).toEqual(["u2"]);
    expect(parse("Review @alan.t").assignees.map((m) => m.id)).toEqual(["u3"]);
    expect(parse("Review @AlanTuring").assignees.map((m) => m.id)).toEqual([
      "u3",
    ]);
    // Accents don't matter.
    expect(parse("Review @zoe").assignees.map((m) => m.id)).toEqual(["u4"]);
    expect(parse("Review @Zoë").assignees.map((m) => m.id)).toEqual(["u4"]);
    expect(parse("Review @ada").title).toBe("Review");
  });

  it("matches a unique prefix, never an ambiguous one", () => {
    expect(matchMember("gra", members)?.id).toBe("u2");
    expect(matchMember("sam", members)).toBeNull();
    expect(matchMember("samp", members)?.id).toBe("u6");
    expect(matchMember("a", members)).toBeNull();
    expect(matchMember("", members)).toBeNull();
  });

  it("assigns several people once each", () => {
    const parsed = parse("Pair @ada @grace @ada");
    expect(parsed.assignees.map((m) => m.id)).toEqual(["u1", "u2"]);
    expect(parsed.title).toBe("Pair");
  });

  it("keeps an unknown name as text with a warning", () => {
    const parsed = parse("Ask @nobody about it");
    expect(parsed.assignees).toEqual([]);
    expect(parsed.title).toBe("Ask @nobody about it");
    expect(parsed.tokens).toEqual([
      {
        kind: "unknownAssignee",
        key: "assignee:nobody",
        text: "@nobody",
        name: "nobody",
      },
    ]);
  });

  it("leaves names alone while members load, and emails always", () => {
    const loading = parseQuickAdd("Ask @ada", {
      now: wednesday,
      members: null,
    });
    expect(loading.title).toBe("Ask @ada");
    expect(loading.tokens).toEqual([]);
    expect(parse("Mail ada@example.com").assignees).toEqual([]);
    expect(parse("Mail ada@example.com").title).toBe("Mail ada@example.com");
  });

  it("keeps a removed assignee as text", () => {
    const parsed = parse("Review @ada", wednesday, new Set(["assignee:ada"]));
    expect(parsed.assignees).toEqual([]);
    expect(parsed.title).toBe("Review @ada");
    expect(parsed.tokens).toEqual([]);
  });
});

describe("mixed tokens", () => {
  it("reads everything at once, in any order", () => {
    const parsed = parse("!high Prepare the demo @ada due friday @grace");
    expect(parsed.title).toBe("Prepare the demo");
    expect(parsed.priority).toBe("high");
    expect(day(parsed.dueDate)).toBe("2026-11-20");
    expect(parsed.assignees.map((m) => m.id)).toEqual(["u1", "u2"]);
    expect(parsed.tokens.map((token) => token.kind)).toEqual([
      "priority",
      "assignee",
      "due",
      "assignee",
    ]);
  });

  it("collapses whitespace and handles an empty title", () => {
    expect(parse("  Ship   it  ").title).toBe("Ship it");
    const onlyTokens = parse("tomorrow !1");
    expect(onlyTokens.title).toBe("");
    expect(onlyTokens.priority).toBe("urgent");
    expect(parse("").title).toBe("");
  });

  it("names the date chip by the words typed", () => {
    const due = parse("Renew in 2 weeks!").tokens[0];
    expect(due).toMatchObject({
      kind: "due",
      text: "in 2 weeks!",
      key: "due:in 2 weeks",
    });
  });
});

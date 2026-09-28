import { afterEach, describe, expect, it } from "vitest";
import {
  type CaptureContext,
  compactName,
  dueDateToIso,
  parseCapture,
} from "./capture-parser";

// Wednesday 7 October 2026, mid-afternoon local time.
const WEDNESDAY = new Date(2026, 9, 7, 15, 30);

const members = [
  { id: "u-ana", name: "Ana Lima" },
  { id: "u-anton", name: "Anton Berg" },
  { id: "u-ravi", name: "Ravi Iyer" },
  { id: "u-mia", name: "Mia" },
];

const labels = [
  { name: "Bug", color: "red" },
  { name: "Needs design", color: "purple" },
  { name: "frontend", color: "teal" },
];

function context(overrides: Partial<CaptureContext> = {}): CaptureContext {
  return {
    members,
    labels,
    allowNewLabels: true,
    today: WEDNESDAY,
    ...overrides,
  };
}

const parse = (input: string, overrides?: Partial<CaptureContext>) =>
  parseCapture(input, context(overrides));

describe("parseCapture", () => {
  it("keeps plain text as the title", () => {
    const result = parse("  Fix the   404 on /pricing  ");
    expect(result.title).toBe("Fix the 404 on /pricing");
    expect(result.tokens).toEqual([]);
    expect(result.priority).toBeNull();
    expect(result.dueDate).toBeNull();
    expect(result.assigneeIds).toEqual([]);
    expect(result.labels).toEqual([]);
  });

  it("parses every token kind and leaves the rest in the title", () => {
    const result = parse("Fix 404 on /pricing @ana #bug !high fri");
    expect(result.title).toBe("Fix 404 on /pricing");
    expect(result.assigneeIds).toEqual(["u-ana"]);
    expect(result.labels).toEqual([
      { name: "Bug", color: "red", isNew: false },
    ]);
    expect(result.priority).toBe("high");
    expect(result.dueDate).toBe("2026-10-09");
    expect(result.tokens.map((token) => token.kind)).toEqual([
      "assignee",
      "label",
      "priority",
      "due",
    ]);
  });

  it("works with tokens anywhere in the text", () => {
    const result = parse("!urgent @ravi ship the release tomorrow");
    expect(result.title).toBe("ship the release");
    expect(result.priority).toBe("urgent");
    expect(result.assigneeIds).toEqual(["u-ravi"]);
    expect(result.dueDate).toBe("2026-10-08");
  });

  it("records each token's position and raw text", () => {
    const input = "Write docs @mia next week";
    const result = parse(input);
    const [assignee, due] = result.tokens;
    expect(input.slice(assignee.start, assignee.end)).toBe("@mia");
    expect(due.raw).toBe("next week");
    expect(input.slice(due.start, due.end)).toBe("next week");
  });

  describe("assignees", () => {
    it("matches a first name, a full name or a unique prefix, ignoring case", () => {
      expect(parse("a @ANA").assigneeIds).toEqual(["u-ana"]);
      expect(parse("a @analima").assigneeIds).toEqual(["u-ana"]);
      expect(parse("a @ana.lima").assigneeIds).toEqual(["u-ana"]);
      expect(parse("a @rav").assigneeIds).toEqual(["u-ravi"]);
      expect(parse("a @ant").assigneeIds).toEqual(["u-anton"]);
    });

    it("leaves an ambiguous or unknown name in the title", () => {
      const ambiguous = parse("ping @an about it");
      expect(ambiguous.assigneeIds).toEqual([]);
      expect(ambiguous.title).toBe("ping @an about it");
      const unknown = parse("ping @zoe");
      expect(unknown.assigneeIds).toEqual([]);
      expect(unknown.title).toBe("ping @zoe");
      // One letter is never enough for a prefix.
      expect(parse("x @r").assigneeIds).toEqual([]);
    });

    it("takes several people once each", () => {
      const result = parse("pair @ana @ravi @ana,");
      expect(result.assigneeIds).toEqual(["u-ana", "u-ravi"]);
      expect(result.title).toBe("pair @ana,");
    });

    it("ignores trailing punctuation", () => {
      const result = parse("ask @mia, then ship");
      expect(result.assigneeIds).toEqual(["u-mia"]);
      expect(result.title).toBe("ask then ship");
    });
  });

  describe("labels", () => {
    it("matches existing labels without case, spaces or dashes", () => {
      expect(parse("x #BUG").labels).toEqual([
        { name: "Bug", color: "red", isNew: false },
      ]);
      expect(parse("x #needs-design").labels).toEqual([
        { name: "Needs design", color: "purple", isNew: false },
      ]);
    });

    it("offers an unknown label as new when labels may be created", () => {
      const result = parse("x #perf");
      expect(result.labels).toEqual([
        { name: "perf", color: "gray", isNew: true },
      ]);
      expect(result.title).toBe("x");
    });

    it("keeps an unknown label in the title when labels may not be created", () => {
      const result = parse("x #perf #bug", { allowNewLabels: false });
      expect(result.labels).toEqual([
        { name: "Bug", color: "red", isNew: false },
      ]);
      expect(result.title).toBe("x #perf");
    });

    it("reads #123 as a reference, not a label", () => {
      const result = parse("Follow up on #123");
      expect(result.labels).toEqual([]);
      expect(result.title).toBe("Follow up on #123");
    });

    it("adds a label once", () => {
      expect(parse("x #bug #Bug").labels).toHaveLength(1);
    });
  });

  describe("priority", () => {
    it.each([
      ["!urgent", "urgent"],
      ["!high", "high"],
      ["!medium", "medium"],
      ["!low", "low"],
      ["!u", "urgent"],
      ["!h", "high"],
      ["!med", "medium"],
      ["!LOW", "low"],
    ])("%s is %s", (token, expected) => {
      expect(parse(`task ${token}`).priority).toBe(expected);
    });

    it("keeps an unknown or second priority in the title", () => {
      expect(parse("wow !nope").title).toBe("wow !nope");
      const result = parse("x !high !low");
      expect(result.priority).toBe("high");
      expect(result.title).toBe("x !low");
    });

    it("does not read an exclamation mark inside a word", () => {
      const result = parse("Ship it!");
      expect(result.priority).toBeNull();
      expect(result.title).toBe("Ship it!");
    });
  });

  describe("due dates", () => {
    it.each([
      ["today", "2026-10-07"],
      ["Today", "2026-10-07"],
      ["tomorrow", "2026-10-08"],
      ["thu", "2026-10-08"],
      ["fri", "2026-10-09"],
      ["friday", "2026-10-09"],
      ["sat", "2026-10-10"],
      ["sun", "2026-10-11"],
      ["mon", "2026-10-12"],
      ["tue", "2026-10-13"],
      // Today's weekday means next week's.
      ["wed", "2026-10-14"],
      ["next week", "2026-10-12"],
      ["12 Oct", "2026-10-12"],
      ["Oct 12", "2026-10-12"],
      ["12 october", "2026-10-12"],
      ["1st Nov", "2026-11-01"],
      // A day already past this year is next year's.
      ["3 Jan", "2027-01-03"],
      ["7 Oct", "2026-10-07"],
      ["6 Oct", "2027-10-06"],
      ["29 Feb 2028", "2028-02-29"],
      ["Mar 4 2027", "2027-03-04"],
    ])("%s is %s", (words, expected) => {
      const result = parse(`Plan launch ${words}`);
      expect(result.dueDate).toBe(expected);
      expect(result.title).toBe("Plan launch");
    });

    it("rejects impossible days", () => {
      const result = parse("x 31 Feb");
      expect(result.dueDate).toBeNull();
      expect(result.title).toBe("x 31 Feb");
      expect(parse("x 29 Feb 2027").dueDate).toBeNull();
    });

    it("needs a day with a month name", () => {
      expect(parse("Plan for May").dueDate).toBeNull();
      expect(parse("Plan for May").title).toBe("Plan for May");
      expect(parse("Fix 12 bugs").dueDate).toBeNull();
    });

    it("takes the first date and keeps later ones in the title", () => {
      const result = parse("Move standup from mon to fri");
      expect(result.dueDate).toBe("2026-10-12");
      expect(result.title).toBe("Move standup from to fri");
    });

    it("counts from the calendar day, not the time of day", () => {
      const lateNight = new Date(2026, 9, 7, 23, 59, 59);
      const earlyMorning = new Date(2026, 9, 7, 0, 0, 1);
      expect(parse("x tomorrow", { today: lateNight }).dueDate).toBe(
        "2026-10-08",
      );
      expect(parse("x tomorrow", { today: earlyMorning }).dueDate).toBe(
        "2026-10-08",
      );
    });

    it("crosses month and year ends", () => {
      const newYearsEve = new Date(2026, 11, 31, 12);
      expect(parse("x tomorrow", { today: newYearsEve }).dueDate).toBe(
        "2027-01-01",
      );
      expect(parse("x next week", { today: newYearsEve }).dueDate).toBe(
        "2027-01-04",
      );
    });
  });

  describe("removed chips", () => {
    it("keeps an ignored token's text in the title", () => {
      const ignored = new Set(["label:#bug", "due:fri", "assignee:@ana"]);
      const result = parse("Fix #bug @ana fri !low", { ignored });
      expect(result.title).toBe("Fix #bug @ana fri");
      expect(result.labels).toEqual([]);
      expect(result.assigneeIds).toEqual([]);
      expect(result.dueDate).toBeNull();
      expect(result.priority).toBe("low");
    });

    it("lets a later date word win once the first is ignored", () => {
      const result = parse("from mon to fri", {
        ignored: new Set(["due:mon"]),
      });
      expect(result.dueDate).toBe("2026-10-09");
      expect(result.title).toBe("from mon to");
    });
  });
});

describe("compactName", () => {
  it("drops case, spaces, dots, dashes and underscores", () => {
    expect(compactName(" Ana_Lima-Silva.Jr ")).toBe("analimasilvajr");
  });
});

describe("timezones", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it.each(["Pacific/Kiritimati", "America/Los_Angeles", "Asia/Kolkata", "UTC"])(
    "keeps the local calendar day in %s",
    (zone) => {
      process.env.TZ = zone;
      const lateNight = new Date(2026, 9, 7, 23, 30);
      const result = parse("x tomorrow", { today: lateNight });
      expect(result.dueDate).toBe("2026-10-08");
      const sent = new Date(dueDateToIso(result.dueDate ?? ""));
      expect([sent.getFullYear(), sent.getMonth(), sent.getDate()]).toEqual([
        2026, 9, 8,
      ]);
      expect([sent.getHours(), sent.getMinutes()]).toEqual([0, 0]);
    },
  );
});

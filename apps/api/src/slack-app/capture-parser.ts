/**
 * The capture bar's token parser (DESIGN-SYSTEM §7.3, §13): `@name` picks an
 * assignee, `#label` a label, `!urgent` a priority and date words a due date.
 * Whatever does not match stays in the title, and every date is a local
 * calendar day ("yyyy-MM-dd"), so no timezone shifts it.
 *
 * The API's Slack command parses with the same rules, so this file is copied
 * byte for byte to apps/api/src/slack-app/capture-parser.ts and has no
 * dependencies; tests/api/slack-app/capture-parser.test.ts keeps them equal.
 */

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7);
}

function getDay(date: Date): number {
  return date.getDay();
}

function isBefore(date: Date, other: Date): boolean {
  return date.getTime() < other.getTime();
}

/** Monday of the date's week, at local midnight. */
function startOfIsoWeek(date: Date): Date {
  return addDays(startOfDay(date), -((getDay(date) + 6) % 7));
}

export type CapturePriority = "urgent" | "high" | "medium" | "low";

export const CAPTURE_PRIORITIES: readonly CapturePriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
];

export type CaptureMember = { id: string; name: string };
export type CaptureLabel = { name: string; color: string };

type TokenBase = {
  /** The text as typed, e.g. "@ana" or "next week". */
  raw: string;
  /** Identity for removing a chip: the same raw text is ignored everywhere. */
  key: string;
  start: number;
  end: number;
};

export type CaptureToken =
  | (TokenBase & { kind: "assignee"; member: CaptureMember })
  | (TokenBase & {
      kind: "label";
      name: string;
      color: string;
      /** Not in the workspace yet: it is created with the task. */
      isNew: boolean;
    })
  | (TokenBase & { kind: "priority"; priority: CapturePriority })
  | (TokenBase & { kind: "due"; date: string });

export type CaptureResult = {
  title: string;
  tokens: CaptureToken[];
  assigneeIds: string[];
  labels: Array<{ name: string; color: string; isNew: boolean }>;
  priority: CapturePriority | null;
  /** A local calendar day, "yyyy-MM-dd". */
  dueDate: string | null;
};

export type CaptureContext = {
  members: readonly CaptureMember[];
  labels: readonly CaptureLabel[];
  /** Unknown `#names` become new labels only when the user may create them. */
  allowNewLabels: boolean;
  /** "Now" in local time; date words count from its calendar day. */
  today: Date;
  /** Token keys whose chips were removed: their text stays in the title. */
  ignored?: ReadonlySet<string>;
};

export const NEW_LABEL_COLOR = "gray";

const WEEKDAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

/** Trailing punctuation a token may carry ("@ana," "fri."). */
const TRAILING = /[,.;:!?)]+$/;

type Word = { text: string; start: number; end: number };

function wordsOf(input: string): Word[] {
  const words: Word[] = [];
  for (const match of input.matchAll(/\S+/g)) {
    const start = match.index ?? 0;
    words.push({ text: match[0], start, end: start + match[0].length });
  }
  return words;
}

function bare(text: string): string {
  return text.replace(TRAILING, "").toLowerCase();
}

/** Lowercased, without spaces, dots, dashes or underscores. */
export function compactName(name: string): string {
  return name.toLowerCase().replace(/[\s._-]+/g, "");
}

function toDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The next given weekday strictly after today (1 to 7 days ahead). */
function nextWeekday(today: Date, weekday: number): Date {
  const delta = (weekday - getDay(today) + 7) % 7 || 7;
  return addDays(today, delta);
}

/** A day and month this year, or next year once it has passed. */
function dayOfMonth(
  today: Date,
  month: number,
  day: number,
  year?: number,
): Date | null {
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const build = (y: number) => {
    const date = new Date(y, month, day);
    // Rejects 31 Feb and friends instead of rolling into the next month.
    return date.getMonth() === month ? date : null;
  };
  if (year !== undefined) return build(year);
  const thisYear = build(today.getFullYear());
  if (thisYear && !isBefore(thisYear, today)) return thisYear;
  return build(today.getFullYear() + 1);
}

function dayNumber(text: string): number | null {
  const match = /^(\d{1,2})(st|nd|rd|th)?$/.exec(text);
  return match ? Number(match[1]) : null;
}

function yearNumber(text: string | undefined): number | undefined {
  if (!text) return undefined;
  return /^\d{4}$/.test(text) ? Number(text) : undefined;
}

type DateMatch = { date: Date; words: number };

/** A date phrase starting at `words[index]`, and how many words it spans. */
function matchDate(
  words: readonly Word[],
  index: number,
  today: Date,
): DateMatch | null {
  const word = words[index];
  if (!word) return null;
  const first = bare(word.text);
  const next = words[index + 1];
  const after = words[index + 2];
  const second = next ? bare(next.text) : undefined;
  const third = after ? bare(after.text) : undefined;

  if (first === "today") return { date: today, words: 1 };
  if (first === "tomorrow") return { date: addDays(today, 1), words: 1 };
  if (first === "next" && second === "week") {
    return {
      date: startOfIsoWeek(addWeeks(today, 1)),
      words: 2,
    };
  }
  const weekday = Object.hasOwn(WEEKDAYS, first) ? WEEKDAYS[first] : undefined;
  if (weekday !== undefined) {
    return { date: nextWeekday(today, weekday), words: 1 };
  }

  // "12 Oct", "12 October 2027"
  const day = dayNumber(first);
  const secondMonth =
    second !== undefined && Object.hasOwn(MONTHS, second)
      ? MONTHS[second]
      : undefined;
  if (day !== null && secondMonth !== undefined) {
    const year = yearNumber(third);
    const date = dayOfMonth(today, secondMonth, day, year);
    if (date) return { date, words: year === undefined ? 2 : 3 };
  }
  // "Oct 12", "Oct 12 2027"
  const firstMonth = Object.hasOwn(MONTHS, first) ? MONTHS[first] : undefined;
  if (firstMonth !== undefined && second !== undefined) {
    const monthDay = dayNumber(second);
    if (monthDay !== null) {
      const year = yearNumber(third);
      const date = dayOfMonth(today, firstMonth, monthDay, year);
      if (date) return { date, words: year === undefined ? 2 : 3 };
    }
  }
  return null;
}

function matchMember(
  query: string,
  members: readonly CaptureMember[],
): CaptureMember | null {
  const wanted = compactName(query);
  if (!wanted) return null;
  const keysOf = (member: CaptureMember) => {
    const parts = member.name.trim().toLowerCase().split(/\s+/);
    return [compactName(member.name), compactName(parts[0] ?? "")].filter(
      Boolean,
    );
  };
  const exact = members.filter((member) => keysOf(member).includes(wanted));
  if (exact.length === 1) return exact[0] ?? null;
  if (exact.length > 1) return null;
  // A unique prefix ("@an" for Ana) also counts, from two letters on.
  if (wanted.length < 2) return null;
  const prefixed = members.filter((member) =>
    keysOf(member).some((key) => key.startsWith(wanted)),
  );
  return prefixed.length === 1 ? (prefixed[0] ?? null) : null;
}

function matchPriority(query: string): CapturePriority | null {
  if (!query) return null;
  return CAPTURE_PRIORITIES.find((value) => value.startsWith(query)) ?? null;
}

function matchLabel(
  query: string,
  labels: readonly CaptureLabel[],
): CaptureLabel | null {
  const wanted = compactName(query);
  return labels.find((label) => compactName(label.name) === wanted) ?? null;
}

/** Turns the capture bar's text into a title and task properties. */
export function parseCapture(
  input: string,
  context: CaptureContext,
): CaptureResult {
  const today = startOfDay(context.today);
  const ignored = context.ignored ?? new Set<string>();
  const words = wordsOf(input);
  const tokens: CaptureToken[] = [];
  const consumed: Array<[number, number]> = [];
  const assigneeIds: string[] = [];
  const labels: CaptureResult["labels"] = [];
  let priority: CapturePriority | null = null;
  let dueDate: string | null = null;

  const take = (token: CaptureToken) => {
    tokens.push(token);
    consumed.push([token.start, token.end]);
  };

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!word) continue;
    const sigil = word.text[0];
    const body = bare(word.text.slice(1));

    if (sigil === "@" && body) {
      const key = `assignee:${bare(word.text)}`;
      const member = ignored.has(key)
        ? null
        : matchMember(body, context.members);
      if (member && !assigneeIds.includes(member.id)) {
        assigneeIds.push(member.id);
        take({ kind: "assignee", member, raw: word.text, key, ...word });
      }
      continue;
    }

    // "#123" reads as a task reference, not a label.
    if (sigil === "#" && body && !/^\d+$/.test(body)) {
      const key = `label:${bare(word.text)}`;
      if (ignored.has(key)) continue;
      const existing = matchLabel(body, context.labels);
      const name = existing?.name ?? word.text.slice(1).replace(TRAILING, "");
      if (!existing && !context.allowNewLabels) continue;
      if (labels.some((label) => compactName(label.name) === compactName(name)))
        continue;
      const color = existing?.color ?? NEW_LABEL_COLOR;
      labels.push({ name, color, isNew: !existing });
      take({
        kind: "label",
        name,
        color,
        isNew: !existing,
        raw: word.text,
        key,
        ...word,
      });
      continue;
    }

    if (sigil === "!" && body && priority === null) {
      const key = `priority:${bare(word.text)}`;
      const match = ignored.has(key) ? null : matchPriority(body);
      if (match) {
        priority = match;
        take({
          kind: "priority",
          priority: match,
          raw: word.text,
          key,
          ...word,
        });
      }
      continue;
    }

    if (dueDate === null) {
      const match = matchDate(words, index, today);
      if (match) {
        const last = words[index + match.words - 1] ?? word;
        const raw = input.slice(word.start, last.end);
        const key = `due:${bare(raw)}`;
        if (!ignored.has(key)) {
          dueDate = toDay(match.date);
          take({
            kind: "due",
            date: dueDate,
            raw,
            key,
            start: word.start,
            end: last.end,
          });
          index += match.words - 1;
        }
      }
    }
  }

  let title = "";
  let cursor = 0;
  for (const [start, end] of consumed.sort((a, b) => a[0] - b[0])) {
    title += `${input.slice(cursor, start)} `;
    cursor = end;
  }
  title += input.slice(cursor);

  return {
    title: title.replace(/\s+/g, " ").trim(),
    tokens,
    assigneeIds,
    labels,
    priority,
    dueDate,
  };
}

/** The API's timestamp for a parsed due day: local midnight of that day. */
export function dueDateToIso(day: string): string {
  const [year = Number.NaN, month = Number.NaN, date = Number.NaN] = day
    .split("-")
    .map(Number);
  return new Date(year, month - 1, date).toISOString();
}

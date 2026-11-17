// Reads a quick-add title as the person types: a due date, a priority and
// assignees, which come out of the title. English keywords only; the dates
// are days in the device's own time zone.

/** A workspace member quick add can assign (`quick_add_members`). */
export type Member = { id: string; name: string; handle: string };

/** The API's priorities, without "no-priority". */
export type Priority = "low" | "medium" | "high" | "urgent";

export type DetectedToken =
  | { kind: "due"; key: string; text: string; date: Date }
  | { kind: "priority"; key: string; text: string; priority: Priority }
  | { kind: "assignee"; key: string; text: string; member: Member }
  | { kind: "unknownAssignee"; key: string; text: string; name: string };

export type ParsedQuickAdd = {
  /** The title without the detected tokens, whitespace collapsed. */
  title: string;
  /** Local midnight of the due day. */
  dueDate: Date | null;
  priority: Priority | null;
  assignees: Member[];
  /** In the order typed, for the chips. */
  tokens: DetectedToken[];
};

export type ParseOptions = {
  now: Date;
  /** Null while the members are loading: `@names` stay plain text. */
  members: readonly Member[] | null;
  /** Keys of chips the person removed: those words stay in the title. */
  ignored?: ReadonlySet<string>;
};

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const PRIORITIES: Record<string, Priority> = {
  urgent: "urgent",
  "1": "urgent",
  high: "high",
  "2": "high",
  medium: "medium",
  med: "medium",
  "3": "medium",
  low: "low",
  "4": "low",
};

/** Words that may lead a date ("due friday", "on monday", "by tomorrow"). */
const DATE_LEADS = new Set(["due", "on", "by"]);

const TRAILING_PUNCTUATION = /[.,;:!?)]+$/;

type Word = { text: string; start: number; end: number };

function words(input: string): Word[] {
  return Array.from(input.matchAll(/\S+/g), (match) => ({
    text: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

/** A word without trailing punctuation, lower-cased, for keyword checks. */
function bare(word: string) {
  return word.replace(TRAILING_PUNCTUATION, "").toLowerCase();
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** A real calendar day, or null (31/02, month 13, ...). */
function calendarDay(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  // Years 0-99 map to 1900-1999 in the Date constructor.
  date.setFullYear(year);
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/** One-word dates: today, tomorrow, weekdays, dd/mm[/yyyy], yyyy-mm-dd. */
function singleWordDate(word: string, today: Date): Date | null {
  if (word === "today") return today;
  if (word === "tomorrow") return addDays(today, 1);
  const weekday = WEEKDAYS.indexOf(word);
  if (weekday >= 0) {
    // The next such day; the same weekday as today means a week from now.
    return addDays(today, (weekday - today.getDay() + 7) % 7 || 7);
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(word);
  if (iso) return calendarDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dayMonth = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(word);
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const month = Number(dayMonth[2]);
    if (dayMonth[3]) return calendarDay(Number(dayMonth[3]), month, day);
    // Without a year: the next time that day comes round.
    const thisYear = calendarDay(today.getFullYear(), month, day);
    if (thisYear && thisYear >= today) return thisYear;
    return calendarDay(today.getFullYear() + 1, month, day);
  }
  return null;
}

/** A date phrase starting at `index`: its date and word count. */
function dateAt(
  list: readonly Word[],
  index: number,
  today: Date,
): { date: Date; length: number } | null {
  const first = bare(list[index]?.text ?? "");
  const second = bare(list[index + 1]?.text ?? "");
  const third = bare(list[index + 2]?.text ?? "");
  if (first === "in" && /^\d{1,3}$/.test(list[index + 1]?.text ?? "")) {
    const count = Number(second);
    if (third === "day" || third === "days")
      return { date: addDays(today, count), length: 3 };
    if (third === "week" || third === "weeks")
      return { date: addDays(today, count * 7), length: 3 };
  }
  if (first === "next" && second === "week") {
    return { date: addDays(today, 7), length: 2 };
  }
  const single = singleWordDate(first, today);
  return single ? { date: single, length: 1 } : null;
}

function normalise(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s._-]+/g, "");
}

function memberKeys(member: Member): string[] {
  const first = member.name.trim().split(/\s+/)[0] ?? "";
  return [member.handle, first, member.name]
    .map(normalise)
    .filter((key) => key.length > 0);
}

/**
 * The member an `@name` means: an exact handle, first name or full name
 * (spaces, dots and dashes ignored), else a unique prefix of two or more
 * characters. Null when nobody or more than one person matches.
 */
export function matchMember(
  name: string,
  members: readonly Member[],
): Member | null {
  const wanted = normalise(name);
  if (!wanted) return null;
  const unique = (list: Member[]) => {
    const ids = new Set(list.map((member) => member.id));
    return ids.size === 1 ? (list[0] ?? null) : null;
  };
  const exact = members.filter((member) => memberKeys(member).includes(wanted));
  if (exact.length > 0) return unique(exact);
  if (wanted.length < 2) return null;
  return unique(
    members.filter((member) =>
      memberKeys(member).some((key) => key.startsWith(wanted)),
    ),
  );
}

const MENTION = /^@([\p{L}\p{N}._-]+)$/u;

export function parseQuickAdd(
  input: string,
  { now, members, ignored = new Set() }: ParseOptions,
): ParsedQuickAdd {
  const today = startOfDay(now);
  const list = words(input);
  const consumed = new Set<number>();
  const tokens: DetectedToken[] = [];
  let dueDate: Date | null = null;
  let priority: Priority | null = null;
  const assignees: Member[] = [];

  for (let index = 0; index < list.length; index++) {
    if (consumed.has(index)) continue;
    const word = list[index] as Word;
    const lower = bare(word.text);

    if (lower.startsWith("!") && priority === null) {
      const value = PRIORITIES[lower.slice(1)];
      const key = `priority:${lower}`;
      if (value && !ignored.has(key)) {
        priority = value;
        consumed.add(index);
        tokens.push({
          kind: "priority",
          key,
          text: word.text,
          priority: value,
        });
        continue;
      }
    }

    const mention = MENTION.exec(word.text.replace(TRAILING_PUNCTUATION, ""));
    if (mention && members !== null) {
      const name = mention[1] as string;
      const key = `assignee:${name.toLowerCase()}`;
      if (ignored.has(key)) continue;
      const member = matchMember(name, members);
      if (member) {
        consumed.add(index);
        if (!assignees.some((known) => known.id === member.id)) {
          assignees.push(member);
          tokens.push({ kind: "assignee", key, text: word.text, member });
        }
      } else if (!tokens.some((token) => token.key === key)) {
        // Stays in the title; the chip only warns.
        tokens.push({ kind: "unknownAssignee", key, text: word.text, name });
      }
      continue;
    }

    if (dueDate === null) {
      const found = dateAt(list, index, today);
      if (found) {
        const phrase = list.slice(index, index + found.length);
        const key = `due:${phrase.map((part) => bare(part.text)).join(" ")}`;
        if (!ignored.has(key)) {
          dueDate = found.date;
          for (let offset = 0; offset < found.length; offset++)
            consumed.add(index + offset);
          const lead = list[index - 1];
          if (
            lead &&
            !consumed.has(index - 1) &&
            DATE_LEADS.has(lead.text.toLowerCase())
          ) {
            consumed.add(index - 1);
          }
          const last = phrase[phrase.length - 1] as Word;
          tokens.push({
            kind: "due",
            key,
            text: input.slice(word.start, last.end),
            date: found.date,
          });
          index += found.length - 1;
        }
      }
    }
  }

  const title = list
    .filter((_, index) => !consumed.has(index))
    .map((word) => word.text)
    .join(" ");
  return { title, dueDate, priority, assignees, tokens };
}

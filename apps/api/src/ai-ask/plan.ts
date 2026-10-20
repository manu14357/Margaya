// Turning a question into a retrieval plan: what to search for and which
// structured task filters apply ("what's overdue in Website", "my open
// tasks", "what's blocking cycle 12", "what did we finish this week").
//
// Two sources are merged: deterministic rules (English keywords, "how many"
// in the UI languages, task keys, "cycle 12") that work without a model,
// and an optional small planner call that understands every language. The
// planner only sees the conversation's text; project, cycle and member
// names are matched here, against what the caller may see.

export const ASK_INTENTS = [
  "overdue",
  "mine",
  "open",
  "completed",
  "blocking",
  "due_soon",
  "unassigned",
  "high_priority",
  "recent",
  "risk",
  "stats",
  "trend",
] as const;
export type AskIntent = (typeof ASK_INTENTS)[number];

export type AskPlan = {
  /** Search words, OR-ed (web-search syntax). */
  terms: string[];
  /** Whole task keys mentioned in the question (WEB-12). */
  taskKeys: string[];
  intents: Set<AskIntent>;
  /** Some intents came from the planner model, not the rules. */
  intentsGuessed: boolean;
  /** An English keyword rule found intents, so the planner's are ignored. */
  ruleIntents: boolean;
  /** A project the question names (free text, matched later). */
  project: string | null;
  /** A cycle the question names ("12", "Sprint 4"). */
  cycle: string | null;
  /** The question leans on the conversation ("and its description?"). */
  followUp: boolean;
  /**
   * What the previous turn was about, for a follow-up (withEarlierTurn):
   * its question, and the tasks its answer cited when there were few.
   */
  earlier: { question: string; taskKeys: string[] } | null;
};

const INTENT_RULES: [AskIntent, RegExp][] = [
  ["overdue", /\b(overdue|late|past due|missed (the )?deadline|behind)\b/i],
  ["mine", /\b(my|mine|assigned to me|on my plate|i own)\b/i],
  [
    "open",
    /\b(open|unfinished|remaining|left|outstanding|in progress|active|pending|not done)\b/i,
  ],
  [
    "completed",
    // "not done" and "unfinished" are open work; "when will we finish" is a
    // forecast, "what did we finish" is finished work.
    /(?<!\bnot\s|n't\s)\b(done|finished|completed|closed|shipped|resolved|delivered|wrapped up)\b|\bdid\b[^?.!]{0,30}\b(finish|complete|close|ship|resolve|deliver)\b/i,
  ],
  [
    "blocking",
    /\b(block(s|ed|ing|er|ers)?|stuck|depends? on|dependenc(y|ies))\b/i,
  ],
  [
    "due_soon",
    /\b(due (soon|today|tomorrow|this week|next week)|upcoming|deadlines?)\b/i,
  ],
  ["unassigned", /\b(unassigned|no assignee|nobody (owns|is on))\b/i],
  ["high_priority", /\b(urgent|high[- ]priority|critical)\b/i],
  ["recent", /\b(recent(ly)?|latest|changed|updated|this week|last week)\b/i],
  [
    "risk",
    /\b(risks?|risky|at risk|forecast|on track|when will|finish on time|slip(ping)?)\b/i,
  ],
  [
    "stats",
    /\b(how many|count(s|ed|ing)?|number of|totals?|breakdown|break down|distribution|percent(age)?s?|(per|by|each|every) (status(es)?|state|column|priority|priorities|assignees?|person|people|owners?|members?|labels?|tags?|cycles?|sprints?|modules?|projects?|group)|charts?|graphs?|plot|visuali[sz](e|ation)|stats|statistics|metrics|workload|summary of (the )?status|status (summary|overview|report))\b/i,
  ],
  [
    "trend",
    /\b(over time|trends?|trending|per (day|week|month)|each (day|week)|daily|weekly|by (day|week)|burn[- ]?(down|up)s?|velocity|throughput|cumulative|created (vs\.?|versus|and) (completed|closed|done|finished)|opened (vs\.?|versus|and) closed|last \d+ (days|weeks))\b/i,
  ],
];

// "How many" in the UI languages, so a counting question gets the facts
// block even when the planner is off or misses it. CJK has no word gaps.
const COUNT_RULE =
  /(?<![\p{L}\p{N}])(cu[aá]nt[oa]s|quant[oa]s|quant[ie]|combien|wie\s?viele?|anzahl|hoeveel|сколько|скільки|колку|kaç|neçə|berapa|bao nhiêu|πόσ(α|ες|οι|ους)|कितन[ाीे]|ile\s+(jest|mamy|zadań))(?![\p{L}\p{N}])|多少|几个|幾個|いくつ|何件|何個|몇\s?(개|건)/iu;

// Words that point back at the conversation instead of naming a subject.
const FOLLOW_UP_RULE =
  /\b(it|its|it's|they|them|their|these|those|he|she|him|her|his|(this|that) (one|task|issue)|the same|what about|how about)\b/i;

// Words of a counting or charting question that never help a full-text
// match ("create a chart based on the status"): the facts block answers it.
const STATS_WORDS = new Set(
  `how many much count counts number numbers total totals breakdown break
distribution percent percentage percentages per each every by chart charts
graph graphs plot visualize visualise visualization visualisation stats
statistics metrics workload summary overview report create make draw build
generate based interactive bar bars pie donut line column columns state
states statuses priorities assignee assignees person people owner owners
member members label labels tag tags module modules projects group groups
over time trend trends trending daily weekly monthly day days week weeks month
months burndown burnup burn down up velocity throughput created opened vs
versus cumulative last`.split(/\s+/),
);

/** The terms without counting, charting and trend words. */
export function withoutStatsWords(terms: readonly string[]): string[] {
  return terms.filter((term) => !STATS_WORDS.has(term.toLowerCase()));
}

/** Counting, charting and trend questions: facts answer them, not words. */
function countsOnly(intents: ReadonlySet<AskIntent>): boolean {
  return intents.has("stats") || intents.has("trend");
}

const CYCLE_RULE =
  /\b(?:cycle|sprint|iteration)\s+#?([\p{L}\p{N}][\p{L}\p{N}._-]{0,40})/iu;

const TASK_KEY_RULE =
  /(?<![\p{L}\p{N}-])(\p{L}[\p{L}\p{N}]{0,9}-\d{1,7})(?![\p{L}\p{N}-])/gu;

// Words that never help a full-text match. The search config has no
// stemming or stop words, so the plain question would match nothing.
const STOP_WORDS = new Set(
  `a about above after again all also am an and any are as at be been before
being below between both but by can could did do does doing done down during
each few for from further had has have having he her here hers him his how i
if in into is it its itself just me more most my myself no nor not now of off
on once only or other our ours out over own same she should so some such than
that the their theirs them then there these they this those through to too
under until up very was we were what when where which while who whom why will
with would you your yours tell show list give find please any anything
everything something task tasks issue issues work happening happened going
status what's whats who's open overdue late due soon today tomorrow week
blocking blocked blocker blockers block blocks urgent priority high assigned
unassigned mine recent recently latest risk risks cycle sprint iteration
project remaining left pending done finish finished completed closed shipped
resolved plate working assignee`.split(/\s+/),
);

const MAX_TERMS = 8;

/** The question's search words: no stop words, no duplicates, at most 8. */
export function searchTermsOf(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}_-]+/u)) {
    const word = raw.replace(/^[-_]+|[-_]+$/g, "");
    if (!word || STOP_WORDS.has(word) || out.includes(word)) continue;
    // One Latin letter or digit says nothing; one CJK character can.
    if (word.length < 2 && !/[^\p{Script=Latin}\p{N}]/u.test(word)) continue;
    out.push(word);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

function taskKeysIn(text: string): string[] {
  return [...text.matchAll(TASK_KEY_RULE)]
    .map((match) => (match[1] ?? "").toUpperCase())
    .filter(Boolean);
}

/** Deterministic plan: works without a model (English keywords). */
export function heuristicPlan(question: string): AskPlan {
  const intents = new Set<AskIntent>();
  for (const [intent, rule] of INTENT_RULES) {
    if (rule.test(question)) intents.add(intent);
  }
  const ruleIntents = intents.size > 0;
  if (COUNT_RULE.test(question)) intents.add("stats");
  const taskKeys = [...new Set(taskKeysIn(question))];
  const cycle = CYCLE_RULE.exec(question)?.[1] ?? null;
  const terms = searchTermsOf(question);
  const project =
    /\b(?:in|for|of|on)\s+(?:the\s+)?([\p{L}\p{N}][\p{L}\p{N} ._-]{0,60}?)(?:\s+project\b|[?.!,]|$)/iu.exec(
      question,
    )?.[1] ?? null;
  return {
    terms: countsOnly(intents) ? withoutStatsWords(terms) : terms,
    taskKeys,
    intents,
    intentsGuessed: false,
    ruleIntents,
    project: project?.trim() || null,
    cycle,
    followUp: taskKeys.length === 0 && FOLLOW_UP_RULE.test(question),
    earlier: null,
  };
}

/** What the planner model answers (PLANNER_SCHEMA). */
export type PlannerAnswer = {
  searchTerms?: unknown;
  intents?: unknown;
  project?: unknown;
  cycle?: unknown;
  followUp?: unknown;
};

export const PLANNER_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    searchTerms: {
      type: "array",
      items: { type: "string" },
      description:
        "Up to 8 distinctive keywords or short phrases to full-text search for, in the language the workspace content is likely written in (keep names, codes and task keys as written). No filler words.",
    },
    intents: {
      type: "array",
      items: { type: "string", enum: [...ASK_INTENTS] },
      description:
        "Structured filters the question asks for: overdue, mine (assigned to the asker), open (not done), completed (done, finished, closed or shipped work), blocking (blockers or dependencies), due_soon, unassigned, high_priority, recent, risk (forecast or delivery risk), stats (any counting question: how many, counts, totals, breakdowns, distributions, or a chart or graph), trend (change over time: per day or week, created vs completed, burndown, burn-up, velocity).",
    },
    project: {
      type: "string",
      description: "The project the question names, as written, or empty.",
    },
    cycle: {
      type: "string",
      description:
        "The cycle or sprint the question names (its name or number), or empty.",
    },
    followUp: {
      type: "boolean",
      description:
        "True when the question refers to something from the earlier conversation without naming it (it, its, that task, them, what about…).",
    },
  },
  required: ["searchTerms", "intents", "project", "cycle", "followUp"],
  additionalProperties: false,
};

export const PLANNER_INSTRUCTIONS = `Task: turn the user's question about their project-management workspace into a search plan. Do not answer the question.
Return only JSON matching the schema. The question may be in any language; intents are fixed English values. Earlier questions and answers, when given, are only there to understand a follow-up question.`;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, max);
  return text && text.toLowerCase() !== "none" ? text : null;
}

/**
 * Merges the planner's answer into the deterministic plan. The planner's
 * search words replace the keyword fallback (they handle every language).
 * Small local models pad their answers with extra intents and invented
 * cycles, and every extra intent narrows the task filter, so the planner's
 * intents only count when no English keyword rule matched (a question in
 * another language, where "how many" may already have added stats), and
 * its cycle only when the question contains it.
 */
export function mergePlan(
  base: AskPlan,
  answer: PlannerAnswer | null,
  question: string,
): AskPlan {
  if (!answer) return base;
  // Split into words: small models answer with long phrases ("login
  // redirect loop fix") that never match as a whole.
  const terms = Array.isArray(answer.searchTerms)
    ? searchTermsOf(
        answer.searchTerms
          .map((term) => cleanText(term, 80))
          .filter(Boolean)
          .join(" "),
      )
    : [];
  const intents = new Set(base.intents);
  if (!base.ruleIntents && Array.isArray(answer.intents)) {
    for (const intent of answer.intents) {
      if ((ASK_INTENTS as readonly unknown[]).includes(intent)) {
        intents.add(intent as AskIntent);
      }
    }
  }
  const cycle = cleanText(answer.cycle, 60);
  const merged = terms.length > 0 ? terms : base.terms;
  return {
    terms: countsOnly(intents) ? withoutStatsWords(merged) : merged,
    taskKeys: base.taskKeys,
    intents,
    intentsGuessed: intents.size > base.intents.size,
    ruleIntents: base.ruleIntents,
    project: base.project ?? cleanText(answer.project, 80),
    cycle:
      base.cycle ??
      (cycle && containsWord(normalize(question), normalize(cycle))
        ? cycle
        : null),
    followUp:
      base.followUp || (base.taskKeys.length === 0 && answer.followUp === true),
    earlier: base.earlier,
  };
}

/** At most this many tasks carry over from the previous answer. */
export const MAX_CARRIED_TASK_KEYS = 3;

const CITED_TASK_RULE = /\[[TC]:(\p{L}[\p{L}\p{N}]{0,9}-\d{1,7})[\]/]/gu;

/**
 * For a follow-up ("and what is its description?"), remembers what the
 * previous turn was about: its question (for project and member names) and
 * the tasks its answer cited, when it cited only a few. Many cited tasks
 * would be a guess, so then only the question carries over.
 */
export function withEarlierTurn(
  plan: AskPlan,
  last: { question: string; answer: string } | null | undefined,
): AskPlan {
  if (!plan.followUp || !last || plan.taskKeys.length > 0) return plan;
  const keys = [
    ...new Set([
      ...[...last.answer.matchAll(CITED_TASK_RULE)].map((match) =>
        (match[1] ?? "").toUpperCase(),
      ),
      ...taskKeysIn(last.question),
    ]),
  ].filter(Boolean);
  return {
    ...plan,
    earlier: {
      question: last.question,
      taskKeys: keys.length <= MAX_CARRIED_TASK_KEYS ? keys : [],
    },
  };
}

/**
 * The search terms as one web-search query: "a" or "b" or … Every term is
 * quoted: a bare last word would turn into an as-you-type prefix that the
 * search ANDs with the rest, so "a or b" would need both words.
 */
export function searchQueryOf(terms: readonly string[]): string {
  return terms
    .map((term) => term.replace(/["]/g, "").replace(/^-+/, "").trim())
    .filter(Boolean)
    .map((term) => `"${term}"`)
    .join(" or ");
}

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().trim();
}

function containsWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
    "u",
  ).test(haystack);
}

/**
 * The project a question names: by the plan's project text (name or key),
 * else by a project name written in the question. Names shorter than three
 * characters only match exactly, so "in QA" works but "a" never does.
 */
export function matchProject<
  T extends { id: string; name: string; slug: string },
>(projects: readonly T[], question: string, hint: string | null): T | null {
  const q = normalize(question);
  const h = hint ? normalize(hint) : null;
  if (h) {
    const exact = projects.find(
      (project) =>
        normalize(project.name) === h || normalize(project.slug) === h,
    );
    if (exact) return exact;
  }
  const byName = projects
    .filter((project) => {
      const name = normalize(project.name);
      return name.length >= 3 && containsWord(q, name);
    })
    .sort((a, b) => b.name.length - a.name.length);
  return byName[0] ?? null;
}

// First names that are also common English words only match when written
// with a capital letter ("Mark's tasks", not "mark it as done").
const COMMON_WORD_NAMES = new Set(
  `may will june april august mark bill max chase drew rob sue pat grace hope
joy faith rose dawn summer art ray frank jack page lane rich hunter miles sky
sage reed bob don amber ruby crystal penny holly ivy iris star`.split(/\s+/),
);

/** At most this many members filter one question. */
export const MAX_MATCHED_MEMBERS = 5;

/**
 * The workspace members a question names, as whole words and ignoring
 * case: full names first, then people's first names. Agents with a
 * several-word name only match by their full name, so "what's in triage"
 * never means a "Triage Bot". Task keys never match ("ADA-3" is not Ada).
 */
export function matchMembers<
  T extends { id: string; name: string; kind?: string | null },
>(members: readonly T[], question: string): T[] {
  const original = question.replace(TASK_KEY_RULE, " ").normalize("NFKC");
  let q = original.toLowerCase();
  const byLength = [...members].sort((a, b) => b.name.length - a.name.length);
  const out: T[] = [];
  for (const member of byLength) {
    const name = normalize(member.name);
    if (name.includes(" ") && containsWord(q, name)) out.push(member);
  }
  // A matched full name is used up: "Mia Member" is not every other Mia.
  for (const member of out) q = q.replaceAll(normalize(member.name), " ");
  for (const member of byLength) {
    if (out.includes(member)) continue;
    const name = normalize(member.name);
    const single = !name.includes(" ");
    if (member.kind === "agent" && !single) continue;
    const first = name.split(/\s+/)[0] ?? "";
    if (first.length < (single ? 2 : 3) || STOP_WORDS.has(first)) continue;
    if (!containsWord(q, first)) continue;
    if (
      COMMON_WORD_NAMES.has(first) &&
      !containsWord(original, first.charAt(0).toUpperCase() + first.slice(1))
    ) {
      continue;
    }
    out.push(member);
  }
  return out.slice(0, MAX_MATCHED_MEMBERS);
}

/** The words of member names, to keep out of the full-text search. */
export function nameWords(names: readonly string[]): string[] {
  return names.flatMap((name) =>
    normalize(name)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
}

/**
 * The cycle a question names: an exact name, else a name containing the
 * hint as a whole word ("12" finds "Cycle 12", not "Cycle 120").
 */
export function matchCycle<T extends { id: string; name: string }>(
  cycles: readonly T[],
  hint: string | null,
): T | null {
  if (!hint) return null;
  const h = normalize(hint);
  return (
    cycles.find((cycle) => normalize(cycle.name) === h) ??
    cycles.find((cycle) => containsWord(normalize(cycle.name), h)) ??
    null
  );
}

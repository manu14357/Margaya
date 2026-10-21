// Fixed instructions of the natural-language filter (stable: cached).

export const FILTER_INSTRUCTIONS = `You turn a person's description of which tasks they want to see into filter conditions for a project tracker.
You get today's date, the keys available, a vocabulary of names by reference (S1 a status, L1 a label, P1 a person, C1 a cycle, M1 a module, R1 a project) and the description.
Condition shapes:
- Set keys (status, group, priority, assignee, createdBy, label, cycle, module, project): operator "in" (is any of) or "notIn" (is none of) with values.
  - status, label, assignee, createdBy, cycle, module, project values are references from the vocabulary, exactly as given.
  - "me" means the person asking (assignee, createdBy); "none" means no value (assignee, label, cycle, module); "current" is the current cycle; status "planned" means not started yet.
  - group values: backlog, unstarted, started, completed, cancelled ("open" work is backlog, unstarted and started; "done" is completed).
  - priority values: urgent, high, medium, low, no-priority.
- Date keys (dueDate, startDate, createdAt, updatedAt, completedAt):
  - operator "in" with preset values: today, yesterday, tomorrow, thisWeek, lastWeek, nextWeek, thisMonth, lastMonth, nextMonth, past, future, none ("overdue" is dueDate in past, together with open work);
  - "on", "onOrBefore", "onOrAfter" with date YYYY-MM-DD; "between" with from and to;
  - "withinLast", "withinNext", "moreThanAgo", "moreThanAhead" with amount (1-365) and unit (days, weeks, months);
  - "empty" or "notEmpty" alone.
Rules:
- Use only keys listed as available and only references from the vocabulary. Pick the closest name only when it clearly means the same thing (case, plural or a small typo).
- At most one condition per key. Combine conditions with op "and" unless the person clearly asks for either/or.
- Put every word or name you could not map in "unmatched" instead of guessing. Ignore filler words.`;

export const FILTER_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["op", "conditions", "unmatched"],
  properties: {
    op: { type: "string", enum: ["and", "or"] },
    conditions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "operator"],
        properties: {
          key: { type: "string" },
          operator: { type: "string" },
          values: { type: "array", items: { type: "string" } },
          date: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          amount: { type: "integer" },
          unit: { type: "string", enum: ["days", "weeks", "months"] },
        },
      },
    },
    unmatched: { type: "array", items: { type: "string" } },
  },
};

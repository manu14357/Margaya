import { describe, expect, it } from "vitest";
import {
  heuristicPlan,
  matchCycle,
  matchMembers,
  matchProject,
  mergePlan,
  searchQueryOf,
  searchTermsOf,
  withEarlierTurn,
  withoutStatsWords,
} from "../../../apps/api/src/ai-ask/plan";
import type { AskSource } from "../../../apps/api/src/ai-ask/response";
import {
  citedRefs,
  structuredFilters,
  withoutDefaultGroup,
} from "../../../apps/api/src/ai-ask/retrieve";

describe("Ask plan rules", () => {
  it("reads overdue work in a project", () => {
    const plan = heuristicPlan("What's overdue in Website?");
    expect([...plan.intents]).toEqual(["overdue"]);
    expect(plan.project).toBe("Website");
    expect(plan.terms).toEqual(["website"]);
  });

  it("reads my open tasks without search noise", () => {
    const plan = heuristicPlan("my open tasks");
    expect([...plan.intents].sort()).toEqual(["mine", "open"]);
    expect(plan.terms).toEqual([]);
  });

  it("reads a cycle and blockers", () => {
    const plan = heuristicPlan("what's blocking cycle 12");
    expect(plan.intents.has("blocking")).toBe(true);
    expect(plan.cycle).toBe("12");
  });

  it("keeps task keys and distinctive words", () => {
    const plan = heuristicPlan("Why did we drop SSO from v2, see web-12?");
    expect(plan.taskKeys).toEqual(["WEB-12"]);
    expect(plan.terms).toEqual(["drop", "sso", "v2", "see", "web-12"]);
    expect(plan.intents.size).toBe(0);
  });

  it("reads counting questions as stats without search noise", () => {
    const plan = heuristicPlan("How many tasks are in each status?");
    expect([...plan.intents]).toEqual(["stats"]);
    expect(plan.terms).toEqual([]);
  });

  it("reads chart requests as stats", () => {
    const plan = heuristicPlan(
      "create a chart based on the status interactive",
    );
    expect([...plan.intents]).toEqual(["stats"]);
    expect(plan.terms).toEqual([]);
    for (const question of [
      "breakdown by priority",
      "open tasks per assignee",
      "show me a graph of the workload",
      "number of tasks by label",
      "give me stats for Website",
    ]) {
      expect(heuristicPlan(question).intents.has("stats")).toBe(true);
    }
  });

  it("does not read ordinary questions as stats", () => {
    for (const question of [
      "What's overdue in Website?",
      "Why did we drop SSO?",
      "account settings page",
      "what's blocking cycle 12",
    ]) {
      expect(heuristicPlan(question).intents.has("stats")).toBe(false);
    }
  });

  it("keeps distinctive words next to a stats intent", () => {
    const plan = heuristicPlan("How many payment bugs are open?");
    expect(plan.intents.has("stats")).toBe(true);
    expect(plan.terms).toEqual(["payment", "bugs"]);
    expect(withoutStatsWords(["Chart", "login"])).toEqual(["login"]);
  });

  it("keeps single CJK characters but drops single Latin letters", () => {
    expect(searchTermsOf("a 东 b")).toEqual(["东"]);
  });
});

describe("Ask planner merge", () => {
  it("prefers the planner's terms and uses its intents when the rules found none", () => {
    const question = "¿Qué está atrasado en el sprint 4 de Website?";
    const merged = mergePlan(
      heuristicPlan(question),
      {
        searchTerms: ["Website", " "],
        intents: ["overdue", "nonsense"],
        project: "Website",
        cycle: "4",
      },
      question,
    );
    expect(merged.terms).toEqual(["website"]);
    expect([...merged.intents]).toEqual(["overdue"]);
    expect(merged.intentsGuessed).toBe(true);
    expect(merged.project).toBe("Website");
    expect(merged.cycle).toBe("4");
  });

  it("ignores padded intents and invented cycles", () => {
    const question = "What changed recently?";
    const merged = mergePlan(
      heuristicPlan(question),
      {
        searchTerms: ["recent changes"],
        intents: ["recent", "high_priority", "due_soon"],
        project: "workspace",
        cycle: "annual",
      },
      question,
    );
    expect([...merged.intents]).toEqual(["recent"]);
    expect(merged.intentsGuessed).toBe(false);
    expect(merged.terms).toEqual(["changes"]);
    expect(merged.cycle).toBeNull();
  });

  it("takes the planner's stats intent only when the rules found none", () => {
    const question = "Wie viele Aufgaben gibt es pro Status?";
    const merged = mergePlan(
      heuristicPlan(question),
      {
        searchTerms: ["Aufgaben", "chart", "Status"],
        intents: ["stats"],
        project: "",
        cycle: "",
      },
      question,
    );
    // "Wie viele" is a counting rule of its own; the planner adds nothing.
    expect([...merged.intents]).toEqual(["stats"]);
    expect(merged.intentsGuessed).toBe(false);
    expect(merged.terms).toEqual(["aufgaben"]);

    const english = "What's overdue?";
    const kept = mergePlan(
      heuristicPlan(english),
      { searchTerms: [], intents: ["stats"], project: "", cycle: "" },
      english,
    );
    expect([...kept.intents]).toEqual(["overdue"]);
  });

  it("falls back to the rules when the planner gives nothing", () => {
    const base = heuristicPlan("payment retries");
    expect(mergePlan(base, null, "payment retries")).toBe(base);
    expect(
      mergePlan(
        base,
        { searchTerms: [], intents: [], project: "", cycle: "" },
        "payment retries",
      ).terms,
    ).toEqual(["payment", "retries"]);
  });
});

describe("Ask matching", () => {
  const projects = [
    { id: "1", name: "Website", slug: "web" },
    { id: "2", name: "QA", slug: "qa" },
    { id: "3", name: "Website Redesign", slug: "wr" },
  ];

  it("matches projects by hint, then the longest name in the question", () => {
    expect(matchProject(projects, "anything", "WEB")?.id).toBe("1");
    expect(matchProject(projects, "late in website redesign?", null)?.id).toBe(
      "3",
    );
    expect(matchProject(projects, "what about qa", null)).toBeNull();
    expect(matchProject(projects, "what about qa", "qa")?.id).toBe("2");
  });

  it("matches cycles by whole words", () => {
    const cycles = [
      { id: "a", name: "Cycle 120" },
      { id: "b", name: "Cycle 12" },
    ];
    expect(matchCycle(cycles, "12")?.id).toBe("b");
    expect(matchCycle(cycles, "cycle 120")?.id).toBe("a");
    expect(matchCycle(cycles, "7")).toBeNull();
  });

  it("quotes every search term", () => {
    expect(searchQueryOf(["payment", "-retries", 'say "hi"'])).toBe(
      '"payment" or "retries" or "say hi"',
    );
  });
});

describe("Ask citations", () => {
  const sources = [
    { ref: "T:WEB-12" },
    { ref: "P:Release plan" },
    { ref: "C:WEB-12/abc123" },
  ] as AskSource[];

  it("keeps known refs in order of first use and drops invented ones", () => {
    expect(
      citedRefs(
        "A [P:Release plan], B [T:WEB-12] [T:WEB-12], C [T:API-1] [C:WEB-12/abc123] [X:1]",
        sources,
      ),
    ).toEqual(["P:Release plan", "T:WEB-12", "C:WEB-12/abc123"]);
  });
});

describe("Ask finished work", () => {
  it("reads done, finished, closed and shipped as completed work", () => {
    for (const question of [
      "How many are done?",
      "What did we finish this week?",
      "Is WEB-4 done?",
      "which tasks were closed",
      "what shipped last week",
      "what did the team complete yesterday?",
    ]) {
      expect(heuristicPlan(question).intents.has("completed"), question).toBe(
        true,
      );
    }
    const week = heuristicPlan("What did we finish this week?");
    expect([...week.intents].sort()).toEqual(["completed", "recent"]);
    expect(week.terms).toEqual([]);
    expect(heuristicPlan("How many are done?").intents.has("stats")).toBe(true);
    expect(heuristicPlan("Is WEB-4 done?").taskKeys).toEqual(["WEB-4"]);
  });

  it("keeps open work and forecasts apart from finished work", () => {
    for (const question of [
      "what's not done yet?",
      "unfinished tasks",
      "when will we finish?",
      "what isn't done",
    ]) {
      expect(heuristicPlan(question).intents.has("completed"), question).toBe(
        false,
      );
    }
    expect(heuristicPlan("what's not done yet?").intents.has("open")).toBe(
      true,
    );
  });

  it("filters completed groups, newest first, and leaves a named task alone", () => {
    const done = structuredFilters(heuristicPlan("what did we finish?"));
    expect(done?.conditions).toEqual([
      { key: "group", operator: "in", values: ["completed"] },
    ]);
    expect(done?.orderBy).toBe("completedAt");
    expect(done?.openByDefault).toBe(false);
    // "Is WEB-4 done?" is answered by WEB-4's own status.
    expect(
      structuredFilters(heuristicPlan("Is WEB-4 done?"), { keyed: true }),
    ).toBeNull();
    // Open and closed together: no status filter.
    const both = structuredFilters(heuristicPlan("open and closed tasks"));
    expect(both?.conditions.some((c) => c.key === "group")).toBe(false);
  });
});

describe("Ask counting in every language", () => {
  it("reads 'how many' in the UI languages as stats", () => {
    for (const question of [
      "कितने काम पूरे हुए?",
      "¿cuántas tareas están en revisión?",
      "Quantas tarefas estão abertas?",
      "Combien de tâches sont en retard ?",
      "Wie viele Aufgaben sind offen?",
      "Hoeveel taken zijn klaar?",
      "Сколько задач просрочено?",
      "Скільки завдань відкрито?",
      "Колку задачи се отворени?",
      "Kaç görev tamamlandı?",
      "Neçə tapşırıq var?",
      "Berapa tugas yang selesai?",
      "Có bao nhiêu công việc?",
      "Πόσες εργασίες είναι ανοιχτές;",
      "完成了多少任务？",
      "タスクは何件ありますか？",
      "작업이 몇 개 있나요?",
      "Quante attività sono aperte?",
    ]) {
      const plan = heuristicPlan(question);
      expect(plan.intents.has("stats"), question).toBe(true);
      expect(plan.ruleIntents, question).toBe(false);
    }
  });

  it("adds the planner's intents next to a counting rule in another language", () => {
    const hindi = "कितने काम पूरे हुए?";
    const merged = mergePlan(
      heuristicPlan(hindi),
      {
        searchTerms: [],
        intents: ["completed", "stats"],
        project: "",
        cycle: "",
        followUp: false,
      },
      hindi,
    );
    expect([...merged.intents].sort()).toEqual(["completed", "stats"]);
    expect(merged.intentsGuessed).toBe(true);

    const spanish = "¿cuántas tareas están en revisión?";
    const quiet = mergePlan(
      heuristicPlan(spanish),
      { searchTerms: ["revisión"], intents: [], project: "", cycle: "" },
      spanish,
    );
    expect([...quiet.intents]).toEqual(["stats"]);
  });

  it("still ignores the planner's intents next to English keyword rules", () => {
    const question = "How many tasks are overdue?";
    const merged = mergePlan(
      heuristicPlan(question),
      { searchTerms: [], intents: ["mine"], project: "", cycle: "" },
      question,
    );
    expect([...merged.intents].sort()).toEqual(["overdue", "stats"]);
  });
});

describe("Ask assignees by name", () => {
  const members = [
    { id: "mia", name: "Mia Member", kind: "human" },
    { id: "mia2", name: "Mia Other", kind: "human" },
    { id: "adam", name: "Adam Smith", kind: "human" },
    { id: "ada", name: "Ada", kind: "human" },
    { id: "mark", name: "Mark Lee", kind: "human" },
    { id: "bot", name: "Triage Bot", kind: "agent" },
    { id: "scout", name: "Scout", kind: "agent" },
  ];
  const ids = (question: string) =>
    matchMembers(members, question).map((member) => member.id);

  it("matches full names first, then first names, ignoring case", () => {
    expect(ids("What's on Mia Member's plate?")).toEqual(["mia"]);
    expect(ids("tasks of Adam")).toEqual(["adam"]);
    expect(ids("tasks of adam")).toEqual(["adam"]);
    expect(ids("what is Mia working on").sort()).toEqual(["mia", "mia2"]);
    expect(ids("what does ada have")).toEqual(["ada"]);
  });

  it("matches whole words only and never task keys", () => {
    expect(ids("Adamant refactor")).toEqual([]);
    expect(ids("what about ADA-3?")).toEqual([]);
    expect(ids("mark WEB-2 as done")).toEqual([]);
    expect(ids("Mark's tasks")).toEqual(["mark"]);
  });

  it("matches agents with a several-word name by their full name", () => {
    expect(ids("what's in triage?")).toEqual([]);
    expect(ids("what is Triage Bot doing?")).toEqual(["bot"]);
    expect(ids("tasks for scout")).toEqual(["scout"]);
  });

  it("filters the task query by the named people", () => {
    const query = structuredFilters(heuristicPlan("tasks of Adam"), {
      assigneeIds: ["adam"],
    });
    expect(query?.conditions).toEqual([
      { key: "assignee", operator: "in", values: ["adam"] },
      {
        key: "group",
        operator: "in",
        values: ["backlog", "unstarted", "started"],
      },
    ]);
    // Open work was assumed: with nothing open, finished work shows.
    expect(query?.openByDefault).toBe(true);
    expect(query && withoutDefaultGroup(query).conditions).toEqual([
      { key: "assignee", operator: "in", values: ["adam"] },
    ]);
    const mine = structuredFilters(heuristicPlan("what's assigned to me?"));
    expect(mine?.conditions[0]).toEqual({
      key: "assignee",
      operator: "in",
      values: ["me"],
    });
    expect(mine?.openByDefault).toBe(true);
    // Open work was asked for: an empty answer stays empty.
    expect(
      structuredFilters(heuristicPlan("my open tasks"))?.openByDefault,
    ).toBe(false);
    expect(
      structuredFilters(heuristicPlan("what's overdue?"))?.openByDefault,
    ).toBe(false);
  });
});

describe("Ask follow-ups", () => {
  const last = {
    question: "What is WEB-2 about?",
    answer: "WEB-2 adds the login page [T:WEB-2], see [C:WEB-2/abc123].",
  };

  it("carries the few tasks the previous answer cited", () => {
    const plan = withEarlierTurn(
      heuristicPlan("And what is its description?"),
      last,
    );
    expect(plan.followUp).toBe(true);
    expect(plan.earlier).toEqual({
      question: last.question,
      taskKeys: ["WEB-2"],
    });
  });

  it("carries only the question when the answer cited many tasks", () => {
    const plan = withEarlierTurn(heuristicPlan("which of them are late?"), {
      question: "What's on Mia's plate?",
      answer: "[T:WEB-1] [T:WEB-2] [T:WEB-3] [T:WEB-4]",
    });
    expect(plan.earlier).toEqual({
      question: "What's on Mia's plate?",
      taskKeys: [],
    });
  });

  it("leaves a question with its own subject alone", () => {
    expect(
      withEarlierTurn(heuristicPlan("What is WEB-7 about?"), last).earlier,
    ).toBeNull();
    expect(
      withEarlierTurn(heuristicPlan("payment retries"), last).earlier,
    ).toBeNull();
    expect(
      withEarlierTurn(heuristicPlan("And its description?"), null).earlier,
    ).toBeNull();
  });

  it("takes the planner's word for a follow-up in another language", () => {
    const question = "¿Y cuál es su descripción?";
    const merged = mergePlan(
      heuristicPlan(question),
      {
        searchTerms: ["descripción"],
        intents: [],
        project: "",
        cycle: "",
        followUp: true,
      },
      question,
    );
    expect(withEarlierTurn(merged, last).earlier?.taskKeys).toEqual(["WEB-2"]);
  });
});

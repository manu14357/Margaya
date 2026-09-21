import { describe, expect, it } from "vitest";
import {
  assigneeGroupKeys,
  assigneesOfTask,
  assigneeUnion,
  embeddedAssignees,
  formatAssigneeSummary,
  isAssignedTo,
  matchesAssigneeFilter,
  maxAssigneeCount,
  overflowCount,
  patchAssigneeIds,
  peopleFromMembers,
  pickerOrder,
  resolveAssignees,
  revertAssigneePatch,
  sharedAssignees,
  withAssignees,
} from "./task-assignees";

const ana = { id: "ana", name: "Ana Silva", image: "ana.png" };
const ben = { id: "ben", name: "Ben Ito", image: null };
const cy = { id: "cy", name: "Cy Moss", image: null };

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key;

describe("assigneesOfTask", () => {
  it("reads the ordered list", () => {
    expect(
      assigneesOfTask({ userId: "ana", assigneeIds: ["ana", "ben"] }),
    ).toEqual(["ana", "ben"]);
  });

  it("falls back to the mirrored first assignee", () => {
    expect(assigneesOfTask({ userId: "ana" })).toEqual(["ana"]);
    expect(assigneesOfTask({ userId: null })).toEqual([]);
  });

  it("treats an empty list as unassigned even with a stale mirror", () => {
    expect(assigneesOfTask({ userId: "ana", assigneeIds: [] })).toEqual([]);
  });

  it("knows anyone in the list, not only the first", () => {
    const task = { userId: "ana", assigneeIds: ["ana", "ben"] };
    expect(isAssignedTo(task, "ben")).toBe(true);
    expect(isAssignedTo(task, "cy")).toBe(false);
    expect(isAssignedTo(task, null)).toBe(false);
  });
});

describe("matchesAssigneeFilter", () => {
  const shared = { userId: "ana", assigneeIds: ["ana", "ben"] };
  const unassigned = { userId: null, assigneeIds: [] };

  it("matches everything without values", () => {
    expect(matchesAssigneeFilter(shared, null)).toBe(true);
    expect(matchesAssigneeFilter(unassigned, [])).toBe(true);
  });

  it("matches when any assignee is selected", () => {
    expect(matchesAssigneeFilter(shared, ["ben"])).toBe(true);
    expect(matchesAssigneeFilter(shared, ["cy", "ana"])).toBe(true);
    expect(matchesAssigneeFilter(shared, ["cy"])).toBe(false);
  });

  it("matches only unassigned tasks with none", () => {
    expect(matchesAssigneeFilter(unassigned, ["none"])).toBe(true);
    expect(matchesAssigneeFilter(shared, ["none"])).toBe(false);
  });

  it("resolves me to the viewing user", () => {
    expect(matchesAssigneeFilter(shared, ["me"], "ben")).toBe(true);
    expect(matchesAssigneeFilter(shared, ["me"], "cy")).toBe(false);
    expect(matchesAssigneeFilter(shared, ["me"])).toBe(false);
  });

  it("mixes tokens and ids", () => {
    expect(matchesAssigneeFilter(unassigned, ["cy", "none"])).toBe(true);
    expect(matchesAssigneeFilter(shared, ["none", "me"], "ana")).toBe(true);
  });
});

describe("assigneeGroupKeys", () => {
  it("puts a task in every assignee's group", () => {
    expect(
      assigneeGroupKeys({ userId: "ana", assigneeIds: ["ana", "ben"] }),
    ).toEqual(["ana", "ben"]);
  });

  it("puts an unassigned task in the none group", () => {
    expect(assigneeGroupKeys({ userId: null })).toEqual(["none"]);
  });
});

describe("resolveAssignees", () => {
  it("prefers member data and keeps the order", () => {
    const entries = resolveAssignees(
      ["ben", "ana"],
      [ana, ben],
      [{ ...ana, name: "Old name" }],
    );
    expect(entries.map((entry) => entry.name)).toEqual([
      "Ben Ito",
      "Ana Silva",
    ]);
    expect(entries.every((entry) => !entry.isFormerMember)).toBe(true);
  });

  it("flags an assignee who left as a former member", () => {
    const [entry] = resolveAssignees(["cy"], [ana], [cy]);
    expect(entry).toMatchObject({
      name: "Cy Moss",
      isFormerMember: true,
      isUnknown: false,
    });
  });

  it("uses a placeholder for a person known only by id", () => {
    const [entry] = resolveAssignees(["ghost"], [ana]);
    expect(entry).toMatchObject({
      id: "ghost",
      name: "",
      isFormerMember: true,
      isUnknown: true,
    });
  });

  it("flags nobody while the member list is loading", () => {
    const [entry] = resolveAssignees(["cy"], undefined, [cy]);
    expect(entry.isFormerMember).toBe(false);
  });
});

describe("pickerOrder", () => {
  it("lists the assignees, then me, then everyone else, once each", () => {
    expect(pickerOrder(["cy", "ana"], [ana, ben, cy], "ben")).toEqual([
      "cy",
      "ana",
      "ben",
    ]);
  });

  it("puts me right after the assignees", () => {
    expect(pickerOrder([], [ana, ben, cy], "cy")).toEqual(["cy", "ana", "ben"]);
  });

  it("keeps former members who are still assigned", () => {
    expect(pickerOrder(["gone"], [ana], "ana")).toEqual(["gone", "ana"]);
  });

  it("does not add a viewer who is not a member", () => {
    expect(pickerOrder([], [ana], "admin")).toEqual(["ana"]);
  });
});

describe("formatAssigneeSummary", () => {
  it("reads Unassigned for nobody", () => {
    expect(formatAssigneeSummary([], t)).toBe("tasks:assignee.unassigned");
  });

  it("shows the one name", () => {
    expect(formatAssigneeSummary([ana], t)).toBe("Ana Silva");
  });

  it("shows the first name and how many others", () => {
    expect(formatAssigneeSummary([ana, ben, cy], t)).toBe(
      'tasks:assignees.nameAndMore:{"name":"Ana Silva","count":2}',
    );
  });

  it("names an unknown person", () => {
    expect(formatAssigneeSummary([{ name: "" }], t)).toBe(
      "tasks:assignees.unknownPerson",
    );
  });
});

describe("overflowCount", () => {
  it("counts what the faces leave out", () => {
    expect(overflowCount(5, 2)).toBe(3);
    expect(overflowCount(2, 2)).toBe(0);
    expect(overflowCount(1, 3)).toBe(0);
  });
});

describe("patchAssigneeIds and revertAssigneePatch", () => {
  it("removes first, then appends new people once", () => {
    expect(
      patchAssigneeIds(["ana", "ben"], { add: ["cy", "ana"], remove: ["ana"] }),
    ).toEqual(["ben", "cy", "ana"]);
    expect(patchAssigneeIds(["ana"], { add: ["ana"] })).toEqual(["ana"]);
  });

  it("undoes an addition and keeps a concurrent one", () => {
    // Before: [ana]. This request added ben; another added cy meanwhile.
    expect(
      revertAssigneePatch(["ana", "ben", "cy"], ["ana"], { add: ["ben"] }),
    ).toEqual(["ana", "cy"]);
  });

  it("puts a removed person back in their old place", () => {
    expect(
      revertAssigneePatch(["ana", "cy"], ["ana", "ben", "cy"], {
        remove: ["ben"],
      }),
    ).toEqual(["ana", "ben", "cy"]);
  });

  it("never removes someone who was already assigned", () => {
    expect(revertAssigneePatch(["ana"], ["ana"], { add: ["ana"] })).toEqual([
      "ana",
    ]);
  });
});

describe("withAssignees", () => {
  const task = {
    id: "task-1",
    userId: "ana",
    assigneeId: "ana",
    assigneeName: "Ana Silva",
    assigneeImage: "ana.png",
    assigneeIds: ["ana"],
    assignees: [ana],
  };

  it("sets the list and mirrors the new first assignee", () => {
    const next = withAssignees(task, ["ben", "ana"], [ben]);
    expect(next.assigneeIds).toEqual(["ben", "ana"]);
    expect(next.assignees).toEqual([ben, ana]);
    expect(next).toMatchObject({
      id: "task-1",
      userId: "ben",
      assigneeId: "ben",
      assigneeName: "Ben Ito",
      assigneeImage: null,
    });
  });

  it("clears the mirror when nobody is left", () => {
    expect(withAssignees(task, [])).toMatchObject({
      assigneeIds: [],
      assignees: [],
      userId: null,
      assigneeId: null,
      assigneeName: null,
      assigneeImage: null,
    });
  });
});

describe("multi-task helpers", () => {
  const tasks = [
    { userId: "ana", assigneeIds: ["ana", "ben"] },
    { userId: "ben", assigneeIds: ["ben"] },
    { userId: null, assigneeIds: [] },
  ];

  it("unions the assignees in first-seen order", () => {
    expect(assigneeUnion(tasks)).toEqual(["ana", "ben"]);
  });

  it("splits people on every task from people on some", () => {
    expect(sharedAssignees(tasks.slice(0, 2))).toEqual({
      all: ["ben"],
      some: ["ana"],
    });
  });

  it("finds the fullest task", () => {
    expect(maxAssigneeCount(tasks)).toBe(2);
    expect(maxAssigneeCount([])).toBe(0);
  });
});

describe("embeddedAssignees and peopleFromMembers", () => {
  it("falls back to the mirrored first assignee", () => {
    expect(
      embeddedAssignees({
        userId: "ana",
        assigneeName: "Ana Silva",
        assigneeImage: null,
      }),
    ).toEqual([{ id: "ana", name: "Ana Silva", image: null }]);
    expect(embeddedAssignees({ userId: null })).toEqual([]);
  });

  it("maps members once per query result", () => {
    const data = {
      members: [{ userId: "ana", user: { name: "Ana Silva", image: null } }],
    };
    const people = peopleFromMembers(data);
    expect(people).toEqual([{ id: "ana", name: "Ana Silva", image: null }]);
    expect(peopleFromMembers(data)).toBe(people);
    expect(peopleFromMembers(undefined)).toBeUndefined();
  });
});

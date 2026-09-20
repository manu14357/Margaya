import { describe, expect, it } from "vitest";
import type { ModuleStatus } from "@/types/module";
import {
  applyTaskMapChange,
  applyTaskModuleChange,
  mergeModuleTaskChanges,
} from "./membership";

const modules: Array<{ id: string; name: string; status: ModuleStatus }> = [
  { id: "m1", name: "billing", status: "planned" },
  { id: "m2", name: "Analytics", status: "in-progress" },
  { id: "m3", name: "Zeta", status: "backlog" },
];

describe("applyTaskModuleChange", () => {
  it("adds and removes modules, sorted by name ignoring case", () => {
    const refs = [{ id: "m3", name: "Zeta", status: "backlog" as const }];
    expect(
      applyTaskModuleChange(refs, modules, ["m1", "m2"], ["m3"]).map(
        (ref) => ref.name,
      ),
    ).toEqual(["Analytics", "billing"]);
  });

  it("skips unknown and duplicate ids", () => {
    const refs = [{ id: "m1", name: "billing", status: "planned" as const }];
    expect(applyTaskModuleChange(refs, modules, ["m1", "missing"], [])).toEqual(
      refs,
    );
  });
});

describe("applyTaskMapChange", () => {
  it("changes only the given task's pairs", () => {
    const entries = [
      { taskId: "t1", moduleId: "m1" },
      { taskId: "t2", moduleId: "m1" },
    ];
    expect(applyTaskMapChange(entries, "t1", ["m2", "m2"], ["m1"])).toEqual([
      { taskId: "t2", moduleId: "m1" },
      { taskId: "t1", moduleId: "m2" },
    ]);
  });
});

describe("mergeModuleTaskChanges", () => {
  it("concatenates the batches", () => {
    const batch = (added: string[], ignored: string[]) => ({
      moduleId: "m1",
      added,
      removed: [],
      unchanged: [],
      ignored,
    });
    expect(
      mergeModuleTaskChanges("m1", [batch(["a"], []), batch(["b"], ["x"])]),
    ).toEqual({
      moduleId: "m1",
      added: ["a", "b"],
      removed: [],
      unchanged: [],
      ignored: ["x"],
    });
  });
});

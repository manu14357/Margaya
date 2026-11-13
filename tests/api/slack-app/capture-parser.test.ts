import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCapture } from "../../../apps/api/src/slack-app/capture-parser";

// `/margaya add` must read text exactly like the web capture bar, so the
// parser is one file kept byte-identical in both apps.
describe("Slack capture parser", () => {
  it("is byte-identical to the web capture bar's parser", () => {
    const root = resolve(__dirname, "../../..");
    const api = readFileSync(
      resolve(root, "apps/api/src/slack-app/capture-parser.ts"),
      "utf8",
    );
    const web = readFileSync(
      resolve(root, "apps/web/src/components/task-draft/capture-parser.ts"),
      "utf8",
    );
    expect(api).toBe(web);
  });

  it("reads @, #, ! and date tokens", () => {
    // Wednesday 7 October 2026.
    const result = parseCapture("Fix login @ana #bug !high friday", {
      members: [
        { id: "u-ana", name: "Ana Lima" },
        { id: "u-ravi", name: "Ravi Iyer" },
      ],
      labels: [{ name: "Bug", color: "red" }],
      allowNewLabels: true,
      today: new Date(2026, 9, 7, 15, 30),
    });
    expect(result.title).toBe("Fix login");
    expect(result.assigneeIds).toEqual(["u-ana"]);
    expect(result.labels).toEqual([
      { name: "Bug", color: "red", isNew: false },
    ]);
    expect(result.priority).toBe("high");
    expect(result.dueDate).toBe("2026-10-09");
  });

  it("does not treat object prototype names as dates", () => {
    const result = parseCapture("constructor toString", {
      members: [],
      labels: [],
      allowNewLabels: false,
      today: new Date(2026, 9, 7),
    });
    expect(result.dueDate).toBeNull();
    expect(result.title).toBe("constructor toString");
  });
});

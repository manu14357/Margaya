import { describe, expect, it } from "vitest";
import {
  attachmentProblem,
  attachmentType,
  MAX_ATTACHMENT_BYTES,
} from "./ask-attachments";
import { slashItems } from "./ask-commands";
import {
  mentionQuery,
  removeMentionToken,
  slashQuery,
} from "./use-ask-mentions";

describe("composer triggers", () => {
  it("finds the @ token before the caret, only at a word start", () => {
    expect(mentionQuery("Who owns @web", 13)).toBe("web");
    expect(mentionQuery("@", 1)).toBe("");
    expect(mentionQuery("mail@example", 12)).toBeNull();
    expect(mentionQuery("@web and more", 13)).toBeNull();
    expect(removeMentionToken("Who owns @web now", 13)).toEqual({
      text: "Who owns  now",
      caret: 9,
    });
  });

  it("opens / commands only as the first word", () => {
    expect(slashQuery("/sum", 4)).toBe("sum");
    expect(slashQuery("say /sum", 8)).toBeNull();
    expect(slashQuery("/sum it", 7)).toBeNull();
  });

  it("matches commands by name or label, then skills", () => {
    const skills = [
      { id: "s1", name: "release-notes", description: "" },
      { id: "s2", name: "standup", description: "" },
    ];
    const label = (command: string) => `label-${command}`;
    expect(slashItems("su", skills, label)).toEqual([
      { kind: "command", id: "summarize" },
    ]);
    expect(slashItems("rel", skills, label).map((item) => item.kind)).toEqual([
      "skill",
    ]);
    expect(slashItems("", skills, label)).toHaveLength(8);
    expect(
      slashItems("", [], label, true).map((item) =>
        item.kind === "command" ? item.id : item.skill.id,
      ),
    ).not.toContain("create");
  });
});

describe("attachments", () => {
  it("accepts images and text up to 5 MB together, three at most", () => {
    expect(attachmentType({ name: "a.png", type: "image/png" })).toBe(
      "image/png",
    );
    expect(attachmentType({ name: "notes.md", type: "" })).toBe(
      "text/markdown",
    );
    expect(attachmentType({ name: "data.csv", type: "" })).toBe("text/csv");
    expect(attachmentType({ name: "a.pdf", type: "application/pdf" })).toBe(
      null,
    );
    const ok = { name: "a.txt", type: "text/plain", size: 10 };
    const none = { count: 0, bytes: 0 };
    expect(attachmentProblem(ok, none)).toBeNull();
    expect(attachmentProblem(ok, { count: 3, bytes: 30 })).toBe("count");
    expect(
      attachmentProblem({ ...ok, size: MAX_ATTACHMENT_BYTES + 1 }, none),
    ).toBe("size");
    expect(
      attachmentProblem(ok, { count: 1, bytes: MAX_ATTACHMENT_BYTES - 5 }),
    ).toBe("size");
    expect(
      attachmentProblem(
        { name: "x.exe", type: "application/x", size: 1 },
        none,
      ),
    ).toBe("type");
  });
});

import { describe, expect, it } from "vitest";
import { submitFeedbackBody } from "../../../apps/api/src/feedback/schema";

function parse(body: Record<string, unknown>) {
  return submitFeedbackBody.safeParse(body);
}

describe("submitFeedbackBody", () => {
  it("accepts a mood with an optional comment and coarse context", () => {
    const result = parse({
      kind: "general",
      format: "faces5",
      score: 4,
      comment: "  Boards feel fast  ",
      pageType: "board",
      appVersion: "1.42.0",
      client: "desktop",
    });
    expect(result.success).toBe(true);
    expect(result.data?.comment).toBe("Boards feel fast");
  });

  it("accepts a comment without a score for general feedback only", () => {
    expect(
      parse({ kind: "general", format: "faces5", comment: "Hi" }).success,
    ).toBe(true);
    expect(parse({ kind: "general", format: "faces5" }).success).toBe(false);
    expect(
      parse({ kind: "survey", format: "nps", comment: "Hi" }).success,
    ).toBe(false);
  });

  it("checks the score against the scale", () => {
    expect(parse({ kind: "survey", format: "nps", score: 0 }).success).toBe(
      true,
    );
    expect(parse({ kind: "survey", format: "nps", score: 10 }).success).toBe(
      true,
    );
    expect(parse({ kind: "survey", format: "faces3", score: 4 }).success).toBe(
      false,
    );
    expect(parse({ kind: "survey", format: "stars", score: 0 }).success).toBe(
      false,
    );
  });

  it("keeps thumbs for feature feedback, which names the feature", () => {
    expect(
      parse({ kind: "feature", format: "thumbs", score: 1, feature: "cycles" })
        .success,
    ).toBe(true);
    expect(parse({ kind: "feature", format: "thumbs", score: 1 }).success).toBe(
      false,
    );
    expect(
      parse({ kind: "feature", format: "faces5", score: 4, feature: "cycles" })
        .success,
    ).toBe(false);
    expect(parse({ kind: "general", format: "thumbs", score: 1 }).success).toBe(
      false,
    );
  });

  it("rejects unknown fields, page types and long comments", () => {
    expect(
      parse({ kind: "general", format: "faces5", score: 3, taskId: "t1" })
        .success,
    ).toBe(false);
    expect(
      parse({
        kind: "general",
        format: "faces5",
        score: 3,
        pageType: "/dashboard/x",
      }).success,
    ).toBe(false);
    expect(
      parse({
        kind: "general",
        format: "faces5",
        comment: "x".repeat(1001),
      }).success,
    ).toBe(false);
  });
});

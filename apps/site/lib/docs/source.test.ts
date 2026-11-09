import { describe, expect, it } from "vitest";
import { parseDocSource } from "./source";

describe("parseDocSource", () => {
  it("reads plain and quoted frontmatter values", () => {
    const { frontmatter, body } = parseDocSource(
      [
        "---",
        "title: emptyTaskTrash",
        "description: 'Empty a project''s trash'",
        'openapi: "POST /trash/project/{projectId}/empty"',
        "---",
        "Body",
      ].join("\n"),
    );

    expect(frontmatter).toEqual({
      title: "emptyTaskTrash",
      description: "Empty a project's trash",
      openapi: "POST /trash/project/{projectId}/empty",
    });
    expect(body).toBe("Body");
  });

  it("leaves doubled apostrophes alone outside single quotes", () => {
    const { frontmatter } = parseDocSource(
      "---\ntitle: \"Rock ''n roll\"\n---\n",
    );

    expect(frontmatter.title).toBe("Rock ''n roll");
  });
});

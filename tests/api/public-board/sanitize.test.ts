import { describe, expect, it } from "vitest";
import {
  countLinks,
  SANITIZE_MESSAGES,
  sanitizePublicComment,
  sanitizeRequestDescription,
  sanitizeRequestTitle,
  stripPublicMarkup,
} from "../../../apps/api/src/public-board/sanitize";

function refusal(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return {
      status: (error as { status: number }).status,
      message: (error as Error).message,
    };
  }
  throw new Error("expected a refusal");
}

const links = (n: number) =>
  Array.from({ length: n }, (_, i) => `https://l${i}.test`).join(" ");

describe("public board sanitizer", () => {
  it("flattens mention tags into plain text", () => {
    expect(
      stripPublicMarkup(
        'Hi <margaya-mention id="u1" label="Ada"></margaya-mention>!',
      ),
    ).toBe("Hi @Ada!");
    expect(
      stripPublicMarkup(
        '<margaya-mention id="u1" label="Ada">@Ada Lovelace</margaya-mention> look',
      ),
    ).toBe("@Ada Lovelace look");
  });

  it("removes HTML tags and comments but keeps their text", () => {
    expect(
      stripPublicMarkup(
        '<script>alert(1)</script><b>bold</b> <img src="x" onerror="y"><!-- hidden -->text',
      ),
    ).toBe("alert(1)bold text");
    expect(stripPublicMarkup("a <!-- unterminated")).toBe("a");
  });

  it("turns inline and reference images into links", () => {
    expect(stripPublicMarkup('![cat](https://x.test/c.png "t")')).toBe(
      "[cat](https://x.test/c.png)",
    );
    expect(stripPublicMarkup("![](https://x.test/c.png)")).toBe(
      "[https://x.test/c.png](https://x.test/c.png)",
    );
    expect(stripPublicMarkup("![logo][1]\n\n[1]: https://x.test/l.png")).toBe(
      "[logo][1]\n\n[1]: https://x.test/l.png",
    );
  });

  it("normalizes line endings and trims, keeping emoji and non-Latin text", () => {
    expect(stripPublicMarkup("  \r\nПривет \u{1f44b}\r\n日本\r  ")).toBe(
      "Привет \u{1f44b}\n日本",
    );
  });

  it("counts http, https and www links", () => {
    expect(
      countLinks("see http://a.test, https://b.test/x?y=1 and www.c.test"),
    ).toBe(3);
    expect(countLinks("no links here")).toBe(0);
  });

  it("refuses empty, long and link-heavy comments", () => {
    expect(refusal(() => sanitizePublicComment("   "))).toEqual({
      status: 400,
      message: SANITIZE_MESSAGES.emptyComment,
    });
    expect(refusal(() => sanitizePublicComment("<b></b>"))).toMatchObject({
      message: SANITIZE_MESSAGES.emptyComment,
    });
    expect(refusal(() => sanitizePublicComment("x".repeat(5001)))).toEqual({
      status: 400,
      message: SANITIZE_MESSAGES.longComment,
    });
    expect(sanitizePublicComment("x".repeat(5000))).toHaveLength(5000);
    expect(sanitizePublicComment(links(10))).toContain("https://l9.test");
    expect(refusal(() => sanitizePublicComment(links(11)))).toEqual({
      status: 400,
      message: SANITIZE_MESSAGES.commentLinks,
    });
    expect(refusal(() => sanitizeRequestDescription(links(11)))).toEqual({
      status: 400,
      message: SANITIZE_MESSAGES.requestLinks,
    });
  });

  it("reduces request titles to plain text within 255 characters", () => {
    expect(sanitizeRequestTitle("  **Dark**   <i>mode</i>\n please ")).toBe(
      "Dark mode please",
    );
    expect(refusal(() => sanitizeRequestTitle("<p></p>"))).toEqual({
      status: 400,
      message: SANITIZE_MESSAGES.emptyTitle,
    });
    expect(refusal(() => sanitizeRequestTitle("t".repeat(256)))).toEqual({
      status: 400,
      message: SANITIZE_MESSAGES.longTitle,
    });
    expect(sanitizeRequestDescription(undefined)).toBe("");
    expect(
      refusal(() => sanitizeRequestDescription("d".repeat(10_001))),
    ).toMatchObject({ status: 400 });
  });
});

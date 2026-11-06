import {
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleDot,
  CircleX,
  Search,
} from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getColumnIcon } from "./column";

describe("stored column icons", () => {
  it.each([
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
    "unknown-icon",
  ])("uses safe fallbacks for %s", (name) => {
    expect(getColumnIcon("to-do", false, name).type).toBe(Circle);
    expect(getColumnIcon("done", true, name).type).toBe(CheckCircle2);
    expect(getColumnIcon(name, false).type).toBe(Circle);
    expect(() =>
      renderToStaticMarkup(getColumnIcon("to-do", false, name)),
    ).not.toThrow();
  });
  it("keeps selected and default icons", () => {
    expect(getColumnIcon("to-do", false, "CircleDot").type).toBe(CircleDot);
    expect(getColumnIcon("in-progress").type).toBe(CircleDot);
    expect(getColumnIcon("done").type).toBe(CheckCircle2);
  });
});

describe("group icon fallback", () => {
  it("uses the custom icon, then the slug default, before the group", () => {
    expect(getColumnIcon("shipped", true, "Search", "cancelled").type).toBe(
      Search,
    );
    expect(getColumnIcon("to-do", false, null, "started").type).toBe(Circle);
  });

  it("uses the group icon when nothing else applies", () => {
    expect(getColumnIcon("wont-do", true, null, "cancelled").type).toBe(
      CircleX,
    );
    expect(getColumnIcon("icebox", false, null, "backlog").type).toBe(
      CircleDashed,
    );
  });

  it("falls back to final/open without a known group", () => {
    expect(getColumnIcon("shipped", true, null, "bogus").type).toBe(
      CheckCircle2,
    );
    expect(getColumnIcon("custom", false).type).toBe(Circle);
  });
});

describe("status tone", () => {
  it("wears the group hue by default", () => {
    expect(
      renderToStaticMarkup(getColumnIcon("x", false, "Search", "started")),
    ).toContain("text-(--status-started)");
  });

  it("shows the default review column in the review hue, as the board does", () => {
    const markup = renderToStaticMarkup(
      getColumnIcon("in-review", false, null, "started"),
    );
    expect(markup).toContain("text-(--status-review)");
    expect(markup).not.toContain("--status-started");
  });

  it("wears the hue it is given", () => {
    const markup = renderToStaticMarkup(
      getColumnIcon("qa", false, null, "started", {
        hue: "var(--status-review)",
      }),
    );
    expect(markup).toContain("color:var(--status-review)");
  });

  it("stays neutral for the board", () => {
    const markup = renderToStaticMarkup(
      getColumnIcon("x", true, "Search", "completed", { neutral: true }),
    );
    expect(markup).toContain("text-muted-foreground");
    expect(markup).not.toContain("--status-");
  });
});

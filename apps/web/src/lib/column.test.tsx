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

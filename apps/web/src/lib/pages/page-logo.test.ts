import { FileText, Rocket } from "lucide-react";
import { describe, expect, it } from "vitest";
import { pageLogoIcon, resolvePageLogo } from "./page-logo";
import { pageEntityLink, pagePath, parsePageUrl } from "./page-paths";

describe("resolvePageLogo", () => {
  it("shows an emoji as is", () => {
    expect(resolvePageLogo("emoji", "🚀")).toEqual({
      kind: "emoji",
      emoji: "🚀",
    });
  });

  it("resolves catalog icons and falls back to FileText", () => {
    expect(pageLogoIcon("icon", "Rocket")).toBe(Rocket);
    expect(pageLogoIcon("icon", "NotAnIcon")).toBe(FileText);
    expect(pageLogoIcon(null, null)).toBe(FileText);
    expect(pageLogoIcon("emoji", "🚀")).toBe(FileText);
  });
});

describe("page paths", () => {
  it("builds and parses editor URLs", () => {
    const path = pagePath("w1", "p1", "page_1");
    expect(path).toBe("/dashboard/workspace/w1/project/p1/pages/page_1");
    expect(parsePageUrl(`https://margaya.test${path}?panel=info`)).toEqual({
      workspaceId: "w1",
      projectId: "p1",
      pageId: "page_1",
    });
    expect(
      parsePageUrl(
        "https://margaya.test/dashboard/workspace/w1/project/p1/task/t1",
      ),
    ).toBeNull();
  });

  it("opens favorites and recents in the editor", () => {
    const entity = { type: "page", id: "pg", icon: "Rocket", projectId: "p1" };
    expect(pageEntityLink.path(entity, "w1")).toBe(
      "/dashboard/workspace/w1/project/p1/pages/pg",
    );
    expect(pageEntityLink.icon(entity)).toBe(Rocket);
    expect(pageEntityLink.icon({ ...entity, icon: "🚀" })).toBe(FileText);
    expect(
      pageEntityLink.path({ ...entity, projectId: null }, "w1"),
    ).toBeNull();
  });
});

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AskSource } from "@/fetchers/ai/ask";
import { AskAnswer } from "./ask-answer";

vi.setConfig({ testTimeout: 15_000 });

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { resolvedLanguage: "en-US", language: "en-US" },
  }),
}));

afterEach(() => {
  cleanup();
});

const task: AskSource = {
  ref: "T:WEB-12",
  kind: "task",
  id: "t1",
  title: "WEB-12 Fix login",
  url: "/dashboard/workspace/w1/project/p1/task/t1",
  projectId: "p1",
  updatedAt: null,
};
const sources = new Map([[task.ref, task]]);

function show(text: string) {
  return render(<AskAnswer text={text} sources={sources} onOpen={() => {}} />);
}

describe("AskAnswer", () => {
  it("draws a chart block as a chart, not JSON", () => {
    const { container } = show(
      [
        "Most tasks are open.",
        "```chart",
        '{"type":"donut","title":"Tasks by status","data":[{"label":"To do","value":4},{"label":"Done","value":2}],"unit":"tasks"}',
        "```",
      ].join("\n"),
    );
    expect(screen.getByText("Tasks by status")).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: 'ai:ask.chartLabel {"title":"Tasks by status"}',
      }),
    ).toBeTruthy();
    expect(container.textContent).not.toContain('"type"');
  });

  it("shows a placeholder while a chart streams and when it is invalid", () => {
    const { container, rerender } = show('```chart\n{"type":"bar"');
    expect(screen.getByRole("status", { name: "ai:ask.chartLoading" }));
    expect(container.textContent).not.toContain('"type"');
    rerender(
      <AskAnswer
        text={"```chart\n{oops}\n```"}
        sources={sources}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText("ai:ask.chartInvalid")).toBeTruthy();
  });

  it("draws a two-series line chart with a legend", () => {
    show(
      [
        "```chart",
        JSON.stringify({
          type: "line",
          title: "Created vs completed",
          series: [
            {
              name: "Created",
              data: [
                { label: "Mon", value: 3 },
                { label: "Tue", value: 5 },
              ],
            },
            {
              name: "Completed",
              data: [
                { label: "Mon", value: 1 },
                { label: "Tue", value: 4 },
              ],
            },
          ],
        }),
        "```",
      ].join("\n"),
    );
    expect(screen.getByText("Created vs completed")).toBeTruthy();
    expect(screen.getAllByText("Created").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
  });

  it("opens a web source in a new tab without an opener", () => {
    const web: AskSource = {
      ref: "W:1",
      kind: "web",
      id: "w1",
      title: "Release notes",
      url: "https://www.example.com/notes",
      projectId: null,
      updatedAt: null,
    };
    render(
      <AskAnswer
        text="See [W:1]."
        sources={new Map([[web.ref, web]])}
        onOpen={() => {}}
      />,
    );
    const link = screen.getByRole("link", {
      name: 'ai:ask.openSource {"title":"Release notes"}',
    });
    expect(link.getAttribute("href")).toBe(web.url);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.textContent).toContain("example.com");
  });

  it("renders tables with citation chips in their cells", () => {
    show("| Task | Days |\n| --- | --- |\n| [T:WEB-12] | 3 |");
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(2);
    expect(
      within(table).getByRole("link", {
        name: 'ai:ask.openSource {"title":"WEB-12 Fix login"}',
      }),
    ).toBeTruthy();
  });
});

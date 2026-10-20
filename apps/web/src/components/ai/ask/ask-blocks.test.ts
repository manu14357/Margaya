import { describe, expect, it } from "vitest";
import { MAX_CHART_POINTS, parseAskChart, splitAskAnswer } from "./ask-blocks";
import { chartsAsText } from "./ask-citations";

const chartJson = JSON.stringify({
  type: "bar",
  title: "Tasks by status",
  data: [
    { label: "To do", value: 4 },
    { label: "Done", value: 2 },
  ],
  unit: "tasks",
});

describe("parseAskChart", () => {
  it("reads a valid chart", () => {
    expect(parseAskChart(chartJson)).toEqual({
      type: "bar",
      title: "Tasks by status",
      data: [
        { label: "To do", value: 4 },
        { label: "Done", value: 2 },
      ],
      unit: "tasks",
    });
  });

  it("reads pie as a donut, numeric strings and a missing unit", () => {
    expect(
      parseAskChart(
        '{"type":"pie","title":"Mix","data":[{"label":"A","value":"3"}]}',
      ),
    ).toEqual({
      type: "donut",
      title: "Mix",
      data: [{ label: "A", value: 3 }],
      unit: null,
    });
  });

  it("rejects malformed or unsafe charts", () => {
    const point = { label: "A", value: 1 };
    const of = (spec: unknown) => parseAskChart(JSON.stringify(spec));
    expect(parseAskChart("{not json")).toBeNull();
    expect(parseAskChart("[]")).toBeNull();
    expect(of({ type: "radar", title: "x", data: [point] })).toBeNull();
    expect(of({ type: "bar", title: "x", data: [] })).toBeNull();
    expect(
      of({
        type: "bar",
        title: "x",
        data: Array.from({ length: MAX_CHART_POINTS + 1 }, () => point),
      }),
    ).toBeNull();
    expect(
      of({ type: "bar", title: "x", data: [{ label: "A", value: "many" }] }),
    ).toBeNull();
    expect(
      of({ type: "bar", title: "x", data: [{ label: "A", value: -1 }] }),
    ).toBeNull();
    expect(
      of({ type: "bar", title: "x", data: [{ label: " ", value: 1 }] }),
    ).toBeNull();
    // Infinity is not JSON; a huge exponent parses to it.
    expect(
      parseAskChart('{"type":"bar","data":[{"label":"A","value":1e999}]}'),
    ).toBeNull();
  });

  it("reads several series aligned over their labels", () => {
    const chart = parseAskChart(
      JSON.stringify({
        type: "line",
        title: "Created vs completed",
        unit: "tasks",
        series: [
          {
            name: "Created",
            data: [
              { label: "W1", value: 3 },
              { label: "W2", value: 5 },
            ],
          },
          { name: "Completed", data: [{ label: "W2", value: 4 }] },
        ],
      }),
    );
    expect(chart).toEqual({
      type: "line",
      title: "Created vs completed",
      unit: "tasks",
      data: [
        { label: "W1", value: 3 },
        { label: "W2", value: 9 },
      ],
      series: [
        { name: "Created", values: [3, 5] },
        { name: "Completed", values: [null, 4] },
      ],
    });
    expect(
      chartsAsText(
        `\`\`\`chart\n${JSON.stringify({
          type: "bar",
          title: "T",
          series: [
            { name: "A", data: [{ label: "x", value: 1 }] },
            { name: "B", data: [{ label: "x", value: 2 }] },
          ],
        })}\n\`\`\``,
      ),
    ).toBe("T\n- x: A 1, B 2");
  });

  it("reads one series as plain data and rejects bad series", () => {
    const of = (spec: unknown) => parseAskChart(JSON.stringify(spec));
    expect(
      of({
        type: "bar",
        title: "One",
        series: [{ name: "Only", data: [{ label: "a", value: 2 }] }],
      }),
    ).toEqual({
      type: "bar",
      title: "One",
      unit: null,
      data: [{ label: "a", value: 2 }],
    });
    expect(of({ type: "line", title: "x", series: [] })).toBeNull();
    expect(
      of({
        type: "line",
        title: "x",
        series: Array.from({ length: 6 }, (_, index) => ({
          name: String(index),
          data: [{ label: "a", value: 1 }],
        })),
      }),
    ).toBeNull();
    expect(
      of({
        type: "line",
        title: "x",
        series: [{ name: "A", data: [{ label: "a", value: -1 }] }],
      }),
    ).toBeNull();
  });
});

describe("splitAskAnswer", () => {
  it("splits Markdown, a chart and the sentence after it", () => {
    const blocks = splitAskAnswer(
      `Here is the breakdown.\n\n\`\`\`chart\n${chartJson}\n\`\`\`\n\nMost work is still to do.`,
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "markdown",
      "chart",
      "markdown",
    ]);
    expect(blocks[1]).toMatchObject({ pending: false });
    expect(blocks[1]?.kind === "chart" && blocks[1].chart?.type).toBe("bar");
  });

  it("keeps a streaming chart pending and never shows its JSON", () => {
    const blocks = splitAskAnswer('Counting.\n```chart\n{"type":"bar","da');
    expect(blocks).toEqual([
      { kind: "markdown", text: "Counting." },
      { kind: "chart", chart: null, pending: true },
    ]);
    expect(splitAskAnswer("Counting.\n```cha").at(-1)).toEqual({
      kind: "chart",
      chart: null,
      pending: true,
    });
  });

  it("marks a closed chart with bad JSON as invalid", () => {
    expect(splitAskAnswer("```chart\n{oops}\n```")).toEqual([
      { kind: "chart", chart: null, pending: false },
    ]);
  });

  it("reads pipe tables, but not inside other code fences", () => {
    const blocks = splitAskAnswer(
      [
        "Counts:",
        "| Status | Tasks |",
        "| --- | ---: |",
        "| To do | 4 |",
        "| A \\| B | 2 |",
        "",
        "```",
        "| a | b |",
        "| - | - |",
        "```",
      ].join("\n"),
    );
    expect(blocks[0]).toEqual({ kind: "markdown", text: "Counts:" });
    expect(blocks[1]).toEqual({
      kind: "table",
      header: ["Status", "Tasks"],
      rows: [
        ["To do", "4"],
        ["A | B", "2"],
      ],
    });
    expect(blocks[2]?.kind).toBe("markdown");
    expect(blocks).toHaveLength(3);
  });

  it("pads short rows and ignores a header without a matching delimiter", () => {
    const table = splitAskAnswer("| a | b |\n|---|---|\n| 1 |");
    expect(table[0]).toEqual({
      kind: "table",
      header: ["a", "b"],
      rows: [["1", ""]],
    });
    expect(splitAskAnswer("| a | b |\n|---|")[0]?.kind).toBe("markdown");
  });
});

describe("chartsAsText", () => {
  it("turns charts into plain lists for the clipboard", () => {
    expect(
      chartsAsText(`Look:\n\`\`\`chart\n${chartJson}\n\`\`\`\nDone.`),
    ).toBe("Look:\nTasks by status\n- To do: 4 tasks\n- Done: 2 tasks\nDone.");
    expect(chartsAsText("```chart\n{oops}\n```")).toBe("```chart\n{oops}\n```");
  });
});

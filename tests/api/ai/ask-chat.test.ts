import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import type { AiResult, AiStream } from "../../../apps/api/src/ai/gateway";
import { aiInstanceConfigOf } from "../../../apps/api/src/ai/instance-config";
import {
  anthropicParams,
  supportsThinkingSummary,
} from "../../../apps/api/src/ai/provider/anthropic";
import {
  createFakeProvider,
  setFakeResponder,
} from "../../../apps/api/src/ai/provider/fake";
import {
  createOpenAiCompatibleProvider,
  thinkFilter,
} from "../../../apps/api/src/ai/provider/openai-compatible";
import { respondWithAi } from "../../../apps/api/src/ai/sse";
import type { ChatDelta, ChatRequest } from "../../../apps/api/src/ai/types";
import {
  MAX_ASK_ATTACHMENT_BYTES,
  prepareAskAttachments,
} from "../../../apps/api/src/ai-ask/attachments";
import {
  cleanFollowUps,
  followUpCutter,
  splitFollowUps,
  withoutFollowUps,
} from "../../../apps/api/src/ai-ask/followups";
import { webItems } from "../../../apps/api/src/ai-ask/index";
import { heuristicPlan } from "../../../apps/api/src/ai-ask/plan";
import { citedRefs, sourcesOf } from "../../../apps/api/src/ai-ask/retrieve";
import { askBodySchema } from "../../../apps/api/src/ai-ask/schema";
import {
  formatTrend,
  trendBuckets,
  trendUnitOf,
} from "../../../apps/api/src/ai-ask/trend";
import { formatMemoryNotes } from "../../../apps/api/src/ai-memory-notes/load";
import { skillInstructions } from "../../../apps/api/src/ai-skills/load";
import {
  cleanWebText,
  normalizeWebResults,
} from "../../../apps/api/src/ai-web-search";
import { resolveInstanceSettings } from "../../../apps/api/src/instance-settings/resolve";

const request = (overrides: Partial<ChatRequest> = {}): ChatRequest => ({
  model: "fake-balanced",
  system: ["Stable rules."],
  messages: [{ role: "user", content: "Summarize the sprint" }],
  maxTokens: 256,
  ...overrides,
});

async function collect(stream: AsyncIterable<ChatDelta>) {
  const deltas: ChatDelta[] = [];
  for await (const delta of stream) deltas.push(delta);
  const join = (type: "text" | "reasoning") =>
    deltas.map((delta) => (delta.type === type ? delta.text : "")).join("");
  return { deltas, text: join("text"), reasoning: join("reasoning") };
}

function sse(chunks: unknown[]) {
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
}

afterEach(() => setFakeResponder(null));

describe("reasoning from providers", () => {
  it("routes <think> blocks to reasoning, tags split across chunks", () => {
    const filter = thinkFilter();
    let visible = "";
    let reasoning = "";
    for (const piece of [
      "Hi <thi",
      "nk>plan the ",
      "answer</thi",
      "nk>\nthere",
    ]) {
      visible += filter.push(piece);
      reasoning += filter.takeReasoning();
    }
    visible += filter.flush();
    reasoning += filter.takeReasoning();
    expect(visible).toBe("Hi there");
    expect(reasoning).toBe("plan the answer");
  });

  it("streams reasoning_content, reasoning and <think> text as reasoning deltas", async () => {
    const body = sse([
      { choices: [{ delta: { reasoning_content: "First " } }] },
      { choices: [{ delta: { reasoning: "second. " } }] },
      { choices: [{ delta: { content: "<think>third</think>" } }] },
      { choices: [{ delta: { content: "Answer" }, finish_reason: "stop" }] },
    ]);
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "http://ollama:11434/v1",
      allowPrivate: true,
      fetchImpl: async () =>
        new Response(body, {
          headers: { "content-type": "text/event-stream" },
        }),
    });
    const out = await collect(
      provider.stream(request(), new AbortController().signal),
    );
    expect(out.text).toBe("Answer");
    expect(out.reasoning).toBe("First second. third");
    const firstText = out.deltas.findIndex((delta) => delta.type === "text");
    const lastReasoning = out.deltas.findLastIndex(
      (delta) => delta.type === "reasoning",
    );
    expect(lastReasoning).toBeLessThan(firstText);
  });

  it("asks Claude for a thinking summary only when reasoning is wanted", () => {
    expect(
      anthropicParams(request({ model: "claude-sonnet-5-5" })),
    ).not.toHaveProperty("thinking");
    expect(
      anthropicParams(request({ model: "claude-sonnet-5-5", reasoning: true })),
    ).toMatchObject({ thinking: { type: "adaptive", display: "summarized" } });
    expect(
      anthropicParams(request({ model: "claude-haiku-4-5", reasoning: true })),
    ).not.toHaveProperty("thinking");
    expect(supportsThinkingSummary("claude-opus-5-5")).toBe(true);
    expect(supportsThinkingSummary("claude-sonnet-4-5")).toBe(false);
    expect(supportsThinkingSummary("claude-sonnet-4-6")).toBe(true);
  });

  it("lets the fake provider think, with text only when asked", async () => {
    setFakeResponder(() => ({ reasoning: "Let me see.", text: "Done." }));
    const provider = createFakeProvider();
    const hidden = await collect(
      provider.stream(request(), new AbortController().signal),
    );
    expect(hidden.text).toBe("Done.");
    expect(hidden.reasoning).toBe("");
    expect(hidden.deltas.some((delta) => delta.type === "reasoning")).toBe(
      true,
    );
    const shown = await collect(
      provider.stream(
        request({ reasoning: true }),
        new AbortController().signal,
      ),
    );
    expect(shown.reasoning).toBe("Let me see.");
  });
});

function fakeStream(deltas: ChatDelta[], result: Partial<AiResult>): AiStream {
  const full: AiResult = {
    text: deltas
      .map((delta) => (delta.type === "text" ? delta.text : ""))
      .join(""),
    toolCalls: [],
    stop: "end_turn",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    costMicros: 0,
    meta: {
      provider: "fake",
      model: "fake-balanced",
      tier: "balanced",
      dataTier: "private",
      destination: "cloud",
      redactions: 0,
    },
    reasoningMs: 1200,
    ...result,
  };
  return {
    meta: full.meta,
    deltas: (async function* () {
      for (const delta of deltas) yield delta;
    })(),
    result: Promise.resolve(full),
    cancel() {},
  };
}

function events(text: string) {
  return text
    .split(/\n\n/)
    .map((block) => ({
      event: /^event: (.+)$/m.exec(block)?.[1],
      data: /^data: (.+)$/m.exec(block)?.[1],
    }))
    .filter((entry) => entry.event)
    .map((entry) => ({
      event: entry.event as string,
      data: JSON.parse(entry.data ?? "null") as Record<string, unknown>,
    }));
}

describe("reasoning over SSE", () => {
  const deltas: ChatDelta[] = [
    { type: "reasoning", text: "Thinking " },
    { type: "reasoning", text: "hard" },
    { type: "text", text: "Answer" },
    { type: "stop", reason: "end_turn" },
  ];

  async function run(showReasoning: boolean, accept = "text/event-stream") {
    const app = new Hono();
    app.get("/", (c) =>
      respondWithAi(c, fakeStream(deltas, {}), { showReasoning }),
    );
    return app.request("/", { headers: { accept } });
  }

  it("sends only that the model is thinking, and its duration, by default", async () => {
    const list = events(await (await run(false)).text());
    const reasoning = list.filter((entry) => entry.event === "reasoning");
    expect(reasoning).toEqual([{ event: "reasoning", data: { text: "" } }]);
    expect(list.at(-1)).toMatchObject({
      event: "done",
      data: { reasoningMs: 1200 },
    });
  });

  it("streams the reasoning text when the instance shows it", async () => {
    const list = events(await (await run(true)).text());
    expect(
      list
        .filter((entry) => entry.event === "reasoning")
        .map((entry) => entry.data.text)
        .join(""),
    ).toBe("Thinking hard");
  });

  it("puts reasoningMs in the JSON fallback, never the reasoning text", async () => {
    const body = (await (await run(true, "application/json")).json()) as Record<
      string,
      unknown
    >;
    expect(body.reasoningMs).toBe(1200);
    expect(body.text).toBe("Answer");
    expect(JSON.stringify(body)).not.toContain("Thinking");
  });
});

describe("follow-up suggestions", () => {
  it("splits the block off the answer and keeps charts and citations", () => {
    const answer =
      'Two tasks [T:WEB-1].\n```chart\n{"type":"bar","title":"x","data":[]}\n```\n```followups\n["Who owns them?","Chart it [T:WEB-1]"]\n```';
    const split = splitFollowUps(answer);
    expect(split.text).toBe(
      'Two tasks [T:WEB-1].\n```chart\n{"type":"bar","title":"x","data":[]}\n```',
    );
    expect(split.followUps).toEqual(["Who owns them?", "Chart it"]);
  });

  it("accepts a list instead of JSON and caps at two", () => {
    expect(
      splitFollowUps("A\n```followups\n- One?\n- Two?\n- Three?\n- Four?\n```")
        .followUps,
    ).toEqual(["One?", "Two?"]);
    expect(cleanFollowUps("nope")).toEqual([]);
    expect(splitFollowUps("No block").followUps).toEqual([]);
  });

  it("treats a final ```json list of questions as follow-ups", () => {
    const answer =
      'One task in review.\n```json\n["Which task is it?", "Who owns it?"]\n```';
    expect(splitFollowUps(answer)).toEqual({
      text: "One task in review.",
      followUps: ["Which task is it?", "Who owns it?"],
    });
    // Ordinary JSON content (not a list of strings, or not at the end) stays.
    const data = 'Config:\n```json\n{"a":1}\n```';
    expect(splitFollowUps(data)).toEqual({ text: data, followUps: [] });
    const middle = '```json\n["x"]\n```\nThen more text.';
    expect(splitFollowUps(middle).text).toBe(middle);
  });

  it("streams a ```json block unless it ends the answer as follow-ups", () => {
    const run = (chunks: string[]) => {
      const cutter = followUpCutter();
      return chunks.map((c) => cutter.push(c)).join("") + cutter.flush();
    };
    expect(run(["One task.\n```js", 'on\n["Who?",', ' "Why?"]\n```'])).toBe(
      "One task.\n",
    );
    expect(run(["Data:\n```json\n", '{"a":1}\n```\n', "More."])).toBe(
      'Data:\n```json\n{"a":1}\n```\nMore.',
    );
    expect(run(["Data:\n```json\n", '{"a":1}\n```'])).toBe(
      'Data:\n```json\n{"a":1}\n```',
    );
  });

  it("reads the array through stray markup some models add", () => {
    expect(
      splitFollowUps(
        'A\n```followups\n["Show by status group?","How many are overdue?"] </rfl:parameter>\n```',
      ).followUps,
    ).toEqual(["Show by status group?", "How many are overdue?"]);
    expect(
      splitFollowUps("A\n```followups\n- One?\n</rfl:parameter>\n```")
        .followUps,
    ).toEqual(["One?"]);
  });

  it("never streams the block, even split across chunks", () => {
    const cutter = followUpCutter();
    let out = "";
    for (const piece of ["Hello ``", "`follow", 'ups\n["a"]', "\n```"]) {
      out += cutter.push(piece);
    }
    out += cutter.flush();
    expect(out).toBe("Hello");
    const plain = followUpCutter();
    expect(plain.push("code ``") + plain.push("`js") + plain.flush()).toBe(
      "code ```js",
    );
  });

  it("cuts the block out of a stream and its result", async () => {
    const stream = fakeStream(
      [
        { type: "text", text: "Answer " },
        { type: "text", text: '```followups\n["Next?"]\n```' },
        { type: "stop", reason: "end_turn" },
      ],
      {},
    );
    const wrapped = withoutFollowUps(stream);
    const out = await collect(wrapped.stream.deltas);
    expect(out.text).toBe("Answer");
    expect((await wrapped.stream.result).text).toBe("Answer");
    expect(wrapped.followUps()).toEqual(["Next?"]);
  });
});

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const GIF = Buffer.from(
  "GIF89a\x01\x00\x01\x00\x00\x00\x00;",
  "latin1",
).toString("base64");

describe("Ask attachments", () => {
  it("passes images and decodes text files", () => {
    const prepared = prepareAskAttachments([
      { name: "shot.png", mediaType: "image/png", data: PNG },
      { name: "anim.gif", mediaType: "image/gif", data: GIF },
      {
        name: "notes.md",
        mediaType: "text/markdown",
        data: Buffer.from("# Notes\nRelease Thursday").toString("base64"),
      },
    ]);
    expect(prepared.images.map((image) => image.mediaType)).toEqual([
      "image/png",
      "image/gif",
    ]);
    expect(prepared.texts).toEqual([
      {
        name: "notes.md",
        mediaType: "text/markdown",
        text: "# Notes\nRelease Thursday",
      },
    ]);
  });

  it("refuses wrong types, fake images, bad text and too much", () => {
    const text = (data: string) => Buffer.from(data).toString("base64");
    expect(() =>
      prepareAskAttachments([
        { name: "a.pdf", mediaType: "application/pdf", data: text("%PDF") },
      ]),
    ).toThrow(/only images/);
    expect(() =>
      prepareAskAttachments([
        { name: "a.png", mediaType: "image/png", data: text("not a png") },
      ]),
    ).toThrow(/only PNG/);
    expect(() =>
      prepareAskAttachments([
        {
          name: "a.txt",
          mediaType: "text/plain",
          data: Buffer.from([0xff, 0xfe, 0xfd]).toString("base64"),
        },
      ]),
    ).toThrow(/UTF-8/);
    expect(() =>
      prepareAskAttachments(
        Array.from({ length: 4 }, () => ({
          name: "a.txt",
          mediaType: "text/plain",
          data: text("x"),
        })),
      ),
    ).toThrow(/At most 3/);
    expect(() =>
      prepareAskAttachments([
        {
          name: "big.txt",
          mediaType: "text/plain",
          data: Buffer.alloc(MAX_ASK_ATTACHMENT_BYTES + 1, 97).toString(
            "base64",
          ),
        },
      ]),
    ).toThrow(/5 MB/);
  });

  it("validates the new Ask body fields", () => {
    const base = { workspaceId: "w", question: "q" };
    expect(
      askBodySchema.safeParse({
        ...base,
        context: [{ kind: "cycle", id: "c1" }],
        webSearch: true,
        skillId: "s1",
      }).success,
    ).toBe(true);
    expect(
      askBodySchema.safeParse({
        ...base,
        context: Array.from({ length: 11 }, (_, i) => ({
          kind: "task",
          id: `${i}`,
        })),
      }).success,
    ).toBe(false);
    expect(
      askBodySchema.safeParse({
        ...base,
        context: [{ kind: "label", id: "x" }],
      }).success,
    ).toBe(false);
  });
});

describe("web results", () => {
  it("cleans text and keeps only http(s) results, deduplicated", () => {
    expect(cleanWebText("<b>Fast</b> &amp; small\n page", 100)).toBe(
      "Fast & small page",
    );
    expect(
      normalizeWebResults(
        [
          { title: "A", url: "https://a.example/x", snippet: "one" },
          { title: "A again", url: "https://a.example/x", snippet: "dup" },
          { title: "Bad", url: "javascript:alert(1)", snippet: "" },
          { title: "", url: "http://b.example/", snippet: 3 },
        ],
        5,
      ),
    ).toEqual([
      { title: "A", url: "https://a.example/x", snippet: "one" },
      { title: "http://b.example/", url: "http://b.example/", snippet: "" },
    ]);
  });

  it("cites web results as W refs with their URL", () => {
    const items = webItems([
      { title: "Docs", url: "https://docs.example/", snippet: "Hello" },
    ]);
    const sources = sourcesOf(items);
    expect(sources).toEqual([
      expect.objectContaining({
        ref: "W:1",
        kind: "web",
        url: "https://docs.example/",
        projectId: null,
      }),
    ]);
    expect(citedRefs("See [W:1] and [W:9].", sources)).toEqual(["W:1"]);
    expect(items[0]?.dataTier).toBe("public");
  });
});

describe("trend facts", () => {
  it("detects trend questions and keeps their words out of the search", () => {
    const plan = heuristicPlan("Created vs completed per week in Marketing");
    expect(plan.intents.has("trend")).toBe(true);
    expect(plan.terms).not.toContain("created");
    expect(plan.terms).not.toContain("week");
    expect(
      heuristicPlan("Show the burndown for Sprint 4").intents.has("trend"),
    ).toBe(true);
    expect(heuristicPlan("what's overdue?").intents.has("trend")).toBe(false);
    expect(trendUnitOf("tasks completed per day")).toBe("day");
    expect(trendUnitOf("velocity over time")).toBe("week");
  });

  it("buckets twelve Monday weeks or thirty days ending today", () => {
    const weeks = trendBuckets("2026-10-28", "week");
    expect(weeks.starts).toHaveLength(12);
    expect(weeks.starts.at(-1)).toBe("2026-10-26");
    expect(weeks.starts[0]).toBe("2026-08-10");
    expect(weeks.end).toBe("2026-10-29");
    const days = trendBuckets("2026-10-28", "day");
    expect(days.starts).toHaveLength(30);
    expect(days.starts.at(-1)).toBe("2026-10-28");
  });

  it("formats series and a burn-up", () => {
    const text = formatTrend({
      unit: "week",
      scopeLabel: 'project "Web"',
      timeZone: "UTC",
      buckets: [
        { label: "2026-10-19", created: 3, completed: 1 },
        { label: "2026-10-26", created: 2, completed: 4 },
      ],
      burn: {
        name: "Sprint 4",
        startDate: "2026-10-26",
        endDate: "2026-11-08",
        total: 5,
        days: [{ label: "2026-10-26", completed: 1, remaining: 4 }],
      },
    });
    expect(text).toContain("- 2026-10-19: created 3, completed 1");
    expect(text).toContain("created 5, completed 5");
    expect(text).toContain('Burn-up of cycle "Sprint 4"');
    expect(text).toContain("- 2026-10-26: completed 1, remaining 4");
  });
});

describe("notes, skills and settings", () => {
  it("formats memory notes as one uncited block", () => {
    expect(formatMemoryNotes([])).toBe("");
    expect(formatMemoryNotes(["Release day\nis Thursday"])).toContain(
      "- Release day is Thursday",
    );
  });

  it("frames a skill as the person's own instructions", () => {
    expect(skillInstructions({ name: 'Brief "QA"', prompt: "Be short." })).toBe(
      'Instructions from the user for this question (saved skill "Brief  QA "):\nBe short.',
    );
  });

  it("reads the new instance settings from the environment", () => {
    const env = {
      NODE_ENV: "test",
      MARGAYA_AI_SHOW_REASONING: "true",
      MARGAYA_AI_LOCAL_THINKING: "on",
      MARGAYA_AI_WEB_SEARCH_PROVIDER: "searxng",
      MARGAYA_AI_WEB_SEARCH_URL: "https://search.example",
      MARGAYA_AI_SPEECH_BASE_URL: "http://whisper:9000/v1",
      MARGAYA_AI_SPEECH_MODEL: "whisper-1",
    };
    const config = aiInstanceConfigOf(
      resolveInstanceSettings({ env, rows: [] }),
      env,
    );
    expect(config.showReasoning).toBe(true);
    expect(config.localThinking).toBe("on");
    expect(config.webSearch).toEqual({
      provider: "searxng",
      url: "https://search.example",
      apiKey: "",
    });
    expect(config.speech.model).toBe("whisper-1");
    const defaults = aiInstanceConfigOf(
      resolveInstanceSettings({ env: {}, rows: [] }),
      {},
    );
    expect(defaults.showReasoning).toBe(false);
    expect(defaults.localThinking).toBe("off");
    expect(defaults.webSearch.provider).toBe("off");
  });
});

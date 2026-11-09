import { describe, expect, it } from "vitest";
import {
  modelTokenFilter,
  stripModelTokens,
} from "../../../apps/api/src/ai/provider/model-tokens";
import { createOpenAiCompatibleProvider } from "../../../apps/api/src/ai/provider/openai-compatible";
import type { ChatDelta } from "../../../apps/api/src/ai/types";

// Control tokens and tool-call markup that local models print as text when
// the server doesn't parse them.
const SECTION =
  '<|tool_calls_section_begin|><|tool_call_begin|>functions.add_comment:0<|tool_call_argument_begin|>{"taskId":"t1","body":"Done"}<|tool_call_end|><|tool_call_begin|>functions.list_tasks:1<|tool_call_argument_begin|>{}<|tool_call_end|><|tool_calls_section_end|>';

function filterAll(pieces: string[]) {
  const filter = modelTokenFilter();
  let text = "";
  for (const piece of pieces) text += filter.push(piece);
  text += filter.flush();
  return { text, calls: filter.takeCalls() };
}

describe("stripModelTokens", () => {
  it("drops an empty tool-call section after the answer", () => {
    expect(
      stripModelTokens(
        "so that section was left out.<|tool_calls_section_begin|><|tool_calls_section_end|>",
      ),
    ).toBe("so that section was left out.");
  });

  it("drops end-of-turn, role and header tokens", () => {
    expect(stripModelTokens("Done.<|im_end|>")).toBe("Done.");
    expect(stripModelTokens("Done.<|eot_id|><|end_of_text|>")).toBe("Done.");
    expect(stripModelTokens("<|im_start|>assistant\nHello<|im_end|>")).toBe(
      "Hello",
    );
    expect(
      stripModelTokens(
        "<|start_header_id|>assistant<|end_header_id|>\n\nHello<|eot_id|>",
      ),
    ).toBe("Hello");
    expect(stripModelTokens("Hi<|endoftext|>")).toBe("Hi");
    expect(stripModelTokens("Hi<｜end▁of▁sentence｜>")).toBe("Hi");
  });

  it("drops a whole tool-call section, in each common format", () => {
    expect(stripModelTokens(`Checking.${SECTION}`)).toBe("Checking.");
    expect(
      stripModelTokens(
        'Checking.<tool_call>\n{"name": "list_tasks", "arguments": {}}\n</tool_call>',
      ),
    ).toBe("Checking.");
    expect(
      stripModelTokens(
        "Checking.<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>list_tasks\n```json\n{}\n```<｜tool▁call▁end｜><｜tool▁calls▁end｜>",
      ),
    ).toBe("Checking.");
  });

  it("leaves ordinary text alone", () => {
    for (const text of [
      "Use a | b, <b>bold</b> and x <| y.",
      "Compare <|x and y|> loosely",
      "WEB-4 is done; see [the page](/dashboard/workspace/ws/pages/p).",
      "1 < 2 and 3 > 2",
    ]) {
      expect(stripModelTokens(text)).toBe(text);
    }
  });
});

describe("modelTokenFilter", () => {
  it("parses tool calls written as text, so they aren't lost", () => {
    const { text, calls } = filterAll([`Checking.${SECTION}`]);
    expect(text).toBe("Checking.");
    expect(calls).toEqual([
      { name: "add_comment", input: { taskId: "t1", body: "Done" } },
      { name: "list_tasks", input: {} },
    ]);
  });

  it("parses the other common text formats", () => {
    expect(
      filterAll([
        '<tool_call>\n{"name": "add_comment", "arguments": {"body": "Hi"}}\n</tool_call>',
      ]).calls,
    ).toEqual([{ name: "add_comment", input: { body: "Hi" } }]);
    expect(
      filterAll([
        '<tool_call>{"name":"add_comment","arguments":"{\\"body\\":\\"Hi\\"}"}</tool_call>',
      ]).calls,
    ).toEqual([{ name: "add_comment", input: { body: "Hi" } }]);
    expect(
      filterAll([
        '<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>list_tasks\n```json\n{"limit": 5}\n```<｜tool▁call▁end｜><｜tool▁calls▁end｜>',
      ]).calls,
    ).toEqual([{ name: "list_tasks", input: { limit: 5 } }]);
  });

  it("handles tokens split across chunks", () => {
    const { text, calls } = filterAll([
      "left out.<|tool_c",
      "alls_section_begin|><|tool_call_begin|>functions.x:0<|tool_call_arg",
      'ument_begin|>{"a":1}<|tool_call_end|><|tool_calls_sec',
      "tion_end|> Bye<|im_",
      "end|>",
    ]);
    expect(text).toBe("left out. Bye");
    expect(calls).toEqual([{ name: "x", input: { a: 1 } }]);
  });

  it("streams ordinary text through, holding back only a possible token", () => {
    const filter = modelTokenFilter();
    expect(filter.push("Hello wor")).toBe("Hello wor");
    expect(filter.push("ld <")).toBe("ld ");
    expect(filter.push("b>bold")).toBe("<b>bold");
    expect(filter.push(" x <|")).toBe(" x ");
    expect(filter.flush()).toBe("<|");
  });

  it("drops an unclosed section at the end, keeping any call it finished", () => {
    const { text, calls } = filterAll([
      'Hi<|tool_calls_section_begin|><|tool_call_begin|>functions.x:0<|tool_call_argument_begin|>{"a":1}<|tool_call_end|>',
    ]);
    expect(text).toBe("Hi");
    expect(calls).toEqual([{ name: "x", input: { a: 1 } }]);
  });
});

async function collect(stream: AsyncIterable<ChatDelta>) {
  const deltas: ChatDelta[] = [];
  for await (const delta of stream) deltas.push(delta);
  const text = deltas
    .map((delta) => (delta.type === "text" ? delta.text : ""))
    .join("");
  return { deltas, text };
}

function sseProvider(pieces: string[], finish = "stop") {
  const chunks = [
    ...pieces.map((content) => ({ choices: [{ delta: { content } }] })),
    { choices: [{ delta: {}, finish_reason: finish }] },
  ];
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  return createOpenAiCompatibleProvider({
    baseUrl: "http://local-model:8000/v1",
    allowPrivate: true,
    fetchImpl: async () =>
      new Response(body, { headers: { "content-type": "text/event-stream" } }),
  });
}

const chat = {
  model: "local-model",
  system: [],
  messages: [{ role: "user" as const, content: "Write the standup" }],
  maxTokens: 256,
};

describe("OpenAI-compatible adapter", () => {
  it("keeps an unparsed tool-call section out of the answer", async () => {
    const provider = sseProvider([
      "Created the standup page **[2026-11-03](/dashboard/workspace/ws/project/p/pages/pg)**; ",
      "nothing was blocked, so that section was left out.<|tool_calls_sec",
      "tion_begin|><|tool_calls_section_end|>",
    ]);
    const { deltas, text } = await collect(
      provider.stream(chat, new AbortController().signal),
    );
    expect(text).toBe(
      "Created the standup page **[2026-11-03](/dashboard/workspace/ws/project/p/pages/pg)**; nothing was blocked, so that section was left out.",
    );
    expect(deltas.some((delta) => delta.type === "tool_call")).toBe(false);
    expect(deltas.at(-1)).toEqual({ type: "stop", reason: "end_turn" });
  });

  it("turns tool calls written as text into tool calls", async () => {
    const provider = sseProvider([
      `Checking.${SECTION.slice(0, 40)}`,
      SECTION.slice(40),
    ]);
    const { deltas, text } = await collect(
      provider.stream(chat, new AbortController().signal),
    );
    expect(text).toBe("Checking.");
    expect(deltas.filter((delta) => delta.type === "tool_call")).toEqual([
      {
        type: "tool_call",
        call: {
          id: "call_text_0",
          name: "add_comment",
          input: { taskId: "t1", body: "Done" },
        },
      },
      {
        type: "tool_call",
        call: { id: "call_text_1", name: "list_tasks", input: {} },
      },
    ]);
    expect(deltas.at(-1)).toEqual({ type: "stop", reason: "tool_use" });
  });
});

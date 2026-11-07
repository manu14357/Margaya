import { afterEach, describe, expect, it } from "vitest";
import { parseJsonAnswer } from "../../../apps/api/src/ai/json-answer";
import { anthropicParams } from "../../../apps/api/src/ai/provider/anthropic";
import {
  createFakeProvider,
  fakeEmbedding,
  sampleForSchema,
  setFakeResponder,
} from "../../../apps/api/src/ai/provider/fake";
import {
  createOpenAiCompatibleProvider,
  openAiBody,
} from "../../../apps/api/src/ai/provider/openai-compatible";
import type { ChatDelta, ChatRequest } from "../../../apps/api/src/ai/types";

const request = (overrides: Partial<ChatRequest> = {}): ChatRequest => ({
  model: "fake-balanced",
  system: ["Stable rules.", "Answer in German."],
  messages: [{ role: "user", content: "Summarize the sprint" }],
  maxTokens: 256,
  ...overrides,
});

async function collect(stream: AsyncIterable<ChatDelta>) {
  const deltas: ChatDelta[] = [];
  for await (const delta of stream) deltas.push(delta);
  const text = deltas
    .map((delta) => (delta.type === "text" ? delta.text : ""))
    .join("");
  return { deltas, text };
}

afterEach(() => setFakeResponder(null));

describe("fake provider", () => {
  it("answers deterministically in several chunks with usage and a stop", async () => {
    const provider = createFakeProvider();
    const first = await collect(
      provider.stream(request(), new AbortController().signal),
    );
    const second = await collect(
      provider.stream(request(), new AbortController().signal),
    );
    expect(first.text).toBe("[fake:fake-balanced] Summarize the sprint");
    expect(first).toEqual(second);
    expect(
      first.deltas.filter((delta) => delta.type === "text").length,
    ).toBeGreaterThan(1);
    expect(first.deltas.at(-2)).toMatchObject({ type: "usage" });
    expect(first.deltas.at(-1)).toEqual({ type: "stop", reason: "end_turn" });
  });

  it("answers JSON matching a schema", async () => {
    const schema = {
      type: "object",
      properties: {
        priority: { type: "string", enum: ["high", "low"] },
        labels: { type: "array", items: { type: "string" } },
        confidence: { type: "number" },
      },
      required: ["priority", "labels", "confidence"],
      additionalProperties: false,
    };
    const { text } = await collect(
      createFakeProvider().stream(
        request({ jsonSchema: schema }),
        new AbortController().signal,
      ),
    );
    expect(JSON.parse(text)).toEqual({
      priority: "high",
      labels: [],
      confidence: 0,
    });
    expect(sampleForSchema({ type: "boolean" })).toBe(false);
  });

  it("refuses, fails and calls tools on markers", async () => {
    const provider = createFakeProvider();
    const refused = await collect(
      provider.stream(
        request({ messages: [{ role: "user", content: "[[fake:refuse]]" }] }),
        new AbortController().signal,
      ),
    );
    expect(refused.deltas.at(-1)).toEqual({ type: "stop", reason: "refusal" });

    await expect(
      collect(
        provider.stream(
          request({ messages: [{ role: "user", content: "[[fake:error]]" }] }),
          new AbortController().signal,
        ),
      ),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_ERROR" });

    const tool = await collect(
      provider.stream(
        request({
          messages: [
            {
              role: "user",
              content: '[[fake:tool:add_label {"name":"bug"}]]',
            },
          ],
        }),
        new AbortController().signal,
      ),
    );
    expect(tool.deltas).toContainEqual({
      type: "tool_call",
      call: {
        id: "fake_call_add_label",
        name: "add_label",
        input: { name: "bug" },
      },
    });
    expect(tool.deltas.at(-1)).toEqual({ type: "stop", reason: "tool_use" });
  });

  it("answers the JSON a marker gives when a schema is set", async () => {
    // A separate server process (e2e) can't call setFakeResponder; the
    // prompt scripts the structured answer instead.
    const content =
      'Plan it.\n[[fake:json {"tasks":[{"title":"Ship {it}","subtasks":[]}]}]]';
    const scripted = await collect(
      createFakeProvider().stream(
        request({
          jsonSchema: { type: "object" },
          messages: [{ role: "user", content }],
        }),
        new AbortController().signal,
      ),
    );
    expect(JSON.parse(scripted.text)).toEqual({
      tasks: [{ title: "Ship {it}", subtasks: [] }],
    });

    // Without a schema the marker is plain text, echoed as usual.
    const plain = await collect(
      createFakeProvider().stream(
        request({ messages: [{ role: "user", content }] }),
        new AbortController().signal,
      ),
    );
    expect(plain.text).toContain("[[fake:json");
  });

  it("can be scripted", async () => {
    setFakeResponder(() => ({ text: "scripted" }));
    const { text } = await collect(
      createFakeProvider().stream(request(), new AbortController().signal),
    );
    expect(text).toBe("scripted");
  });

  it("embeds deterministically as unit vectors", async () => {
    const [a, b] = (await createFakeProvider().embed?.(
      ["hello", "hello"],
      new AbortController().signal,
    )) ?? [[], []];
    expect(a).toEqual(b);
    expect(Math.hypot(...(a ?? []))).toBeCloseTo(1, 6);
    expect(fakeEmbedding("x")).not.toEqual(fakeEmbedding("y"));
  });
});

describe("Anthropic request", () => {
  it("caches the stable system block, sets effort and streams", () => {
    const params = anthropicParams(
      request({ model: "claude-haiku-5-5", effort: "low" }),
    );
    expect(params.stream).toBe(true);
    expect(params.system).toEqual([
      {
        type: "text",
        text: "Stable rules.",
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: "Answer in German." },
    ]);
    expect(params.output_config).toEqual({ effort: "low" });
    expect(params).not.toHaveProperty("fallbacks");
  });

  it("opts in to the server-side refusal fallback where supported", () => {
    const params = anthropicParams(request({ model: "claude-sonnet-5-5" }));
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
  });

  it("maps tools with auto choice and structured output", () => {
    const params = anthropicParams(
      request({
        model: "claude-opus-5-5",
        tools: [
          {
            name: "add_label",
            description: "Add a label",
            inputSchema: { properties: { name: { type: "string" } } },
          },
        ],
        jsonSchema: { type: "object" },
      }),
    );
    expect(params.tool_choice).toEqual({ type: "auto" });
    expect(params.tools?.[0]).toMatchObject({
      name: "add_label",
      input_schema: {
        type: "object",
        properties: { name: { type: "string" } },
      },
    });
    expect(params.output_config?.format).toEqual({
      type: "json_schema",
      schema: { type: "object" },
    });
  });
});

describe("OpenAI-compatible adapter", () => {
  it("builds a chat completions body", () => {
    const body = openAiBody(
      request({
        model: "llama3.3",
        messages: [
          { role: "user", content: "Hi" },
          {
            role: "assistant",
            content: [
              { type: "tool_use", id: "c1", name: "t", input: { a: 1 } },
            ],
          },
          {
            role: "user",
            content: [
              { type: "tool_result", toolUseId: "c1", content: "done" },
            ],
          },
        ],
      }),
    );
    expect(body.messages).toEqual([
      { role: "system", content: "Stable rules.\n\nAnswer in German." },
      { role: "user", content: "Hi" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "t", arguments: '{"a":1}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "done" },
    ]);
    expect(body.stream).toBe(true);
  });

  it("parses a streamed answer with tool calls and usage", async () => {
    const chunks = [
      { model: "llama3.3", choices: [{ delta: { content: "Hel" } }] },
      { choices: [{ delta: { content: "lo" } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "x",
                  function: { name: "t", arguments: '{"a"' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: ":2}" } }],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5 } },
    ];
    const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
    let seen: RequestInit | undefined;
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "http://ollama:11434/v1/",
      allowPrivate: true,
      apiKey: "local-key",
      fetchImpl: async (_url, init) => {
        seen = init;
        return new Response(body, {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    const { deltas, text } = await collect(
      provider.stream(
        request({ model: "llama3.3" }),
        new AbortController().signal,
      ),
    );
    expect(text).toBe("Hello");
    expect(deltas).toContainEqual({
      type: "tool_call",
      call: { id: "x", name: "t", input: { a: 2 } },
    });
    expect(deltas).toContainEqual({
      type: "usage",
      model: "llama3.3",
      usage: { input: 12, output: 5, cacheRead: 0, cacheWrite: 0 },
    });
    expect(deltas.at(-1)).toEqual({ type: "stop", reason: "tool_use" });
    expect(
      (seen?.headers as Record<string, string> | undefined)?.authorization,
    ).toBe("Bearer local-key");
  });

  it("asks local servers to skip thinking and drops <think> blocks", async () => {
    const pieces = [
      "Hi <thi",
      "nk>plan the answer",
      "</thi",
      "nk>\nthere",
      "!",
    ];
    const body = `${pieces
      .map(
        (content) =>
          `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
      )
      .join("")}data: [DONE]\n\n`;
    const sent: unknown[] = [];
    const make = (disableThinking: boolean) =>
      createOpenAiCompatibleProvider({
        baseUrl: "http://vllm:8000/v1",
        allowPrivate: true,
        disableThinking,
        fetchImpl: async (_url, init) => {
          sent.push(JSON.parse(String(init?.body)));
          return new Response(body, {
            headers: { "content-type": "text/event-stream" },
          });
        },
      });

    const local = await collect(
      make(true).stream(request(), new AbortController().signal),
    );
    expect(local.text).toBe("Hi there!");
    expect(sent[0]).toMatchObject({
      chat_template_kwargs: { enable_thinking: false },
    });

    await collect(make(false).stream(request(), new AbortController().signal));
    expect(sent[1]).not.toHaveProperty("chat_template_kwargs");
  });

  it("maps HTTP failures to AI error codes without provider text", async () => {
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "http://ollama:11434/v1",
      allowPrivate: true,
      fetchImpl: async () => new Response("secret detail", { status: 401 }),
    });
    await expect(
      collect(provider.stream(request(), new AbortController().signal)),
    ).rejects.toMatchObject({
      code: "AI_NOT_CONFIGURED",
      message: expect.not.stringContaining("secret"),
    });
  });

  it("states the JSON schema in the prompt for servers that don't enforce it", () => {
    const schema = { type: "object", properties: { a: { type: "string" } } };
    const body = openAiBody(request({ jsonSchema: schema }));
    expect(body.messages[0]?.content).toContain(JSON.stringify(schema));
    expect(body.response_format?.json_schema.schema).toEqual(schema);
  });

  it("finds the JSON in a wrapped answer", () => {
    expect(parseJsonAnswer('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(
      parseJsonAnswer('Here is the plan: {"a":"x } y","b":{"c":[1]}} Done.'),
    ).toEqual({ a: "x } y", b: { c: [1] } });
    expect(parseJsonAnswer("Corriger la boucle")).toBeUndefined();
  });

  it("explains a server without tool calling", async () => {
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "http://vllm:8000/v1",
      allowPrivate: true,
      fetchImpl: async () =>
        new Response(
          '{"error":{"message":"\\"auto\\" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set"}}',
          { status: 400 },
        ),
    });
    await expect(
      collect(provider.stream(request(), new AbortController().signal)),
    ).rejects.toMatchObject({
      code: "AI_NOT_CONFIGURED",
      message: expect.stringContaining("does not accept tool calls"),
    });
  });

  it("refuses private addresses for cloud endpoints", async () => {
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "http://127.0.0.1:11434/v1",
      allowPrivate: false,
      fetchImpl: async () => new Response("{}"),
    });
    await expect(
      collect(provider.stream(request(), new AbortController().signal)),
    ).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
  });
});

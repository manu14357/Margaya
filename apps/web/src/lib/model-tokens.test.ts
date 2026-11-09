import { describe, expect, it } from "vitest";
import { stripModelTokens } from "./model-tokens";

describe("stripModelTokens", () => {
  it("drops an empty or full tool-call section after the answer", () => {
    expect(
      stripModelTokens(
        "so that section was left out.<|tool_calls_section_begin|><|tool_calls_section_end|>",
      ),
    ).toBe("so that section was left out.");
    expect(
      stripModelTokens(
        'Checking.<|tool_calls_section_begin|><|tool_call_begin|>functions.list_tasks:0<|tool_call_argument_begin|>{"limit":5}<|tool_call_end|><|tool_calls_section_end|>',
      ),
    ).toBe("Checking.");
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

  it("drops an unclosed section and single control tokens", () => {
    expect(stripModelTokens("Hi<|tool_calls_section_begin|><|tool_call")).toBe(
      "Hi",
    );
    expect(stripModelTokens("<|im_start|>assistant\nHello<|im_end|>")).toBe(
      "Hello",
    );
    expect(
      stripModelTokens(
        "<|start_header_id|>assistant<|end_header_id|>\n\nHello<|eot_id|>",
      ),
    ).toBe("Hello");
    expect(stripModelTokens("Hi<|endoftext|><｜end▁of▁sentence｜>")).toBe("Hi");
  });

  it("leaves ordinary text alone", () => {
    for (const text of [
      "Use a | b, <b>bold</b> and x <| y.",
      "Compare <|x and y|> loosely",
      "See **[2026-11-03](/dashboard/workspace/ws/project/p/pages/pg)**.",
    ]) {
      expect(stripModelTokens(text)).toBe(text);
    }
  });
});

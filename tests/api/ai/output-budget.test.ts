import { afterEach, describe, expect, it } from "vitest";
import {
  LOCAL_REASONING_TOKENS,
  requestMaxTokens,
} from "../../../apps/api/src/ai/gateway";
import { parseJsonAnswer } from "../../../apps/api/src/ai/json-answer";
import {
  MAX_TRANSLATION_TOKENS,
  tokensPerChar,
  translationMaxTokens,
} from "../../../apps/api/src/ai-translate/budget";

describe("reasoning headroom", () => {
  afterEach(() => {
    delete process.env.MARGAYA_AI_LOCAL_REASONING_TOKENS;
  });

  it("adds headroom for local models only", () => {
    expect(requestMaxTokens(500, { kind: "cloud" })).toBe(500);
    expect(requestMaxTokens(500, { kind: "local" })).toBe(
      500 + LOCAL_REASONING_TOKENS,
    );
  });

  it("follows MARGAYA_AI_LOCAL_REASONING_TOKENS, 0 turning it off", () => {
    process.env.MARGAYA_AI_LOCAL_REASONING_TOKENS = "0";
    expect(requestMaxTokens(500, { kind: "local" })).toBe(500);
    process.env.MARGAYA_AI_LOCAL_REASONING_TOKENS = "8000";
    expect(requestMaxTokens(500, { kind: "local" })).toBe(8500);
  });
});

describe("translation budget", () => {
  it("is generous for scripts that take many tokens per character", () => {
    expect(tokensPerChar("hi-IN")).toBeGreaterThan(tokensPerChar("de-DE"));
    expect(tokensPerChar("ru-RU")).toBeGreaterThan(tokensPerChar("fr-FR"));
    expect(tokensPerChar("zh-CN")).toBeGreaterThan(tokensPerChar("es-ES"));
    // A 4,000-character page into Hindi: at least a token per character.
    expect(translationMaxTokens(4000, "hi-IN")).toBeGreaterThanOrEqual(4000);
    // The old len/2 + 512 budget was 2,512.
    expect(translationMaxTokens(4000, "hi-IN")).toBeGreaterThan(2512 * 2);
  });

  it("is capped and never below the overhead", () => {
    expect(translationMaxTokens(30_000, "hi-IN")).toBe(MAX_TRANSLATION_TOKENS);
    expect(translationMaxTokens(0, "en-US")).toBeGreaterThan(0);
  });
});

describe("JSON answers", () => {
  it("parses long answers with raw line breaks inside strings", () => {
    const translation = Array.from(
      { length: 400 },
      (_, i) => `## अनुभाग ${i}\n\tपंक्ति "उद्धरण" \\ समाप्त`,
    ).join("\n");
    const raw = `{"sourceLanguage":"en","translation":"${translation
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')}"}`;
    const value = parseJsonAnswer(raw) as { translation: string };
    expect(value.translation).toBe(translation);
    expect(parseJsonAnswer(`Here it is:\n${raw}\nDone.`)).toEqual(value);
  });

  it("skips braces in prose before the object", () => {
    expect(parseJsonAnswer('Fill {name} in: {"a":1}')).toEqual({ a: 1 });
  });

  it("never returns a cut-off object or one nested in it", () => {
    expect(
      parseJsonAnswer('{"tasks":[{"title":"a"},{"title":"b"}],"summary":"x'),
    ).toBeUndefined();
  });
});

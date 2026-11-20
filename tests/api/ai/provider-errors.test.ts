import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  type AiError,
  isBillingFailure,
  providerErrorDetail,
} from "../../../apps/api/src/ai/errors";
import { anthropicError } from "../../../apps/api/src/ai/provider/anthropic";
import {
  createOpenAiCompatibleProvider,
  statusError,
} from "../../../apps/api/src/ai/provider/openai-compatible";

// Provider failures: a fixed message for the client, plus a short scrubbed
// excerpt of what the provider said (`detail`) for the log and run history.

describe("providerErrorDetail", () => {
  it("keeps the provider's message and error code", () => {
    const body = JSON.stringify({
      error: {
        message: "Unsupported parameter: 'max_tokens'",
        type: "invalid_request_error",
      },
    });
    expect(providerErrorDetail(400, body)).toBe(
      "HTTP 400: Unsupported parameter: 'max_tokens' (invalid_request_error)",
    );
  });

  it("scrubs keys and emails and stops before an echoed request", () => {
    const body = JSON.stringify({
      message:
        "Bad key sk-proj-abcdefghijklmnop for ops@example.com: [{'type': 'missing', 'input': {'messages': 'secret prompt'}}]",
    });
    const detail = providerErrorDetail(400, body);
    expect(detail).not.toContain("sk-proj-abcdefghijklmnop");
    expect(detail).not.toContain("ops@example.com");
    expect(detail).not.toContain("secret prompt");
    expect(detail).toContain("[SECRET_1]");
  });

  it("caps long bodies and strips HTML", () => {
    const detail = providerErrorDetail(
      502,
      `<html><body><h1>Bad gateway</h1>${"x".repeat(1_000)}</body></html>`,
    );
    expect(detail.startsWith("HTTP 502: Bad gateway")).toBe(true);
    expect(detail.length).toBeLessThanOrEqual("HTTP 502: ".length + 300);
  });
});

describe("billing failures", () => {
  it("recognizes 402 and quota or credit messages", () => {
    expect(isBillingFailure(402, "")).toBe(true);
    expect(
      isBillingFailure(
        429,
        '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}',
      ),
    ).toBe(true);
    expect(
      isBillingFailure(400, "Your credit balance is too low to access the API"),
    ).toBe(true);
    expect(isBillingFailure(429, "Rate limit reached for requests")).toBe(
      false,
    );
    expect(isBillingFailure(500, "billing service down")).toBe(false);
  });

  it("maps an empty OpenAI-compatible account to a setup error, not rate limiting", () => {
    const error = statusError(
      429,
      '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota, please check your plan and billing details."}}',
    );
    expect(error.code).toBe("AI_NOT_CONFIGURED");
    expect(error.message).toMatch(/out of credit/);
    expect(error.detail).toMatch(/^HTTP 429: You exceeded your current quota/);
  });

  it("maps 402 Payment Required to the billing message", () => {
    const error = statusError(
      402,
      '{"error":{"message":"Insufficient credits"}}',
    );
    expect(error.code).toBe("AI_NOT_CONFIGURED");
    expect(error.message).toMatch(/out of credit/);
  });

  it("maps an Anthropic credit error to the billing message", () => {
    const error = anthropicError(
      Anthropic.APIError.generate(
        400,
        {
          type: "error",
          error: {
            type: "invalid_request_error",
            message:
              "Your credit balance is too low to access the Anthropic API.",
          },
        },
        undefined,
        new Headers(),
      ),
    ) as AiError;
    expect(error.code).toBe("AI_NOT_CONFIGURED");
    expect(error.message).toMatch(/out of credit/);
    expect(error.detail).toMatch(/credit balance is too low/);
  });

  it("keeps a plain Anthropic bad request a provider error, with detail", () => {
    const error = anthropicError(
      Anthropic.APIError.generate(
        400,
        {
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "max_tokens: too large",
          },
        },
        undefined,
        new Headers(),
      ),
    ) as AiError;
    expect(error.code).toBe("AI_PROVIDER_ERROR");
    expect(error.message).toBe("The AI provider refused the request");
    expect(error.detail).toBe(
      "HTTP 400: max_tokens: too large (invalid_request_error)",
    );
  });
});

describe("OpenAI-compatible error detail", () => {
  const stream = (fetchImpl: typeof fetch) =>
    createOpenAiCompatibleProvider({
      baseUrl: "http://localhost:11434/v1",
      allowPrivate: true,
      fetchImpl,
    }).stream(
      {
        model: "m",
        system: [],
        messages: [{ role: "user", content: "Hi" }],
        maxTokens: 10,
      },
      new AbortController().signal,
    );

  async function failure(fetchImpl: typeof fetch): Promise<AiError> {
    try {
      for await (const _ of stream(fetchImpl)) {
        // drain
      }
    } catch (error) {
      return error as AiError;
    }
    throw new Error("expected a failure");
  }

  it("keeps what a 400 said, without sending it to the client", async () => {
    const error = await failure(
      async () =>
        new Response(
          JSON.stringify({
            error: { message: "model 'm' does not support tools" },
          }),
          { status: 400 },
        ),
    );
    expect(error.code).toBe("AI_PROVIDER_ERROR");
    expect(error.message).toBe("The AI endpoint refused the request (400)");
    expect(error.detail).toBe("HTTP 400: model 'm' does not support tools");
    const body = await error.getResponse().json();
    expect(JSON.stringify(body)).not.toContain("does not support");
  });

  it("names the network error code when the endpoint is unreachable", async () => {
    const error = await failure(async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }),
      });
    });
    expect(error.code).toBe("AI_PROVIDER_ERROR");
    expect(error.message).toBe("The AI endpoint is unreachable");
    expect(error.detail).toBe("ECONNREFUSED");
  });
});

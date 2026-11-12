import { describe, expect, it } from "vitest";
import { parseApiError } from "./error-handler";
import { HttpError } from "./http-error";

describe("parseApiError", () => {
  it("returns a generic message key for unknown Error instances instead of leaking error.message", () => {
    const internalMessage =
      "Cannot read properties of undefined (reading 'id') at TaskList";
    const result = parseApiError(new Error(internalMessage));

    expect(result.type).toBe("unknown");
    expect(result.message).toBe("common:error.messages.unknown");
    expect(result.message).not.toContain(internalMessage);
    // originalError is preserved so Sentry still sees the real cause.
    expect(result.originalError?.message).toBe(internalMessage);
  });

  it("returns a generic message key for non-Error values", () => {
    const result = parseApiError("something bad happened");
    expect(result.type).toBe("unknown");
    expect(result.message).toBe("common:error.messages.unknown");
  });

  it("still returns a CORS-specific message key for matching errors", () => {
    const result = parseApiError(new Error("Failed to fetch: CORS blocked"));
    expect(result.type).toBe("cors");
    expect(result.message).toBe("common:error.messages.cors");
  });

  it("classifies Safari's 'Load failed' as a network error, not CORS", () => {
    const originalMessage = "TypeError: Load failed";
    const error = new Error(originalMessage);

    const result = parseApiError(error);

    expect(result.type).toBe("network");
    expect(result.message).toBe("common:error.messages.network");
    expect(result.originalError).toBe(error);
    expect(result.originalError?.message).toBe(originalMessage);
  });

  it("classifies an API answer by its status, never by its message", () => {
    // Fetchers throw messages like "Failed to fetch tasks": the server
    // answered, so this is not a connection or CORS problem.
    const missing = parseApiError(new HttpError(404, "Failed to fetch tasks"));
    expect(missing.type).toBe("notFound");
    expect(missing.status).toBe(404);

    expect(parseApiError(new HttpError(401, "Failed to fetch")).type).toBe(
      "auth",
    );
    expect(parseApiError(new HttpError(503, "Failed to fetch")).type).toBe(
      "server",
    );
    const forbidden = parseApiError(new HttpError(403, "Failed to fetch"));
    expect(forbidden.type).toBe("unknown");
    expect(forbidden.status).toBe(403);
  });
});

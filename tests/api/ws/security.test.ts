import type { WSContext } from "hono/ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertWebSocketOrigin,
  handleWebSocketMessage,
  MAX_WEBSOCKET_FRAME_BYTES,
} from "../../../apps/api/src/ws/security";

afterEach(() => vi.unstubAllEnvs());

describe("project and user socket messages", () => {
  function closeCode(data: unknown) {
    const close = vi.fn();
    handleWebSocketMessage(new MessageEvent("message", { data }), {
      close,
    } as unknown as WSContext);
    return close.mock.calls[0]?.[0] ?? null;
  }

  it("keeps the 64-byte rule below the 1 MiB server frame limit", () => {
    expect(MAX_WEBSOCKET_FRAME_BYTES).toBe(1024 * 1024);
    expect(closeCode('{"type":"ping"}')).toBeNull();
    expect(closeCode("a".repeat(65))).toBe(1009);
    expect(closeCode("é".repeat(33))).toBe(1009);
    // Size is checked first, so oversized binary closes like text.
    expect(closeCode(new ArrayBuffer(65))).toBe(1009);
    expect(closeCode(new Uint8Array(1024))).toBe(1009);
    expect(closeCode(new ArrayBuffer(15))).toBe(1003);
    expect(closeCode('{"type":"other"}')).toBe(1008);
  });
});

describe("WebSocket origin configuration", () => {
  it("fails closed in production without configured origins, including wildcards", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MARGAYA_CLIENT_URL", "");
    vi.stubEnv("MARGAYA_API_URL", "");
    vi.stubEnv(
      "CORS_ORIGINS",
      "*,null,invalid,https://user:password@example.test",
    );
    for (const origin of [
      "null",
      "http://localhost:5173",
      "https://example.test",
    ]) {
      expect(() => assertWebSocketOrigin(new Headers({ origin }))).toThrow(
        "origin is not allowed",
      );
    }
  });
  it("uses configured URL origins, never request Host or forwarding headers", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MARGAYA_CLIENT_URL", "https://app.example.test/");
    vi.stubEnv("MARGAYA_API_URL", "https://api.example.test/api");
    vi.stubEnv(
      "CORS_ORIGINS",
      "https://extra.example.test, https://other.example.test",
    );
    for (const origin of [
      "https://app.example.test",
      "https://api.example.test",
      "https://extra.example.test",
      "https://other.example.test",
    ]) {
      expect(() =>
        assertWebSocketOrigin(new Headers({ origin })),
      ).not.toThrow();
    }
    expect(() =>
      assertWebSocketOrigin(
        new Headers({
          origin: "https://evil.example.test",
          host: "evil.example.test",
          "x-forwarded-host": "evil.example.test",
          authorization: "Bearer native-token",
        }),
      ),
    ).toThrow("origin is not allowed");
  });
});

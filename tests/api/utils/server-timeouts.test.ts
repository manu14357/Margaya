import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  applyServerTimeouts,
  HEADERS_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS,
} from "../../../apps/api/src/utils/server-timeouts";

describe("applyServerTimeouts", () => {
  it("keeps idle connections open longer than proxies' 60 s idle timeout", () => {
    const server = createServer();
    applyServerTimeouts(server);
    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
    expect(KEEP_ALIVE_TIMEOUT_MS).toBeGreaterThan(60_000);
    expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
    // Still shorter than a whole request may take.
    expect(server.headersTimeout).toBeLessThan(server.requestTimeout);
  });

  it("leaves servers without HTTP/1.1 keep-alive settings alone", () => {
    const other = { close() {} };
    applyServerTimeouts(other);
    expect(other).toEqual({ close: other.close });
    expect(() => applyServerTimeouts(undefined)).not.toThrow();
  });

  it("advertises the longer keep-alive to clients", async () => {
    const server = createServer((_req, res) => res.end("ok"));
    applyServerTimeouts(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const keepAlive = await new Promise<string | undefined>(
        (resolve, reject) => {
          const req = request(
            { port, path: "/", headers: { connection: "keep-alive" } },
            (res) => {
              res.resume();
              resolve(res.headers["keep-alive"]);
            },
          );
          req.on("error", reject);
          req.end();
        },
      );
      expect(keepAlive).toBe(`timeout=${KEEP_ALIVE_TIMEOUT_MS / 1000}`);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

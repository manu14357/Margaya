import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

/** Bound actual bytes before any JSON/form parser, even for misleading headers. */
export function boundedRequestBody(
  maxBytes: number,
  timeoutMs = 5_000,
): MiddlewareHandler {
  return async (c, next) => {
    const body = c.req.raw.body;
    if (!body) return next();
    const declared = Number(c.req.header("content-length"));
    if (declared > maxBytes) {
      void body.cancel().catch(() => {});
      throw new HTTPException(413, { message: "Request body is too large" });
    }
    // Always count actual bytes, including chunked bodies and misleading length
    // headers. Do not parse JSON/form data until this bounded read completes.
    const reader = body.getReader();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const read = async () => {
        // One growing buffer (copying chunks in) bounds memory even for
        // adversarial one-byte chunks; it starts at the declared length or
        // 64 KB rather than the full limit, so small bodies stay small.
        const initial =
          Number.isFinite(declared) && declared > 0
            ? Math.min(declared, maxBytes)
            : Math.min(64 * 1024, maxBytes);
        let bytes = new Uint8Array(initial);
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (size + value.byteLength > maxBytes) {
            void reader.cancel().catch(() => {});
            throw new HTTPException(413, {
              message: "Request body is too large",
            });
          }
          if (size + value.byteLength > bytes.byteLength) {
            const grown = new Uint8Array(
              Math.min(
                maxBytes,
                Math.max(bytes.byteLength * 2, size + value.byteLength),
              ),
            );
            grown.set(bytes.subarray(0, size));
            bytes = grown;
          }
          bytes.set(value, size);
          size += value.byteLength;
        }
        return bytes.subarray(0, size);
      };
      const bytes = await Promise.race([
        read(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(
              new HTTPException(408, { message: "Request body timed out" }),
            );
            void reader.cancel().catch(() => {});
          }, timeoutMs);
        }),
      ]);
      const headers = new Headers(c.req.raw.headers);
      headers.set("content-length", String(bytes.byteLength));
      headers.delete("transfer-encoding");
      c.req.raw = new Request(c.req.raw, { headers, body: bytes });
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
    }
    return next();
  };
}

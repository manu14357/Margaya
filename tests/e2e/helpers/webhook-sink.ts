import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

// A throwaway HTTP receiver for webhook, ntfy, Gotify and similar integration
// specs. It listens on a free port on 127.0.0.1; the e2e API may call it
// because MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS=true.

export type ReceivedRequest = {
  method: string;
  /** Path plus query string, e.g. `/hooks/abc?x=1`. */
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
  /** The parsed body when it is JSON, otherwise undefined. */
  json: unknown;
  receivedAt: Date;
};

export type SinkResponder = (request: ReceivedRequest) => {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
};

export type WebhookSink = {
  /** Base URL, e.g. http://127.0.0.1:53123. Append any path. */
  url: string;
  port: number;
  requests: ReceivedRequest[];
  /** Resolve with the first request (already received or future) matching `predicate`. */
  waitForRequest: (
    predicate?: (request: ReceivedRequest) => boolean,
    timeoutMs?: number,
  ) => Promise<ReceivedRequest>;
  /** Change how the sink answers (default: 200 with `{"ok":true}`). */
  respondWith: (responder: SinkResponder) => void;
  clear: () => void;
  close: () => Promise<void>;
};

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

export async function startWebhookSink(): Promise<WebhookSink> {
  const requests: ReceivedRequest[] = [];
  const waiters: {
    predicate: (request: ReceivedRequest) => boolean;
    resolve: (request: ReceivedRequest) => void;
  }[] = [];
  let responder: SinkResponder = () => ({
    status: 200,
    body: '{"ok":true}',
    headers: { "content-type": "application/json" },
  });

  const server = createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      const body = await readBody(request);
      let json: unknown;
      try {
        json = body ? JSON.parse(body) : undefined;
      } catch {
        json = undefined;
      }
      const received: ReceivedRequest = {
        method: request.method ?? "GET",
        path: request.url ?? "/",
        headers: request.headers,
        body,
        json,
        receivedAt: new Date(),
      };
      requests.push(received);
      for (const waiter of [...waiters]) {
        if (waiter.predicate(received)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(received);
        }
      }
      const reply = responder(received);
      response.writeHead(reply.status ?? 200, reply.headers);
      response.end(reply.body ?? "");
    },
  );

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    waitForRequest(predicate = () => true, timeoutMs = 15_000) {
      const existing = requests.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve };
        waiters.push(waiter);
        setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) {
            waiters.splice(index, 1);
            reject(
              new Error(
                `Webhook sink received no matching request within ${timeoutMs}ms (${requests.length} received)`,
              ),
            );
          }
        }, timeoutMs);
      });
    },
    respondWith(next) {
      responder = next;
    },
    clear() {
      requests.length = 0;
    },
    close() {
      return new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

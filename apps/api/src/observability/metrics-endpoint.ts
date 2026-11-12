import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { registerCollectors } from "./collectors";
import { registry } from "./instruments";
import { PROMETHEUS_CONTENT_TYPE } from "./metrics";

// Where Prometheus reads the metrics. Off unless MARGAYA_METRICS_ENABLED=true,
// and never open on the public port without a token:
// - MARGAYA_METRICS_TOKEN: GET /api/metrics with "Authorization: Bearer <token>".
// - MARGAYA_METRICS_PORT: a separate listener (MARGAYA_METRICS_HOST, default
//   0.0.0.0) serves GET /metrics, for a port only the cluster can reach. It
//   asks for the token too when one is set.

export type MetricsConfig = {
  enabled: boolean;
  token: string | null;
  port: number | null;
  host: string;
};

const MIN_TOKEN_LENGTH = 16;

export function metricsConfig(
  env: Record<string, string | undefined> = process.env,
): MetricsConfig {
  const enabled = env.MARGAYA_METRICS_ENABLED?.trim().toLowerCase() === "true";
  const token = env.MARGAYA_METRICS_TOKEN?.trim() || null;
  const rawPort = env.MARGAYA_METRICS_PORT?.trim();
  const port = rawPort && /^\d+$/.test(rawPort) ? Number(rawPort) : null;
  return {
    enabled,
    token,
    port: port && port > 0 && port < 65536 ? port : null,
    host: env.MARGAYA_METRICS_HOST?.trim() || "0.0.0.0",
  };
}

/** Problems worth one line in the startup log. */
export function metricsConfigWarnings(
  config: MetricsConfig,
  env: Record<string, string | undefined> = process.env,
): string[] {
  if (!config.enabled) return [];
  const warnings: string[] = [];
  if (env.MARGAYA_METRICS_PORT?.trim() && config.port === null) {
    warnings.push(
      "MARGAYA_METRICS_PORT must be a port number between 1 and 65535.",
    );
  }
  if (config.token && config.token.length < MIN_TOKEN_LENGTH) {
    warnings.push(
      `MARGAYA_METRICS_TOKEN is shorter than ${MIN_TOKEN_LENGTH} characters, so /api/metrics stays off.`,
    );
  }
  if (!usableToken(config) && config.port === null) {
    warnings.push(
      "MARGAYA_METRICS_ENABLED is true, but neither MARGAYA_METRICS_TOKEN nor MARGAYA_METRICS_PORT is set, so no endpoint serves the metrics.",
    );
  }
  return warnings;
}

function usableToken(config: MetricsConfig): string | null {
  return config.token && config.token.length >= MIN_TOKEN_LENGTH
    ? config.token
    : null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Whether an Authorization header carries the token (constant time). */
export function bearerMatches(
  header: string | undefined | null,
  token: string,
): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? "");
  if (!match?.[1]) return false;
  return timingSafeEqual(digest(match[1].trim()), digest(token));
}

export type MetricsAnswer =
  | { status: 200; body: string }
  | { status: 401 | 404; body: string };

/**
 * The answer for a scrape. `viaPort` is the separate listener; the API's
 * own route needs a token.
 */
export async function answerMetricsRequest(
  authorization: string | undefined | null,
  options: { viaPort: boolean; config?: MetricsConfig },
): Promise<MetricsAnswer> {
  const config = options.config ?? metricsConfig();
  const token = usableToken(config);
  if (!config.enabled || (!options.viaPort && !token)) {
    return { status: 404, body: "Not Found" };
  }
  if (token && !bearerMatches(authorization, token)) {
    return { status: 401, body: "Unauthorized" };
  }
  registerCollectors();
  return { status: 200, body: await registry.render() };
}

/** The separate metrics listener, when MARGAYA_METRICS_PORT is set. */
export function startMetricsServer(
  config: MetricsConfig = metricsConfig(),
): Server | null {
  for (const warning of metricsConfigWarnings(config)) {
    console.warn(`[metrics] ${warning}`);
  }
  if (!config.enabled || config.port === null) return null;
  const server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0];
    if (request.method !== "GET" || path !== "/metrics") {
      response
        .writeHead(404, { "content-type": "text/plain" })
        .end("Not Found");
      return;
    }
    answerMetricsRequest(request.headers.authorization, {
      viaPort: true,
      config,
    })
      .then((answer) => {
        response
          .writeHead(answer.status, {
            "content-type":
              answer.status === 200 ? PROMETHEUS_CONTENT_TYPE : "text/plain",
            "cache-control": "no-store",
          })
          .end(answer.body);
      })
      .catch((error) => {
        console.error("Metrics scrape failed:", error);
        response.writeHead(500, { "content-type": "text/plain" }).end("Error");
      });
  });
  server.on("error", (error) => {
    console.error(
      `[metrics] Could not listen on ${config.host}:${config.port}:`,
      error.message,
    );
  });
  server.listen(config.port, config.host, () => {
    console.log(
      `📈 Metrics are served at http://${config.host}:${config.port}/metrics`,
    );
  });
  return server;
}

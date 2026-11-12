import { monitorEventLoopDelay } from "node:perf_hooks";
import { getDatabasePool } from "../database";
import { openPageRoomCount } from "../page/collab/rooms";
import { appVersion } from "../utils/app-version";
import { localConnectionCounts } from "../ws";
import { registry } from "./instruments";
import { readQueueBacklogs } from "./queues";

// Values read when Prometheus scrapes: process stats, the database pool,
// open sockets and queue backlogs. Registered once, by the metrics endpoint.

const STARTED_AT_SECONDS = Math.floor(Date.now() / 1000 - process.uptime());
const QUEUE_TIMEOUT_MS = 2_000;

let registered = false;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${ms} ms`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

export function registerCollectors(): void {
  if (registered) return;
  registered = true;

  const buildInfo = registry.gauge(
    "margaya_build_info",
    "Always 1; the labels name the running Margaya and Node.js versions.",
    ["version", "node"],
  );
  const startTime = registry.gauge(
    "process_start_time_seconds",
    "Start time of the process since the Unix epoch, in seconds.",
  );
  const cpuUser = registry.counter(
    "process_cpu_user_seconds_total",
    "User CPU time spent, in seconds.",
  );
  const cpuSystem = registry.counter(
    "process_cpu_system_seconds_total",
    "System CPU time spent, in seconds.",
  );
  const residentMemory = registry.gauge(
    "process_resident_memory_bytes",
    "Resident memory size, in bytes.",
  );
  const heap = registry.gauge(
    "nodejs_heap_size_bytes",
    "V8 heap, by state (used, total).",
    ["state"],
  );
  const externalMemory = registry.gauge(
    "nodejs_external_memory_bytes",
    "Memory of C++ objects bound to JavaScript objects, in bytes.",
  );
  const eventLoopLag = registry.gauge(
    "nodejs_eventloop_lag_seconds",
    "Event loop delay since the last scrape, by quantile (p50, p99, max).",
    ["quantile"],
  );
  const pool = registry.gauge(
    "margaya_db_pool_connections",
    "Database pool connections, by state (total, idle, waiting, max).",
    ["state"],
  );
  const sockets = registry.gauge(
    "margaya_websocket_connections",
    "Open WebSocket connections on this instance, by kind (project, user).",
    ["kind"],
  );
  const pageRooms = registry.gauge(
    "margaya_page_collab_rooms",
    "Page co-editing rooms open on this instance.",
  );
  const queue = registry.gauge(
    "margaya_queue_backlog",
    "Instance-wide queue backlogs: email (notification emails waiting), webhook_pending, webhook_failed_24h.",
    ["queue"],
  );

  const loopDelay = monitorEventLoopDelay({ resolution: 20 });
  loopDelay.enable();

  registry.addCollector(() => {
    buildInfo.set({ version: appVersion(), node: process.version }, 1);
    startTime.set({}, STARTED_AT_SECONDS);
    const cpu = process.cpuUsage();
    cpuUser.setTotal({}, cpu.user / 1e6);
    cpuSystem.setTotal({}, cpu.system / 1e6);
    const memory = process.memoryUsage();
    residentMemory.set({}, memory.rss);
    heap.set({ state: "used" }, memory.heapUsed);
    heap.set({ state: "total" }, memory.heapTotal);
    externalMemory.set({}, memory.external);
    eventLoopLag.set({ quantile: "p50" }, loopDelay.percentile(50) / 1e9);
    eventLoopLag.set({ quantile: "p99" }, loopDelay.percentile(99) / 1e9);
    eventLoopLag.set({ quantile: "max" }, loopDelay.max / 1e9);
    loopDelay.reset();
  });

  registry.addCollector(() => {
    const current = getDatabasePool();
    pool.set({ state: "total" }, current.totalCount);
    pool.set({ state: "idle" }, current.idleCount);
    pool.set({ state: "waiting" }, current.waitingCount);
    pool.set({ state: "max" }, current.options.max ?? 10);

    const counts = localConnectionCounts();
    sockets.set({ kind: "project" }, counts.project);
    sockets.set({ kind: "user" }, counts.user);
    pageRooms.set({}, openPageRoomCount());
  });

  registry.addCollector(async () => {
    const backlogs = await withTimeout(readQueueBacklogs(), QUEUE_TIMEOUT_MS);
    queue.set({ queue: "email" }, backlogs.emailBacklog);
    queue.set({ queue: "webhook_pending" }, backlogs.webhookPending);
    queue.set({ queue: "webhook_failed_24h" }, backlogs.webhookFailed24h);
  });
}

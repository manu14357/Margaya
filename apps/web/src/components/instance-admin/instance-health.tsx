import {
  CircleAlert,
  CircleCheck,
  CircleMinus,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatNumber } from "@/lib/format";
import type {
  InstanceHealth,
  InstanceHealthCheck,
  InstanceJobStatus,
} from "@/types/instance-admin";
import { InstanceSection } from "./instance-page";

type CheckStatus = InstanceHealthCheck["status"];

const STATUS_BADGE = {
  ok: { variant: "success", icon: CircleCheck },
  warning: { variant: "warning", icon: TriangleAlert },
  error: { variant: "error", icon: CircleAlert },
  off: { variant: "outline", icon: CircleMinus },
} as const;

/** A status as an icon plus a word, never colour alone. */
export function HealthStatusBadge({ status }: { status: CheckStatus }) {
  const { t } = useTranslation();
  const { variant, icon: Icon } = STATUS_BADGE[status];
  const label = {
    ok: t("instanceAdmin:health.status.ok"),
    warning: t("instanceAdmin:health.status.warning"),
    error: t("instanceAdmin:health.status.error"),
    off: t("instanceAdmin:health.status.off"),
  }[status];
  return (
    <Badge
      variant={variant}
      className={variant === "outline" ? "text-muted-foreground" : undefined}
    >
      <Icon aria-hidden="true" className="size-3" />
      {label}
    </Badge>
  );
}

export function useCheckLabels() {
  const { t } = useTranslation();
  return {
    database: t("instanceAdmin:health.checks.database"),
    redis: t("instanceAdmin:health.checks.redis"),
    storage: t("instanceAdmin:health.checks.storage"),
    email: t("instanceAdmin:health.checks.email"),
    ai: t("instanceAdmin:health.checks.ai"),
  } satisfies Record<InstanceHealthCheck["id"], string>;
}

/** The sentence under a check, from its code (static keys only). */
export function useCheckDetail() {
  const { t } = useTranslation();
  return (check: InstanceHealthCheck): string => {
    switch (check.code) {
      case null:
        return t("instanceAdmin:health.codes.ok");
      case "unreachable":
        return t("instanceAdmin:health.codes.unreachable");
      case "unavailable":
        return t("instanceAdmin:health.codes.unavailable");
      case "timeout":
        return t("instanceAdmin:health.codes.timeout");
      case "failed":
        return t("instanceAdmin:health.codes.failed");
      case "disabled":
        return check.id === "redis"
          ? t("instanceAdmin:health.codes.redisDisabled")
          : t("instanceAdmin:health.codes.aiDisabled");
      case "not_configured":
        return check.id === "email"
          ? t("instanceAdmin:health.codes.emailNotConfigured")
          : t("instanceAdmin:health.codes.aiNotConfigured");
      case "s3":
        return t("instanceAdmin:health.codes.s3");
      case "local":
        return t("instanceAdmin:health.codes.local");
      case "none":
        return t("instanceAdmin:health.codes.storageOff");
      case "denied":
        return t("instanceAdmin:health.codes.denied");
      case "not_writable":
        return t("instanceAdmin:health.codes.notWritable");
      case "recent_errors":
        return t("instanceAdmin:health.codes.recentErrors", {
          count: check.count ?? 0,
        });
      case "ok":
        return t("instanceAdmin:health.codes.smtpOk");
      case "auth":
        return t("instanceAdmin:health.codes.smtpAuth");
      case "connection":
        return t("instanceAdmin:health.codes.smtpConnection");
      case "tls":
        return t("instanceAdmin:health.codes.smtpTls");
      default:
        return t("instanceAdmin:health.codes.smtpUnknown");
    }
  };
}

export function formatUptime(
  seconds: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return days > 0
    ? t("instanceAdmin:health.uptimeDays", { days, hours })
    : t("instanceAdmin:health.uptimeHours", { hours, minutes });
}

function Fact({ label, children }: { label: string; children: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium tabular-nums">{children}</dd>
    </div>
  );
}

export function HealthSummary({ health }: { health: InstanceHealth }) {
  const { t } = useTranslation();
  const { migrations } = health;
  const migrationStatus: CheckStatus =
    migrations.status === "ok"
      ? "ok"
      : migrations.status === "pending"
        ? "warning"
        : "error";
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Fact label={t("instanceAdmin:health.version")}>{health.version}</Fact>
        <Fact label={t("instanceAdmin:health.uptime")}>
          {formatUptime(health.uptimeSeconds, t)}
        </Fact>
        <Fact label={t("instanceAdmin:health.startedAt")}>
          {formatDateTime(health.startedAt)}
        </Fact>
        <Fact label={t("instanceAdmin:health.node")}>{health.nodeVersion}</Fact>
      </dl>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {t("instanceAdmin:health.migrations.title")}
          </p>
          <p className="text-xs text-muted-foreground">
            {migrations.status === "ok"
              ? t("instanceAdmin:health.migrations.ok", {
                  count: migrations.applied,
                })
              : migrations.status === "pending"
                ? t("instanceAdmin:health.migrations.pending", {
                    count: migrations.pending,
                  })
                : t("instanceAdmin:health.migrations.unknown")}
            {migrations.latest ? (
              <span className="ms-1 font-mono">{migrations.latest}</span>
            ) : null}
          </p>
        </div>
        <HealthStatusBadge status={migrationStatus} />
      </div>
    </div>
  );
}

export function HealthChecks({ checks }: { checks: InstanceHealth["checks"] }) {
  const { t } = useTranslation();
  const labels = useCheckLabels();
  const detail = useCheckDetail();
  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-card">
      {checks.map((check) => (
        <li
          key={check.id}
          className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{labels[check.id]}</p>
            <p className="text-xs text-muted-foreground">{detail(check)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {check.latencyMs !== null && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {t("instanceAdmin:health.latency", {
                  ms: formatNumber(check.latencyMs),
                })}
              </span>
            )}
            <HealthStatusBadge status={check.status} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function jobStatus(job: InstanceJobStatus): CheckStatus {
  if (job.lastOutcome === "failed") return "error";
  if (job.lastOutcome === "degraded") return "warning";
  if (job.lastOutcome === "ok") return "ok";
  return "off";
}

export function HealthJobs({ jobs }: { jobs: InstanceHealth["jobs"] }) {
  const { t } = useTranslation();
  return (
    <InstanceSection
      title={t("instanceAdmin:health.jobs.title")}
      description={t("instanceAdmin:health.jobs.description")}
      boxed={false}
    >
      {jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("instanceAdmin:health.jobs.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("instanceAdmin:health.jobs.name")}</TableHead>
                <TableHead>{t("instanceAdmin:health.jobs.lastRun")}</TableHead>
                <TableHead>{t("instanceAdmin:health.jobs.outcome")}</TableHead>
                <TableHead className="text-end">
                  {t("instanceAdmin:health.jobs.runs")}
                </TableHead>
                <TableHead className="text-end">
                  {t("instanceAdmin:health.jobs.failures")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.name}>
                  <TableCell className="font-mono text-xs">
                    {job.name}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {job.running
                      ? t("instanceAdmin:health.jobs.running")
                      : job.lastRunAt
                        ? formatDateTime(job.lastRunAt)
                        : t("instanceAdmin:health.jobs.notRun")}
                  </TableCell>
                  <TableCell>
                    {job.lastOutcome ? (
                      <HealthStatusBadge status={jobStatus(job)} />
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-end text-sm tabular-nums">
                    {formatNumber(job.runs)}
                  </TableCell>
                  <TableCell className="text-end text-sm tabular-nums">
                    {formatNumber(job.failures)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </InstanceSection>
  );
}

export function HealthFailures({
  failures,
}: {
  failures: InstanceHealth["failures"];
}) {
  const { t } = useTranslation();
  const sourceLabel = {
    job: t("instanceAdmin:health.failures.sourceJob"),
    ai: t("instanceAdmin:health.failures.sourceAi"),
    email: t("instanceAdmin:health.failures.sourceEmail"),
  };
  return (
    <InstanceSection
      title={t("instanceAdmin:health.failures.title")}
      description={t("instanceAdmin:health.failures.description")}
      boxed={false}
    >
      {failures.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("instanceAdmin:health.failures.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {failures.map((failure, index) => (
            <li
              // Failures have no id; the list is replaced as a whole.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              key={`${String(failure.at)}-${index}`}
              className="space-y-1 px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline">{sourceLabel[failure.source]}</Badge>
                <span className="font-mono text-xs">{failure.name}</span>
                <time
                  dateTime={String(failure.at)}
                  className="ms-auto text-xs text-muted-foreground"
                >
                  {formatDateTime(failure.at)}
                </time>
              </div>
              <p className="break-words text-xs text-muted-foreground">
                {failure.message ?? t("instanceAdmin:health.failures.seeLog")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </InstanceSection>
  );
}

export function HealthActivity({ health }: { health: InstanceHealth }) {
  const { t } = useTranslation();
  const { queues, connections, metrics } = health;
  const metricsState = !metrics.enabled
    ? t("instanceAdmin:health.activity.metricsOff")
    : metrics.port !== null
      ? t("instanceAdmin:health.activity.metricsPort", { port: metrics.port })
      : metrics.token
        ? t("instanceAdmin:health.activity.metricsToken")
        : t("instanceAdmin:health.activity.metricsNoEndpoint");
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Fact label={t("instanceAdmin:health.activity.emailBacklog")}>
          {queues ? formatNumber(queues.emailBacklog) : "-"}
        </Fact>
        <Fact label={t("instanceAdmin:health.activity.webhookPending")}>
          {queues ? formatNumber(queues.webhookPending) : "-"}
        </Fact>
        <Fact label={t("instanceAdmin:health.activity.webhookFailed")}>
          {queues ? formatNumber(queues.webhookFailed24h) : "-"}
        </Fact>
        <Fact label={t("instanceAdmin:health.activity.boardSockets")}>
          {formatNumber(connections.project)}
        </Fact>
        <Fact label={t("instanceAdmin:health.activity.userSockets")}>
          {formatNumber(connections.user)}
        </Fact>
        <Fact label={t("instanceAdmin:health.activity.pageRooms")}>
          {formatNumber(connections.pageRooms)}
        </Fact>
      </dl>
      <p className="text-xs text-muted-foreground">
        {t("instanceAdmin:health.activity.metrics", { state: metricsState })}
      </p>
    </div>
  );
}

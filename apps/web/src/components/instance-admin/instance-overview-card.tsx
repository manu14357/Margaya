import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/format";
import type { InstanceOverview } from "@/types/instance-admin";

type InstanceOverviewCardProps = { overview: InstanceOverview };

type ServerFlag = Exclude<keyof InstanceOverview["server"], "realtime">;

const COUNT_KEYS = [
  ["accounts", "instanceAdmin:general.counts.accounts"],
  ["guests", "instanceAdmin:general.counts.guests"],
  ["workspaces", "instanceAdmin:general.counts.workspaces"],
  ["projects", "instanceAdmin:general.counts.projects"],
  ["publishedBoards", "instanceAdmin:general.counts.publishedBoards"],
] as const satisfies ReadonlyArray<
  readonly [keyof InstanceOverview["counts"], string]
>;

// Services report Configured / Not configured; deployment modes On / Off.
const SERVER_FLAGS = [
  ["email", "instanceAdmin:general.server.email", "configured"],
  ["fileStorage", "instanceAdmin:general.server.fileStorage", "configured"],
  ["captcha", "instanceAdmin:general.server.captcha", "configured"],
  [
    "errorReporting",
    "instanceAdmin:general.server.errorReporting",
    "configured",
  ],
  ["cloudMode", "instanceAdmin:general.server.cloudMode", "mode"],
  ["demoMode", "instanceAdmin:general.server.demoMode", "mode"],
] as const satisfies ReadonlyArray<
  readonly [ServerFlag, string, "configured" | "mode"]
>;

/** Version, counts and which server services are configured (never values). */
export function InstanceOverviewCard({ overview }: InstanceOverviewCardProps) {
  const { t } = useTranslation();
  const { counts, server } = overview;

  const flagLabel = (value: boolean, kind: "configured" | "mode") => {
    if (kind === "mode") {
      return value
        ? t("instanceAdmin:general.server.on")
        : t("instanceAdmin:general.server.off");
    }
    return value
      ? t("instanceAdmin:general.server.configured")
      : t("instanceAdmin:general.server.notConfigured");
  };

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          {t("instanceAdmin:general.version")}
        </span>
        <span className="font-mono text-xs">{overview.version}</span>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {COUNT_KEYS.map(([key, labelKey]) => (
          <div
            key={key}
            className="rounded-md border border-border bg-card px-3 py-2"
          >
            <dt className="text-xs text-muted-foreground">{t(labelKey)}</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {formatNumber(counts[key])}
            </dd>
          </div>
        ))}
      </dl>

      <div className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("instanceAdmin:general.server.title")}
        </h3>
        <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <li className="flex items-center justify-between gap-2 text-sm">
            <span>{t("instanceAdmin:general.server.realtime")}</span>
            <Badge variant="secondary" size="sm">
              {server.realtime === "memory"
                ? t("instanceAdmin:general.server.realtimeMemory")
                : t("instanceAdmin:general.server.realtimeRedis", {
                    mode: server.realtime,
                  })}
            </Badge>
          </li>
          {SERVER_FLAGS.map(([key, labelKey, kind]) => (
            <li
              key={key}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span>{t(labelKey)}</span>
              <Badge
                variant={server[key] ? "success" : "outline"}
                size="sm"
                className={server[key] ? undefined : "text-muted-foreground"}
              >
                {flagLabel(server[key], kind)}
              </Badge>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

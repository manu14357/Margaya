import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import type { EstimateCalibration } from "@/fetchers/insight/insight";
import { useEstimateCalibration } from "@/hooks/queries/insight/use-insight";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatEstimateValue } from "@/lib/estimate/format";

/**
 * Team calibration (#9): for each estimate value, how long tasks of that
 * size really took, first start to done. Shown to people who may read
 * analytics; it describes the team's estimates, never a person.
 */
export default function EstimateCalibrationCard({
  projectId,
}: {
  projectId: string;
}) {
  const { canReadAnalytics, isCheckingPermissions } = useWorkspacePermission();
  if (isCheckingPermissions || !canReadAnalytics()) return null;
  return <CalibrationBody projectId={projectId} />;
}

function CalibrationBody({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { data, isPending, isError } = useEstimateCalibration(projectId);
  if (isError) return null;
  return (
    <section className="space-y-3" aria-labelledby="estimate-calibration">
      <div className="space-y-1">
        <h2 id="estimate-calibration" className="text-md font-medium">
          {t("insight:calibration.title")}
        </h2>
        <p className="text-muted-foreground text-xs">
          {t("insight:calibration.description", {
            days: data?.windowDays ?? 180,
          })}
        </p>
      </div>
      {isPending || !data ? (
        <Skeleton className="h-24 rounded-lg" />
      ) : data.status !== "ok" || data.samples === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
          {t("insight:calibration.empty")}
        </p>
      ) : (
        <CalibrationTable calibration={data} />
      )}
    </section>
  );
}

export function CalibrationTable({
  calibration,
}: {
  calibration: EstimateCalibration;
}) {
  const { t } = useTranslation();
  const type = calibration.estimateType ?? "points";
  const scale = Math.max(
    1,
    ...calibration.buckets.map((bucket) => bucket.max ?? 0),
  );
  const pct = (value: number) => `${Math.min(100, (value / scale) * 100)}%`;
  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <table className="w-full text-sm">
        <caption className="sr-only">{t("insight:calibration.title")}</caption>
        <thead>
          <tr className="text-left text-muted-foreground text-xs">
            <th scope="col" className="pb-1 font-normal">
              {t("insight:calibration.estimate")}
            </th>
            <th scope="col" className="pb-1 font-normal">
              {t("insight:calibration.tasks")}
            </th>
            <th scope="col" className="w-1/2 pb-1 font-normal">
              {t("insight:calibration.actual")}
            </th>
          </tr>
        </thead>
        <tbody>
          {calibration.buckets.map((bucket) => (
            <tr key={bucket.id} className="border-t">
              <th scope="row" className="py-1.5 pe-3 text-left font-medium">
                {formatEstimateValue(type, bucket.value, { withUnit: true, t })}
              </th>
              <td className="py-1.5 pe-3 text-muted-foreground tabular-nums">
                {bucket.samples}
              </td>
              <td className="py-1.5">
                {bucket.samples === 0 ||
                bucket.median === null ||
                bucket.p25 === null ||
                bucket.p75 === null ? (
                  <span className="text-muted-foreground text-xs">—</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <div
                      aria-hidden="true"
                      className="relative h-2 flex-1 rounded-full bg-muted"
                    >
                      <div
                        className="absolute inset-y-0 rounded-full bg-foreground/25"
                        style={{
                          insetInlineStart: pct(bucket.p25),
                          width: `calc(${pct(bucket.p75)} - ${pct(bucket.p25)})`,
                          minWidth: "2px",
                        }}
                      />
                      <div
                        className="-translate-x-1/2 absolute inset-y-[-2px] w-0.5 rounded bg-foreground"
                        style={{ insetInlineStart: pct(bucket.median) }}
                      />
                    </div>
                    <span className="w-36 shrink-0 text-muted-foreground text-xs tabular-nums">
                      {t("insight:calibration.range", {
                        median: bucket.median,
                        low: bucket.p25,
                        high: bucket.p75,
                      })}
                    </span>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted-foreground text-xs">
        {calibration.ordered === true
          ? t("insight:calibration.ordered")
          : calibration.ordered === false
            ? t("insight:calibration.notOrdered")
            : t("insight:calibration.fewSamples")}
        {calibration.unmeasured > 0 &&
          ` ${t("insight:calibration.unmeasured", { count: calibration.unmeasured })}`}
      </p>
    </div>
  );
}

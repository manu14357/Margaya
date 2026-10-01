import { useTranslation } from "react-i18next";
import { formatEstimateValue, type Translate } from "@/lib/estimate/format";
import {
  ESTIMATE_REASON_KEYS,
  isEstimateChangeReason,
} from "@/lib/estimate/messages";
import { isEstimateType } from "@/lib/estimate/values";

type EstimateChangeData = Record<string, unknown>;

/**
 * A value as history recorded it: formatted for its own system's type (time
 * from minutes, points with their unit), or null when there was none.
 */
function recordedValue(
  value: unknown,
  type: unknown,
  t: Translate,
): string | null {
  if (typeof value !== "string" || value === "") return null;
  return isEstimateType(type)
    ? formatEstimateValue(type, value, { withUnit: true, t })
    : value;
}

/** The sentence for an `estimate_changed` activity entry. */
export function estimateActivitySentence(
  eventData: EstimateChangeData,
  t: Translate,
): string {
  const from = recordedValue(eventData.oldValue, eventData.oldType, t);
  const to = recordedValue(eventData.newValue, eventData.newType, t);
  if (from && to) return t("activity:estimateChanged", { from, to });
  if (to) return t("activity:estimateSet", { to });
  return t("activity:estimateRemoved", { from: from ?? "" });
}

/**
 * "set the estimate to 5 pts", "changed the estimate from M to L", or
 * "removed the estimate 1h 30m", plus why when it wasn't a direct edit.
 * The values are the snapshot taken at the time, so history stays readable
 * after values are renamed or deleted.
 */
export default function EstimateActivityText({
  eventData,
}: {
  eventData: EstimateChangeData;
}) {
  const { t } = useTranslation();
  const reason = isEstimateChangeReason(eventData.reason)
    ? eventData.reason
    : null;

  return (
    <span className="text-sm text-muted-foreground">
      {estimateActivitySentence(eventData, t)}
      {reason && (
        <span className="text-muted-foreground/70">
          {" "}
          {t(ESTIMATE_REASON_KEYS[reason])}
        </span>
      )}
    </span>
  );
}

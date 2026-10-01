import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { bucketLabel } from "@/lib/analytics/labels";
import type {
  AnalyticsDateBucket,
  AnalyticsDimension,
  AnalyticsMeta,
} from "@/types/analytics";

type LabelSource = {
  meta?: Partial<AnalyticsMeta>;
  dateBucket?: AnalyticsDateBucket | null;
  today?: string;
};

/** `labelOf(dimension, key)` bound to a result's meta and the language. */
export function useLabelOf(source: LabelSource | null | undefined) {
  const { t } = useTranslation();
  const meta = source?.meta;
  const dateBucket = source?.dateBucket;
  const today = source?.today;
  return useCallback(
    (dimension: AnalyticsDimension, key: string) =>
      bucketLabel(dimension, key, { t, meta, dateBucket, today }),
    [t, meta, dateBucket, today],
  );
}

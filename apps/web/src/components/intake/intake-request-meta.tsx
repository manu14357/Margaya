import { useTranslation } from "react-i18next";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import type { IntakeItem } from "@/types/intake";

/** "Submitted by Ana 2 hours ago · via API". */
export default function IntakeRequestMeta({ item }: { item: IntakeItem }) {
  const { t } = useTranslation();
  const name = item.submittedBy?.name ?? t("common:people.someone");

  return (
    <p className="text-muted-foreground text-xs">
      <span title={formatDateTime(item.createdAt)}>
        {t("intake:detail.submittedBy", {
          name,
          time: formatRelativeTime(item.createdAt),
        })}
      </span>
      {item.source !== "in_app" && (
        <>
          <span aria-hidden="true"> · </span>
          {t("intake:detail.via", {
            source: t(`intake:source.${item.source}`),
          })}
        </>
      )}
    </p>
  );
}

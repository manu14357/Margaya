import { useTranslation } from "react-i18next";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import type { IntakeItem } from "@/types/intake";
import { intakeSourceLabel } from "./intake-source-icon";
import { intakeSubmitterName } from "./intake-submitter";

/** "Submitted by Ana 2 hours ago · via API". */
export default function IntakeRequestMeta({ item }: { item: IntakeItem }) {
  const { t } = useTranslation();
  const name = intakeSubmitterName(item, t("common:people.someone"));
  const email = item.externalSubmitter?.email ?? null;

  return (
    <p className="text-muted-foreground text-xs">
      <span title={formatDateTime(item.createdAt)}>
        {t("intake:detail.submittedBy", {
          name,
          time: formatRelativeTime(item.createdAt),
        })}
      </span>
      {email && email !== name && (
        <>
          <span aria-hidden="true"> · </span>
          <a
            className="underline-offset-2 hover:underline"
            href={`mailto:${email}`}
          >
            {email}
          </a>
        </>
      )}
      {item.source !== "in_app" && (
        <>
          <span aria-hidden="true"> · </span>
          {t("intake:detail.via", {
            source: intakeSourceLabel(t, item.source),
          })}
        </>
      )}
    </p>
  );
}

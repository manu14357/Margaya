import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { INTAKE_STATUS_META } from "@/lib/intake";
import type { IntakeStatus } from "@/types/intake";

/** A request's status: icon and label in the status's existing tone. */
export default function IntakeStatusBadge({
  status,
  className,
}: {
  status: IntakeStatus;
  className?: string;
}) {
  const { t } = useTranslation();
  const meta = INTAKE_STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge
      variant={meta.badgeVariant}
      className={className}
      title={t(meta.descriptionKey)}
    >
      <Icon aria-hidden="true" />
      {t(meta.labelKey)}
    </Badge>
  );
}

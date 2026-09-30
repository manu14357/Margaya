import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { MODULE_STATUS_META } from "@/lib/module/status";
import type { ModuleStatus } from "@/types/module";

type ModuleStatusIconProps = {
  status: ModuleStatus;
  className?: string;
};

/** The status icon, labelled for screen readers. */
export function ModuleStatusIcon({ status, className }: ModuleStatusIconProps) {
  const { t } = useTranslation();
  const meta = MODULE_STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Icon
      role="img"
      aria-label={t(meta.labelKey)}
      className={cn("size-4 shrink-0", meta.iconClassName, className)}
    />
  );
}

/** Icon and label, as shown in chips and triggers. */
export function ModuleStatusLabel({
  status,
  className,
}: ModuleStatusIconProps) {
  const { t } = useTranslation();
  const meta = MODULE_STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Icon
        aria-hidden
        className={cn("size-3.5 shrink-0", meta.iconClassName)}
      />
      <span className="truncate">{t(meta.labelKey)}</span>
    </span>
  );
}

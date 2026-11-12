import {
  CircleAlert,
  CircleCheck,
  CircleX,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import {
  HEALTH_LABEL_KEYS,
  type TemplateHealth,
} from "@/lib/project-updates/template";

// A project update's health: an icon and a word in its status colour, so it
// never reads by colour alone.

export const HEALTH_STYLES: Record<
  TemplateHealth,
  { icon: LucideIcon; color: string }
> = {
  on_track: { icon: CircleCheck, color: "var(--status-completed-fg)" },
  at_risk: { icon: CircleAlert, color: "var(--status-started-fg)" },
  off_track: { icon: CircleX, color: "var(--status-cancelled-fg)" },
};

export default function HealthBadge({
  health,
  className,
}: {
  health: TemplateHealth;
  className?: string;
}) {
  const { t } = useTranslation();
  const { icon: Icon, color } = HEALTH_STYLES[health];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-medium text-xs",
        className,
      )}
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
    >
      <Icon aria-hidden className="size-3.5" />
      {t(HEALTH_LABEL_KEYS[health])}
    </span>
  );
}

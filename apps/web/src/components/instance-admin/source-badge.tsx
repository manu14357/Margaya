import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDateMedium } from "@/lib/format";
import { sourceBadgeOf } from "@/lib/instance-settings";
import type { InstanceSettingEntry } from "@/types/instance-admin";

type SourceBadgeProps = {
  entry: Pick<
    InstanceSettingEntry,
    "source" | "envVar" | "updatedAt" | "updatedBy"
  >;
};

/** Where a setting's value comes from: default, saved here, or environment. */
export function SourceBadge({ entry }: SourceBadgeProps) {
  const { t } = useTranslation();
  const badge = sourceBadgeOf(entry);

  if (badge.kind === "default") {
    return (
      <Badge variant="outline" size="sm" className="text-muted-foreground">
        {t(badge.labelKey)}
      </Badge>
    );
  }

  const tooltip =
    badge.kind === "environment"
      ? t(badge.tooltipKey, { variable: badge.variable })
      : badge.tooltipKey && badge.by && badge.at
        ? t(badge.tooltipKey, {
            name: badge.by,
            date: formatDateMedium(badge.at),
          })
        : null;
  const label =
    badge.kind === "environment"
      ? t(badge.labelKey, { variable: badge.variable })
      : t(badge.labelKey);
  const content = (
    <>
      {badge.kind === "environment" && <Lock aria-hidden />}
      <span className="truncate">{label}</span>
    </>
  );

  if (!tooltip) {
    return (
      <Badge variant="secondary" size="sm">
        {content}
      </Badge>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Badge
              variant={badge.kind === "environment" ? "warning" : "secondary"}
              size="sm"
              className="max-w-full cursor-default"
            />
          }
        >
          {content}
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatEstimateValue } from "@/lib/estimate/format";
import { ESTIMATE_TYPE_LABEL_KEYS } from "@/lib/estimate/messages";
import type { Estimate } from "@/types/estimate";

type OtherEstimateSystemsProps = {
  estimates: readonly Estimate[];
  canEdit: boolean;
  onUse: (estimate: Estimate) => void;
  onDelete: (estimate: Estimate) => void;
};

/**
 * Systems the project isn't using: switch back to one, or delete it. No task
 * uses an inactive system, so deleting one changes no task.
 */
export default function OtherEstimateSystems({
  estimates,
  canEdit,
  onUse,
  onDelete,
}: OtherEstimateSystemsProps) {
  const { t } = useTranslation();
  if (estimates.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-md font-medium">
          {t("settings:projectEstimates.otherTitle")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("settings:projectEstimates.otherDescription")}
        </p>
      </div>
      <div className="space-y-1">
        {estimates.map((estimate) => (
          <div
            key={estimate.id}
            className="flex items-center gap-3 rounded-md border border-border bg-sidebar p-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-sm">
                  {estimate.name}
                </span>
                <Badge variant="secondary">
                  {t(ESTIMATE_TYPE_LABEL_KEYS[estimate.type])}
                </Badge>
              </div>
              <p className="truncate text-muted-foreground text-xs">
                {[...estimate.points]
                  .sort((a, b) => a.position - b.position)
                  .map((point) =>
                    formatEstimateValue(estimate.type, point.value, { t }),
                  )
                  .join(", ")}
              </p>
            </div>
            {canEdit && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onUse(estimate)}
                >
                  {t("settings:projectEstimates.actions.useThis")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  aria-label={t("settings:projectEstimates.actions.delete")}
                  onClick={() => onDelete(estimate)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

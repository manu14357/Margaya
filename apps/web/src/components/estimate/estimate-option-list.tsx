import { Check, Ruler } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ShortcutNumber } from "@/components/ui/shortcut-number";
import { useNumberedShortcuts } from "@/hooks/use-numbered-shortcuts";
import { cn } from "@/lib/cn";
import { formatEstimateValue } from "@/lib/estimate/format";
import type { Estimate } from "@/types/estimate";

type EstimateOptionListProps = {
  estimate: Pick<Estimate, "type" | "points">;
  /** The current point; null means "No estimate", undefined means none. */
  selectedId: string | null | undefined;
  onSelect: (pointId: string | null) => void;
  /** Number keys 1–9 pick options while the list is open. */
  shortcutsEnabled?: boolean;
};

/**
 * "No estimate", then the active system's values in order. Shared by the
 * task sidebar, the create-task modal and the bulk-actions bar.
 */
export default function EstimateOptionList({
  estimate,
  selectedId,
  onSelect,
  shortcutsEnabled = false,
}: EstimateOptionListProps) {
  const { t } = useTranslation();
  const options = useMemo(
    () => [
      { id: null, label: t("tasks:estimate.none") },
      ...[...estimate.points]
        .sort((a, b) => a.position - b.position)
        .map((point) => ({
          id: point.id,
          label: formatEstimateValue(estimate.type, point.value, {
            withUnit: true,
            t,
          }),
        })),
    ],
    [estimate, t],
  );

  const shortcutOptions = useMemo(
    () => options.map((option) => ({ onSelect: () => onSelect(option.id) })),
    [options, onSelect],
  );
  useNumberedShortcuts(shortcutsEnabled, shortcutOptions);

  return (
    <div className="max-h-80 overflow-y-auto">
      {options.map((option, index) => {
        const isSelected = selectedId !== undefined && selectedId === option.id;
        return (
          <Button
            key={option.id ?? "none"}
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-start gap-2 rounded-none px-2 first:rounded-t-md last:rounded-b-md"
            onClick={() => onSelect(option.id)}
          >
            <Ruler className="size-3.5 text-muted-foreground" />
            <span
              className={cn(
                "truncate text-sm",
                option.id === null && "text-muted-foreground",
              )}
            >
              {option.label}
            </span>
            {isSelected ? (
              <Check className="ml-auto size-4" />
            ) : shortcutsEnabled && index < 9 ? (
              <ShortcutNumber number={index + 1} />
            ) : null}
          </Button>
        );
      })}
    </div>
  );
}

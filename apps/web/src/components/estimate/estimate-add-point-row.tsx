import { Plus } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { estimatePlaceholderKey } from "@/lib/estimate/messages";
import { type EstimateType, MAX_ESTIMATE_POINTS } from "@/lib/estimate/values";

type EstimateAddPointRowProps = {
  type: EstimateType;
  value: string;
  onChange: (text: string) => void;
  onAdd: () => void;
  error: string | null;
  /** How many values the system has; the row gives way to a hint at 10. */
  count: number;
  pending?: boolean;
};

/** The input and "Add" button under an estimate system's values. */
export default function EstimateAddPointRow({
  type,
  value,
  onChange,
  onAdd,
  error,
  count,
  pending = false,
}: EstimateAddPointRowProps) {
  const { t } = useTranslation();
  const errorId = `${useId()}-error`;

  if (count >= MAX_ESTIMATE_POINTS) {
    return (
      <p className="text-muted-foreground text-xs">
        {t("settings:projectEstimates.values.maxHint")}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAdd();
            }
          }}
          placeholder={t(estimatePlaceholderKey(type))}
          aria-label={t("settings:projectEstimates.values.newAria")}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          disabled={pending}
          className="h-8 flex-1 text-sm"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          onClick={onAdd}
          disabled={pending || value.trim() === ""}
          loading={pending}
        >
          <Plus className="size-3.5" />
          {t("settings:projectEstimates.values.add")}
        </Button>
      </div>
      {error && (
        <p id={errorId} className="px-1 text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

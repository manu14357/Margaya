import { useTranslation } from "react-i18next";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
import type { FilterGroupOp } from "@/lib/task-query/model";

type MatchPillProps = {
  op: FilterGroupOp;
  onChange: (op: FilterGroupOp) => void;
  disabled?: boolean;
};

/** "Match all" / "Match any": how the root conditions combine. */
export default function MatchPill({ op, onChange, disabled }: MatchPillProps) {
  const { t } = useTranslation();
  return (
    <ToggleGroup
      size="sm"
      variant="outline"
      disabled={disabled}
      value={[op]}
      onValueChange={(values) => {
        const next = values[0];
        if (next === "and" || next === "or") onChange(next);
      }}
    >
      <Toggle value="and">{t("tasks:filters.matchAll")}</Toggle>
      <Toggle value="or">{t("tasks:filters.matchAny")}</Toggle>
    </ToggleGroup>
  );
}

import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/cn";
import {
  COLUMN_GROUP_META,
  CREATABLE_COLUMN_GROUPS,
  type CreatableColumnGroup,
} from "@/lib/column-groups";

type ColumnGroupSelectProps = {
  value: CreatableColumnGroup;
  onChange: (group: CreatableColumnGroup) => void;
  disabled?: boolean;
  size?: "sm" | "default";
  className?: string;
  "aria-label"?: string;
};

function isCreatableGroup(value: unknown): value is CreatableColumnGroup {
  return (CREATABLE_COLUMN_GROUPS as readonly unknown[]).includes(value);
}

// Triage is reserved for intake, so it is never offered here.
export default function ColumnGroupSelect({
  value,
  onChange,
  disabled,
  size = "sm",
  className,
  "aria-label": ariaLabel,
}: ColumnGroupSelectProps) {
  const { t } = useTranslation();
  const selected = COLUMN_GROUP_META[value];
  const SelectedIcon = selected.icon;

  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (isCreatableGroup(next) && next !== value) onChange(next);
      }}
    >
      <SelectTrigger
        size={size}
        aria-label={ariaLabel}
        className={cn("h-8 w-40 min-w-0 text-sm", className)}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <SelectedIcon
            className={cn("size-3.5 shrink-0", selected.iconClassName)}
          />
          <span className="truncate">{t(selected.labelKey)}</span>
        </span>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="w-64">
        {CREATABLE_COLUMN_GROUPS.map((group) => {
          const meta = COLUMN_GROUP_META[group];
          const Icon = meta.icon;
          return (
            <SelectItem key={group} value={group}>
              <span className="flex items-start gap-2 py-0.5">
                <Icon
                  className={cn("mt-0.5 size-3.5 shrink-0", meta.iconClassName)}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm">{t(meta.labelKey)}</span>
                  <span className="text-xs text-muted-foreground">
                    {t(meta.descriptionKey)}
                  </span>
                </span>
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

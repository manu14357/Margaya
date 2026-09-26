import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  isRelationDisplayKey,
  RELATION_DISPLAY_KEYS,
  RELATION_META,
  type RelationDisplayKey,
} from "@/lib/task-relations";

type RelationTypeSelectProps = {
  value: RelationDisplayKey;
  onChange: (value: RelationDisplayKey) => void;
};

/** Picks how the chosen task relates to this one, read from this task's side. */
export default function RelationTypeSelect({
  value,
  onChange,
}: RelationTypeSelectProps) {
  const { t } = useTranslation();
  const labelId = useId();
  const SelectedIcon = RELATION_META[value].icon;

  return (
    <div className="flex items-center gap-2">
      <span id={labelId} className="text-muted-foreground text-xs">
        {t("tasks:relations.relationLabel")}
      </span>
      <Select
        value={value}
        onValueChange={(next) => {
          if (isRelationDisplayKey(next)) onChange(next);
        }}
      >
        <SelectTrigger
          size="sm"
          aria-labelledby={labelId}
          className="h-7 min-h-7 w-auto min-w-40 text-xs sm:min-h-7"
        >
          <SelectValue>
            <span className="flex items-center gap-1.5">
              <SelectedIcon className="size-3.5 text-muted-foreground" />
              {t(RELATION_META[value].groupKey)}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {RELATION_DISPLAY_KEYS.map((key) => {
            const Icon = RELATION_META[key].icon;
            return (
              <SelectItem key={key} value={key}>
                <span className="flex items-center gap-2">
                  <Icon className="size-3.5 text-muted-foreground" />
                  {t(RELATION_META[key].groupKey)}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

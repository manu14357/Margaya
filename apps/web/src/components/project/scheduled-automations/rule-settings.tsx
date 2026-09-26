import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAutomationPreview } from "@/hooks/queries/project-automation/use-automation-preview";
import { AUTOMATION_MONTH_OPTIONS, previewLine } from "@/lib/automation";
import { cn } from "@/lib/cn";
import { getColumnIcon } from "@/lib/column";
import { formatRelativeTime } from "@/lib/format";
import type { AutomationRule } from "@/types/project-automation";

export type CancelColumnOption = {
  id: string;
  slug: string;
  name: string;
  icon?: string | null;
  group?: string | null;
};

const COPY = {
  archive: {
    after: "settings:projectAutomations.autoArchive.after",
    last: "settings:projectAutomations.lastArchived",
    never: "settings:projectAutomations.neverArchived",
  },
  close: {
    after: "settings:projectAutomations.autoClose.after",
    last: "settings:projectAutomations.lastClosed",
    never: "settings:projectAutomations.neverClosed",
  },
} as const;

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground text-xs">{label}</span>
      {children}
    </div>
  );
}

type RuleSettingsProps = {
  workspaceId: string;
  projectId: string;
  rule: AutomationRule;
  months: number;
  disabled: boolean;
  onMonthsChange: (months: number) => void;
  lastRunAt: string | null;
  lastRunCount: number;
  /** Auto-close only: its target column. */
  column?: {
    value: string | null;
    options: readonly CancelColumnOption[];
    paused: boolean;
    onChange: (columnId: string) => void;
  };
};

/** The settings under a rule that is on: months, column, preview, last run. */
export default function RuleSettings({
  workspaceId,
  projectId,
  rule,
  months,
  disabled,
  onMonthsChange,
  lastRunAt,
  lastRunCount,
  column,
}: RuleSettingsProps) {
  const { t } = useTranslation();
  const copy = COPY[rule];
  const { data: preview, isError } = useAutomationPreview({
    workspaceId,
    projectId,
    rule,
    months,
    enabled: true,
  });
  const line = previewLine(preview);
  const selectedColumn = column?.options.find(
    (option) => option.id === column.value,
  );

  return (
    <>
      <SettingRow label={t(copy.after)}>
        <Select
          value={String(months)}
          disabled={disabled}
          onValueChange={(value) => {
            const next = Number(value);
            if (Number.isInteger(next) && next !== months) onMonthsChange(next);
          }}
        >
          <SelectTrigger className="h-8 w-40 text-sm">
            <SelectValue>
              {t("settings:projectAutomations.months", { count: months })}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {AUTOMATION_MONTH_OPTIONS.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {t("settings:projectAutomations.months", { count: option })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      {column && (
        <SettingRow label={t("settings:projectAutomations.autoClose.target")}>
          <Select
            value={column.value ?? ""}
            disabled={disabled}
            onValueChange={(value) => {
              if (value && value !== column.value)
                column.onChange(String(value));
            }}
          >
            <SelectTrigger
              className={cn(
                "h-8 w-40 text-sm",
                column.paused && "border-warning ring-2 ring-warning/24",
              )}
            >
              <SelectValue>
                {selectedColumn ? (
                  <span className="flex items-center gap-1.5">
                    {getColumnIcon(
                      selectedColumn.slug,
                      false,
                      selectedColumn.icon,
                      selectedColumn.group,
                    )}
                    <span className="truncate">{selectedColumn.name}</span>
                  </span>
                ) : (
                  "—"
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {column.options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  <span className="flex items-center gap-1.5">
                    {getColumnIcon(
                      option.slug,
                      false,
                      option.icon,
                      option.group,
                    )}
                    {option.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      )}

      {column?.paused && (
        <p className="flex items-center gap-1.5 text-warning-foreground text-xs">
          <TriangleAlert className="size-3.5 shrink-0" />
          {t("settings:projectAutomations.autoClose.paused")}
        </p>
      )}

      {!isError && (
        <p className="text-muted-foreground text-xs">
          {t(line.key, line.options)}
        </p>
      )}
      <p className="text-muted-foreground text-xs">
        {lastRunAt && lastRunCount > 0
          ? t(copy.last, {
              count: lastRunCount,
              time: formatRelativeTime(lastRunAt),
            })
          : t(copy.never)}
      </p>
    </>
  );
}

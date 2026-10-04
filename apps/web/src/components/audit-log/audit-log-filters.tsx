import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import useGetWorkspaceUsers from "@/hooks/queries/workspace-users/use-get-workspace-users";
import { AUDIT_CATEGORIES, AUDIT_CATEGORY_KEYS } from "@/lib/audit-log/actions";
import {
  AUDIT_LOG_RANGES,
  DEFAULT_AUDIT_LOG_FILTERS,
  isFiltered,
} from "@/lib/audit-log/filters";
import type { AuditLogFilters, AuditLogRange } from "@/types/audit-log";

const ALL = "__all__";

const RANGE_KEYS = {
  all: "settings:workspaceAuditLog.filters.anyTime",
  "1d": "settings:workspaceAuditLog.filters.last24Hours",
  "7d": "settings:workspaceAuditLog.filters.last7Days",
  "30d": "settings:workspaceAuditLog.filters.last30Days",
  "90d": "settings:workspaceAuditLog.filters.last90Days",
} as const satisfies Record<AuditLogRange, string>;

type AuditLogFiltersBarProps = {
  workspaceId: string;
  filters: AuditLogFilters;
  onChange: (filters: AuditLogFilters) => void;
};

/** Actor, action category and date range filters for the audit log. */
export function AuditLogFiltersBar({
  workspaceId,
  filters,
  onChange,
}: AuditLogFiltersBarProps) {
  const { t } = useTranslation();
  const { data: members } = useGetWorkspaceUsers({ workspaceId });
  const selectedMember = members?.find(
    (member) => member.userId === filters.actorId,
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={filters.actorId ?? ALL}
        onValueChange={(value) =>
          onChange({
            ...filters,
            actorId: !value || value === ALL ? null : String(value),
          })
        }
      >
        <SelectTrigger
          className="w-48"
          aria-label={t("settings:workspaceAuditLog.filters.actor")}
        >
          <SelectValue>
            {filters.actorId
              ? (selectedMember?.user.name ??
                t("settings:workspaceAuditLog.filters.selectedActor"))
              : t("settings:workspaceAuditLog.filters.anyone")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-80">
          <SelectItem value={ALL}>
            {t("settings:workspaceAuditLog.filters.anyone")}
          </SelectItem>
          {members?.map((member) => (
            <SelectItem key={member.userId} value={member.userId}>
              {member.user.name || member.user.email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filters.category ?? ALL}
        onValueChange={(value) =>
          onChange({
            ...filters,
            category: !value || value === ALL ? null : String(value),
          })
        }
      >
        <SelectTrigger
          className="w-52"
          aria-label={t("settings:workspaceAuditLog.filters.category")}
        >
          <SelectValue>
            {filters.category &&
            Object.hasOwn(AUDIT_CATEGORY_KEYS, filters.category)
              ? t(
                  AUDIT_CATEGORY_KEYS[
                    filters.category as keyof typeof AUDIT_CATEGORY_KEYS
                  ],
                )
              : t("settings:workspaceAuditLog.filters.allActions")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>
            {t("settings:workspaceAuditLog.filters.allActions")}
          </SelectItem>
          {AUDIT_CATEGORIES.map((category) => (
            <SelectItem key={category} value={category}>
              {t(AUDIT_CATEGORY_KEYS[category])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filters.range}
        onValueChange={(value) => {
          const range = AUDIT_LOG_RANGES.find((option) => option === value);
          if (range) onChange({ ...filters, range });
        }}
      >
        <SelectTrigger
          className="w-44"
          aria-label={t("settings:workspaceAuditLog.filters.dateRange")}
        >
          <SelectValue>{t(RANGE_KEYS[filters.range])}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {AUDIT_LOG_RANGES.map((range) => (
            <SelectItem key={range} value={range}>
              {t(RANGE_KEYS[range])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isFiltered(filters) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(DEFAULT_AUDIT_LOG_FILTERS)}
        >
          {t("settings:workspaceAuditLog.filters.clear")}
        </Button>
      )}
    </div>
  );
}

export default AuditLogFiltersBar;

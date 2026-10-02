import { ListFilter } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CheckSlot } from "@/components/task-filters/filter-primitives";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { cn } from "@/lib/cn";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { INTAKE_STATUS_META, tabStatuses } from "@/lib/intake";
import { INTAKE_PRIORITIES } from "@/lib/intake-search";
import { getPriorityIcon } from "@/lib/priority";
import type { IntakeFilters } from "@/types/intake";

const rowClassName =
  "inline-flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs";

function rowState(selected: boolean) {
  return selected
    ? "bg-accent text-accent-foreground"
    : "text-foreground/90 hover:bg-accent/60 hover:text-foreground";
}

function FilterSubmenu({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="h-8 rounded-md text-sm">
        <span className="flex flex-1 items-center justify-between gap-2">
          <span>{label}</span>
          {count > 0 && (
            <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-medium text-[10px] text-primary-foreground">
              {count}
            </span>
          )}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56">
        <div className="grid max-h-80 grid-cols-1 gap-1 overflow-y-auto p-1">
          {children}
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((entry) => entry !== value)
    : [...list, value];
}

type IntakeFilterMenuProps = {
  workspaceId: string;
  filters: IntakeFilters;
  onChange: (patch: Partial<IntakeFilters>) => void;
  /** "Submitted by" needs the whole queue (intake:read). */
  canReadAll: boolean;
  active: boolean;
};

/** Status (of the current tab), priority and submitter filters. */
export default function IntakeFilterMenu({
  workspaceId,
  filters,
  onChange,
  canReadAll,
  active,
}: IntakeFilterMenuProps) {
  const { t } = useTranslation();
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(
    canReadAll ? workspaceId : "",
  );
  const members = workspaceUsers?.members ?? [];
  const label = t("intake:filters.button");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className={cn(
              "gap-1",
              active && "border-primary/30 bg-primary/10 text-primary",
            )}
          />
        }
      >
        <ListFilter className="size-3" />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <FilterSubmenu
          label={t("intake:filters.status")}
          count={filters.statuses.length}
        >
          {tabStatuses(filters.tab).map((status) => {
            const meta = INTAKE_STATUS_META[status];
            const Icon = meta.icon;
            const checked = filters.statuses.includes(status);
            return (
              <button
                key={status}
                type="button"
                className={cn(rowClassName, rowState(checked))}
                onClick={() =>
                  onChange({ statuses: toggle(filters.statuses, status) })
                }
              >
                <CheckSlot checked={checked} />
                <Icon className="size-3.5 text-muted-foreground" />
                {t(meta.labelKey)}
              </button>
            );
          })}
        </FilterSubmenu>
        <FilterSubmenu
          label={t("intake:filters.priority")}
          count={filters.priorities.length}
        >
          {INTAKE_PRIORITIES.map((priority) => {
            const checked = filters.priorities.includes(priority);
            return (
              <button
                key={priority}
                type="button"
                className={cn(rowClassName, rowState(checked))}
                onClick={() =>
                  onChange({ priorities: toggle(filters.priorities, priority) })
                }
              >
                <CheckSlot checked={checked} />
                {getPriorityIcon(priority)}
                {getPriorityLabel(priority)}
              </button>
            );
          })}
        </FilterSubmenu>
        {canReadAll && (
          <FilterSubmenu
            label={t("intake:filters.submittedBy")}
            count={filters.submittedBy ? 1 : 0}
          >
            {[
              { id: "me", name: t("intake:filters.me") },
              ...members.map((member) => ({
                id: member.userId,
                name: member.user?.name ?? member.user?.email ?? "",
              })),
            ]
              .filter((option) => option.id)
              .map((option) => {
                const checked = filters.submittedBy === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={cn(rowClassName, rowState(checked))}
                    onClick={() =>
                      onChange({
                        submittedBy: checked ? undefined : option.id,
                      })
                    }
                  >
                    <CheckSlot checked={checked} />
                    <span className="truncate">{option.name}</span>
                  </button>
                );
              })}
          </FilterSubmenu>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { Filter } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActiveFilterChip, CheckSlot } from "@/components/board/board-toolbar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import { MODULE_LEAD_NONE, type ModuleFilters } from "@/lib/module/display";
import { MODULE_STATUS_META, MODULE_STATUS_ORDER } from "@/lib/module/status";
import { PersonAvatar, useWorkspacePeople } from "./module-people";

type ModulesFilterProps = {
  workspaceId: string;
  filters: ModuleFilters;
  onChange: (filters: ModuleFilters) => void;
};

const rowClassName =
  "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-left text-xs";

function rowState(selected: boolean) {
  return selected
    ? "bg-accent text-accent-foreground"
    : "text-foreground/90 hover:bg-accent/60 hover:text-foreground";
}

function toggle<T extends string>(values: readonly T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

function FilterRow({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(rowClassName, rowState(selected))}
      onClick={onClick}
    >
      <CheckSlot checked={selected} />
      {children}
    </button>
  );
}

function SubmenuTrigger({ label, count }: { label: string; count: number }) {
  return (
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
  );
}

/** Status, lead and member filters of the modules page. */
export default function ModulesFilterMenu({
  workspaceId,
  filters,
  onChange,
}: ModulesFilterProps) {
  const { t } = useTranslation();
  const people = useWorkspacePeople(workspaceId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 font-medium text-foreground text-xs outline-none ring-0 hover:bg-accent/60"
          />
        }
      >
        <Filter className="size-3" />
        <span className="hidden sm:inline">{t("modules:filters.menu")}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
            {t("modules:filters.filterBy")}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <SubmenuTrigger
            label={t("modules:filters.status")}
            count={filters.status.length}
          />
          <DropdownMenuSubContent className="w-56">
            <div className="grid grid-cols-1 gap-1 p-1">
              <FilterRow
                selected={filters.status.length === 0}
                onClick={() => onChange({ ...filters, status: [] })}
              >
                {t("modules:filters.allStatuses")}
              </FilterRow>
              {MODULE_STATUS_ORDER.map((status) => {
                const meta = MODULE_STATUS_META[status];
                const Icon = meta.icon;
                return (
                  <FilterRow
                    key={status}
                    selected={filters.status.includes(status)}
                    onClick={() =>
                      onChange({
                        ...filters,
                        status: toggle(filters.status, status),
                      })
                    }
                  >
                    <Icon className={cn("size-3.5", meta.iconClassName)} />
                    <span className="truncate">{t(meta.labelKey)}</span>
                  </FilterRow>
                );
              })}
            </div>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <SubmenuTrigger
            label={t("modules:filters.lead")}
            count={filters.lead.length}
          />
          <DropdownMenuSubContent className="w-64">
            <div className="grid max-h-80 grid-cols-1 gap-1 overflow-y-auto p-1">
              <FilterRow
                selected={filters.lead.length === 0}
                onClick={() => onChange({ ...filters, lead: [] })}
              >
                {t("modules:filters.anyLead")}
              </FilterRow>
              <FilterRow
                selected={filters.lead.includes(MODULE_LEAD_NONE)}
                onClick={() =>
                  onChange({
                    ...filters,
                    lead: toggle(filters.lead, MODULE_LEAD_NONE),
                  })
                }
              >
                {t("modules:filters.noLead")}
              </FilterRow>
              {people.map((person) => (
                <FilterRow
                  key={person.id}
                  selected={filters.lead.includes(person.id)}
                  onClick={() =>
                    onChange({
                      ...filters,
                      lead: toggle(filters.lead, person.id),
                    })
                  }
                >
                  <PersonAvatar person={person} className="size-4" />
                  <span className="truncate">{person.name}</span>
                </FilterRow>
              ))}
            </div>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <SubmenuTrigger
            label={t("modules:filters.members")}
            count={filters.members.length}
          />
          <DropdownMenuSubContent className="w-64">
            <div className="grid max-h-80 grid-cols-1 gap-1 overflow-y-auto p-1">
              <FilterRow
                selected={filters.members.length === 0}
                onClick={() => onChange({ ...filters, members: [] })}
              >
                {t("modules:filters.anyMember")}
              </FilterRow>
              {people.map((person) => (
                <FilterRow
                  key={person.id}
                  selected={filters.members.includes(person.id)}
                  onClick={() =>
                    onChange({
                      ...filters,
                      members: toggle(filters.members, person.id),
                    })
                  }
                >
                  <PersonAvatar person={person} className="size-4" />
                  <span className="truncate">{person.name}</span>
                </FilterRow>
              ))}
            </div>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The active filters as chips, each with its own clear button. */
export function ModulesFilterChips({
  workspaceId,
  filters,
  onChange,
}: ModulesFilterProps) {
  const { t } = useTranslation();
  const people = useWorkspacePeople(workspaceId);
  const personName = (id: string) =>
    id === MODULE_LEAD_NONE
      ? t("modules:filters.noLead")
      : (people.find((person) => person.id === id)?.name ?? "");
  const summary = (names: string[]) =>
    names.length === 1
      ? names[0]
      : t("modules:filters.selectedCount", { count: names.length });

  return (
    <>
      {filters.status.length > 0 && (
        <ActiveFilterChip
          subject={t("modules:filters.status")}
          operator={
            filters.status.length === 1
              ? t("modules:filters.is")
              : t("modules:filters.isAnyOf")
          }
          value={summary(
            filters.status.map((status) =>
              t(MODULE_STATUS_META[status].labelKey),
            ),
          )}
          onClear={() => onChange({ ...filters, status: [] })}
        />
      )}
      {filters.lead.length > 0 && (
        <ActiveFilterChip
          subject={t("modules:filters.lead")}
          operator={
            filters.lead.length === 1
              ? t("modules:filters.is")
              : t("modules:filters.isAnyOf")
          }
          value={summary(filters.lead.map(personName))}
          onClear={() => onChange({ ...filters, lead: [] })}
        />
      )}
      {filters.members.length > 0 && (
        <ActiveFilterChip
          subject={t("modules:filters.members")}
          operator={t("modules:filters.includesAnyOf")}
          value={summary(filters.members.map(personName))}
          onClear={() => onChange({ ...filters, members: [] })}
        />
      )}
    </>
  );
}

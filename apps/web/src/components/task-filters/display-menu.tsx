import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  SlidersHorizontal,
} from "lucide-react";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import {
  DEFAULT_ORDER_DIRECTION,
  type DisplayProperties,
  type DisplayPropertyKey,
  type GroupByKey,
  type OrderByField,
  type TaskDisplay,
} from "@/lib/task-query/model";

export type DisplayMenuConfig = {
  /** Group-by keys offered; empty hides grouping (spreadsheet). */
  groupByOptions: readonly GroupByKey[];
  /** Board and list layouts can sub-group. */
  allowSubGroup: boolean;
  /** Offers "Show empty groups" (query-mode grouped layouts). */
  allowEmptyGroups: boolean;
  orderOptions: readonly OrderByField[];
  propertyKeys: readonly DisplayPropertyKey[];
  /** "columns" in the spreadsheet, "properties" elsewhere. */
  propertiesTitle: "properties" | "columns";
  /** Custom fields that can be spreadsheet columns (project scope). */
  customFields?: ReadonlyArray<{ id: string; name: string }>;
};

type DisplayMenuProps = {
  display: TaskDisplay;
  onDisplayChange: (patch: Partial<TaskDisplay>) => void;
  displayProperties: DisplayProperties;
  onPropertyChange: (key: DisplayPropertyKey, value: boolean) => void;
  onCustomFieldsChange?: (ids: string[]) => void;
  config: DisplayMenuConfig;
};

const NONE = "__none__";

export const GROUP_LABEL_KEYS: Record<GroupByKey, string> = {
  status: "tasks:display.groups.status",
  group: "tasks:display.groups.group",
  priority: "tasks:display.groups.priority",
  assignee: "tasks:display.groups.assignee",
  createdBy: "tasks:display.groups.createdBy",
  label: "tasks:display.groups.label",
  cycle: "tasks:display.groups.cycle",
  module: "tasks:display.groups.module",
  estimate: "tasks:display.groups.estimate",
  project: "tasks:display.groups.project",
};

export const ORDER_LABEL_KEYS: Record<OrderByField, string> = {
  manual: "tasks:display.order.manual",
  createdAt: "tasks:display.order.createdAt",
  updatedAt: "tasks:display.order.updatedAt",
  completedAt: "tasks:display.order.completedAt",
  startDate: "tasks:display.order.startDate",
  dueDate: "tasks:display.order.dueDate",
  priority: "tasks:display.order.priority",
  title: "tasks:display.order.title",
  number: "tasks:display.order.number",
  status: "tasks:display.order.status",
  assignee: "tasks:display.order.assignee",
  label: "tasks:display.order.label",
  cycle: "tasks:display.order.cycle",
  module: "tasks:display.order.module",
  estimate: "tasks:display.order.estimate",
  subTaskCount: "tasks:display.order.subTaskCount",
  archivedAt: "tasks:display.order.archivedAt",
};

export const PROPERTY_LABEL_KEYS: Record<DisplayPropertyKey, string> = {
  key: "tasks:display.props.key",
  status: "tasks:display.props.status",
  priority: "tasks:display.props.priority",
  assignee: "tasks:display.props.assignee",
  labels: "tasks:display.props.labels",
  startDate: "tasks:display.props.startDate",
  dueDate: "tasks:display.props.dueDate",
  estimate: "tasks:display.props.estimate",
  cycle: "tasks:display.props.cycle",
  modules: "tasks:display.props.modules",
  subTaskCount: "tasks:display.props.subTaskCount",
  checklist: "tasks:display.props.checklist",
  createdAt: "tasks:display.props.createdAt",
  updatedAt: "tasks:display.props.updatedAt",
};

function Row({
  label,
  labelId,
  children,
}: {
  label: string;
  /** Lets the row's control name itself with `aria-labelledby`. */
  labelId?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span id={labelId} className="text-muted-foreground text-xs">
        {label}
      </span>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
      {children}
    </div>
  );
}

function ToggleChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      size="xs"
      variant={active ? "secondary" : "ghost"}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-6 rounded-md px-2 text-xs",
        !active && "text-muted-foreground",
      )}
    >
      {label}
    </Button>
  );
}

/** Group by, sub-group by, order, switches and properties (B4 §6.3). */
export default function DisplayMenu({
  display,
  onDisplayChange,
  displayProperties,
  onPropertyChange,
  onCustomFieldsChange,
  config,
}: DisplayMenuProps) {
  const { t } = useTranslation();
  const labelIds = useId();
  const groupLabelId = `${labelIds}-group`;
  const subGroupLabelId = `${labelIds}-sub-group`;
  const orderLabelId = `${labelIds}-order`;
  const canGroup = config.groupByOptions.length > 0;
  const groupOptions = config.groupByOptions;
  const subGroupOptions = groupOptions.filter((key) => key !== display.groupBy);
  const orderField = config.orderOptions.includes(display.orderBy.field)
    ? display.orderBy.field
    : (config.orderOptions[0] ?? "createdAt");
  const direction = display.orderBy.direction;
  const selectedCustomFields = displayProperties.customFields;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 font-medium text-foreground text-xs outline-none ring-0 hover:bg-accent/60"
          />
        }
      >
        <SlidersHorizontal className="h-3 w-3" />
        {t("tasks:display.button")}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="grid gap-3 p-3">
          {canGroup && (
            <>
              <Row label={t("tasks:display.groupBy")} labelId={groupLabelId}>
                <Select
                  value={display.groupBy ?? NONE}
                  onValueChange={(value) =>
                    onDisplayChange({
                      groupBy: value === NONE ? null : (value as GroupByKey),
                    })
                  }
                >
                  <SelectTrigger
                    size="sm"
                    className="w-40 min-w-0"
                    aria-labelledby={groupLabelId}
                  >
                    <SelectValue>
                      {display.groupBy
                        ? t(GROUP_LABEL_KEYS[display.groupBy])
                        : t("tasks:display.none")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>
                      {t("tasks:display.none")}
                    </SelectItem>
                    {groupOptions.map((key) => (
                      <SelectItem key={key} value={key}>
                        {t(GROUP_LABEL_KEYS[key])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              {config.allowSubGroup && (
                <Row
                  label={t("tasks:display.subGroupBy")}
                  labelId={subGroupLabelId}
                >
                  <Select
                    value={display.subGroupBy ?? NONE}
                    disabled={!display.groupBy}
                    onValueChange={(value) =>
                      onDisplayChange({
                        subGroupBy:
                          value === NONE ? null : (value as GroupByKey),
                      })
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-40 min-w-0"
                      aria-labelledby={subGroupLabelId}
                    >
                      <SelectValue>
                        {display.subGroupBy
                          ? t(GROUP_LABEL_KEYS[display.subGroupBy])
                          : t("tasks:display.none")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>
                        {t("tasks:display.none")}
                      </SelectItem>
                      {subGroupOptions.map((key) => (
                        <SelectItem key={key} value={key}>
                          {t(GROUP_LABEL_KEYS[key])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Row>
              )}
            </>
          )}

          <Row label={t("tasks:display.orderBy")} labelId={orderLabelId}>
            <div className="flex items-center gap-1">
              <Select
                value={orderField}
                onValueChange={(value) => {
                  const field = value as OrderByField;
                  onDisplayChange({
                    orderBy: {
                      field,
                      direction: DEFAULT_ORDER_DIRECTION[field],
                    },
                  });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-32 min-w-0"
                  aria-labelledby={orderLabelId}
                >
                  <SelectValue>{t(ORDER_LABEL_KEYS[orderField])}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {config.orderOptions.map((field) => (
                    <SelectItem key={field} value={field}>
                      {t(ORDER_LABEL_KEYS[field])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="icon-xs"
                variant="outline"
                disabled={orderField === "manual"}
                aria-label={
                  direction === "asc"
                    ? t("tasks:sort.ascending")
                    : t("tasks:sort.descending")
                }
                onClick={() =>
                  onDisplayChange({
                    orderBy: {
                      field: orderField,
                      direction: direction === "asc" ? "desc" : "asc",
                    },
                  })
                }
              >
                {direction === "asc" ? (
                  <ArrowUpNarrowWide className="size-3.5" />
                ) : (
                  <ArrowDownWideNarrow className="size-3.5" />
                )}
              </Button>
            </div>
          </Row>

          <Row label={t("tasks:display.showSubTasks")}>
            <Switch
              checked={display.showSubTasks}
              onCheckedChange={(checked) =>
                onDisplayChange({ showSubTasks: checked })
              }
            />
          </Row>
          {config.allowEmptyGroups && canGroup && (
            <Row label={t("tasks:display.showEmptyGroups")}>
              <Switch
                checked={display.showEmptyGroups}
                disabled={!display.groupBy}
                onCheckedChange={(checked) =>
                  onDisplayChange({ showEmptyGroups: checked })
                }
              />
            </Row>
          )}
        </div>

        <div className="grid gap-2 border-border border-t p-3">
          <SectionTitle>
            {config.propertiesTitle === "columns"
              ? t("tasks:display.columns")
              : t("tasks:display.properties")}
          </SectionTitle>
          <div className="flex flex-wrap gap-1">
            {config.propertyKeys.map((key) => (
              <ToggleChip
                key={key}
                active={displayProperties[key]}
                label={t(PROPERTY_LABEL_KEYS[key])}
                onClick={() => onPropertyChange(key, !displayProperties[key])}
              />
            ))}
            {onCustomFieldsChange &&
              config.customFields?.map((field) => {
                const active = selectedCustomFields.includes(field.id);
                return (
                  <ToggleChip
                    key={field.id}
                    active={active}
                    label={field.name}
                    onClick={() =>
                      onCustomFieldsChange(
                        active
                          ? selectedCustomFields.filter((id) => id !== field.id)
                          : [...selectedCustomFields, field.id],
                      )
                    }
                  />
                );
              })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

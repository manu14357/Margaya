import { SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  isDescendingOrder,
  MODULE_ORDER_FIELDS,
  type ModuleDisplaySettings,
  type ModuleOrderField,
  orderFieldOf,
  toModuleOrder,
} from "@/lib/module/display";

type ModulesDisplayMenuProps = {
  display: ModuleDisplaySettings;
  onChange: (patch: Partial<ModuleDisplaySettings>) => void;
};

const labelClassName = "text-[11px] uppercase tracking-wide";

const ORDER_LABEL_KEYS = {
  name: "modules:display.order.name",
  progress: "modules:display.order.progress",
  tasks: "modules:display.order.tasks",
  targetDate: "modules:display.order.targetDate",
  createdAt: "modules:display.order.createdAt",
  manual: "modules:display.order.manual",
} as const satisfies Record<ModuleOrderField, string>;

/** Layout, grouping and order of the modules page. */
export default function ModulesDisplayMenu({
  display,
  onChange,
}: ModulesDisplayMenuProps) {
  const { t } = useTranslation();
  const field = orderFieldOf(display.order);
  const descending = isDescendingOrder(display.order);

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
        <SlidersHorizontal className="size-3" />
        <span className="hidden sm:inline">{t("modules:display.menu")}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel className={labelClassName}>
            {t("modules:display.layout")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={display.layout}
            onValueChange={(value) =>
              onChange({ layout: value === "gallery" ? "gallery" : "list" })
            }
          >
            <DropdownMenuRadioItem value="list">
              {t("modules:display.layoutList")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="gallery">
              {t("modules:display.layoutGallery")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          variant="switch"
          checked={display.groupByStatus}
          onCheckedChange={(checked) => onChange({ groupByStatus: checked })}
        >
          {t("modules:display.groupByStatus")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className={labelClassName}>
            {t("modules:display.orderBy")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={field}
            onValueChange={(value) =>
              onChange({
                order: toModuleOrder(value as ModuleOrderField, descending),
              })
            }
          >
            {MODULE_ORDER_FIELDS.map((option) => (
              <DropdownMenuRadioItem key={option} value={option}>
                {t(ORDER_LABEL_KEYS[option])}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {field !== "manual" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className={labelClassName}>
                {t("modules:display.direction")}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={descending ? "desc" : "asc"}
                onValueChange={(value) =>
                  onChange({ order: toModuleOrder(field, value === "desc") })
                }
              >
                <DropdownMenuRadioItem value="asc">
                  {t("modules:display.ascending")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="desc">
                  {t("modules:display.descending")}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

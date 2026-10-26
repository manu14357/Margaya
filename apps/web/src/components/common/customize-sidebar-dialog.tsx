import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDown,
  ArrowUp,
  FolderKanban,
  GripVertical,
  Layers,
  RotateCcw,
  Star,
} from "lucide-react";
import { type CSSProperties, useState } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { DESTINATION_META } from "@/components/common/shell-destinations";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  ALWAYS_SHOWN_RAIL_ITEMS,
  isDefaultSidebarLayout,
  moveItem,
  type PanelSection,
  type RailItem,
  resolveSidebarLayout,
  type SidebarLayout,
} from "@/lib/sidebar-layout";
import { useUserPreferencesStore } from "@/store/user-preferences";

/** Opens the dialog from anywhere: the account menu, the preferences page. */
export const useCustomizeSidebarDialog = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

const PANEL_META: Record<PanelSection, { labelKey: string; icon: LucideIcon }> =
  {
    views: { labelKey: "navigation:customize.sections.views", icon: Layers },
    favorites: {
      labelKey: "navigation:customize.sections.favorites",
      icon: Star,
    },
    projects: {
      labelKey: "navigation:customize.sections.projects",
      icon: FolderKanban,
    },
  };

type ListItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Area hue for rail destinations; panel sections stay neutral. */
  color?: string;
  hidden: boolean;
  hideable: boolean;
};

function SortableRow({
  item,
  index,
  total,
  onMove,
  onToggle,
}: {
  item: ListItem;
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
  onToggle: (shown: boolean) => void;
}) {
  const { t } = useTranslation();
  const { setNodeRef, listeners, transform, transition, isDragging } =
    useSortable({ id: item.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const Icon = item.icon;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={
        isDragging
          ? "relative z-10 flex min-h-10 items-center gap-2 rounded-md bg-accent px-1.5"
          : "flex min-h-10 items-center gap-2 rounded-md px-1.5"
      }
    >
      {/* Pointer dragging only; the arrow buttons are the keyboard way. */}
      <span
        aria-hidden
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
        {...listeners}
      >
        <GripVertical className="size-4" />
      </span>
      <Icon
        aria-hidden
        className="size-4 shrink-0"
        strokeWidth={1.75}
        style={item.color ? { color: item.color } : undefined}
      />
      <span
        className={
          item.hidden
            ? "min-w-0 flex-1 truncate text-muted-foreground text-sm"
            : "min-w-0 flex-1 truncate text-sm"
        }
      >
        {item.label}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t("navigation:customize.moveUp", { name: item.label })}
        disabled={index === 0}
        onClick={() => onMove(index, index - 1)}
      >
        <ArrowUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t("navigation:customize.moveDown", { name: item.label })}
        disabled={index === total - 1}
        onClick={() => onMove(index, index + 1)}
      >
        <ArrowDown />
      </Button>
      {item.hideable ? (
        <Switch
          checked={!item.hidden}
          onCheckedChange={onToggle}
          aria-label={t("navigation:customize.show", { name: item.label })}
        />
      ) : (
        <Switch
          checked
          disabled
          aria-label={t("navigation:customize.alwaysShown", {
            name: item.label,
          })}
        />
      )}
    </li>
  );
}

function SortableList({
  label,
  items,
  onReorder,
  onToggle,
  announce,
}: {
  label: string;
  items: ListItem[];
  onReorder: (ids: string[]) => void;
  onToggle: (id: string, shown: boolean) => void;
  announce: (message: string) => void;
}) {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 6 },
    }),
  );
  const ids = items.map((item) => item.id);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = moveItem(ids, from, to);
    onReorder(next);
    announce(
      t("navigation:customize.moved", {
        name: items[from]?.label ?? "",
        position: to + 1,
        total: items.length,
      }),
    );
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    move(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  };

  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </h3>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul aria-label={label} className="flex flex-col gap-0.5">
            {items.map((item, index) => (
              <SortableRow
                key={item.id}
                item={item}
                index={index}
                total={items.length}
                onMove={move}
                onToggle={(shown) => onToggle(item.id, shown)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </section>
  );
}

/**
 * "Customize sidebar": the user's own order of the rail destinations and the
 * Projects panel sections, and which of them show. Changes apply at once and
 * sync to the user's other devices; only this user sees them.
 */
export function CustomizeSidebarDialog() {
  const { t } = useTranslation();
  const { open, setOpen } = useCustomizeSidebarDialog();
  const sidebarLayout = useUserPreferencesStore((state) => state.sidebarLayout);
  const setSidebarLayout = useUserPreferencesStore(
    (state) => state.setSidebarLayout,
  );
  const [announcement, setAnnouncement] = useState("");
  const layout = resolveSidebarLayout(sidebarLayout);

  const save = (patch: Partial<SidebarLayout>) => {
    const next = { ...layout, ...patch };
    setSidebarLayout(isDefaultSidebarLayout(next) ? null : next);
  };

  const railItems: ListItem[] = layout.railOrder.map((id) => {
    const meta = DESTINATION_META[id];
    return {
      id,
      label: t(meta.labelKey),
      icon: meta.icon,
      color: meta.color,
      hidden: layout.railHidden.includes(id),
      hideable: !ALWAYS_SHOWN_RAIL_ITEMS.includes(id),
    };
  });
  const panelItems: ListItem[] = layout.panelOrder.map((id) => ({
    id,
    label: t(PANEL_META[id].labelKey),
    icon: PANEL_META[id].icon,
    hidden: layout.panelHidden.includes(id),
    hideable: true,
  }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("navigation:customize.title")}</DialogTitle>
          <DialogDescription>
            {t("navigation:customize.description")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-5">
          <SortableList
            label={t("navigation:customize.rail")}
            items={railItems}
            announce={setAnnouncement}
            onReorder={(ids) => save({ railOrder: ids as RailItem[] })}
            onToggle={(id, shown) =>
              save({
                railHidden: shown
                  ? layout.railHidden.filter((item) => item !== id)
                  : [...layout.railHidden, id as RailItem],
              })
            }
          />
          <SortableList
            label={t("navigation:customize.projectsPanel")}
            items={panelItems}
            announce={setAnnouncement}
            onReorder={(ids) => save({ panelOrder: ids as PanelSection[] })}
            onToggle={(id, shown) =>
              save({
                panelHidden: shown
                  ? layout.panelHidden.filter((item) => item !== id)
                  : [...layout.panelHidden, id as PanelSection],
              })
            }
          />
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={sidebarLayout === null}
            onClick={() => {
              setSidebarLayout(null);
              setAnnouncement(t("navigation:customize.resetDone"));
            }}
          >
            <RotateCcw />
            {t("navigation:customize.reset")}
          </Button>
          <Button type="button" onClick={() => setOpen(false)}>
            {t("navigation:customize.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CustomizeSidebarDialog;

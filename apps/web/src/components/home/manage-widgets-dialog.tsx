import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import useUpdateHomePreferences from "@/hooks/mutations/home/use-update-home-preferences";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import {
  HOME_WIDGET_LABEL_KEYS,
  type HomeWidget,
  moveWidget,
  setWidgetEnabled,
} from "./home-widgets";

function WidgetRow({
  widget,
  disabled,
  onToggle,
}: {
  widget: HomeWidget;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const name = t(HOME_WIDGET_LABEL_KEYS[widget.key]);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.key, disabled });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex h-10 items-center gap-2 rounded-md px-2 hover:bg-accent",
        isDragging && "relative z-10 bg-accent shadow-md",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="flex size-6 cursor-grab items-center justify-center rounded-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
        disabled={disabled}
        {...attributes}
        {...listeners}
        aria-label={t("home:manage.reorder", { widget: name })}
      >
        <GripVertical className="size-4" />
      </button>
      <span className="flex-1 text-sm">{name}</span>
      <Switch
        checked={widget.enabled}
        disabled={disabled}
        onCheckedChange={(checked) => onToggle(checked)}
        aria-label={t("home:manage.toggle", { widget: name })}
      />
    </li>
  );
}

type ManageWidgetsDialogProps = {
  workspaceId: string;
  widgets: HomeWidget[];
  /** While preferences load, rows show the defaults and cannot change. */
  isLoading: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Show, hide and reorder Home widgets; every change saves at once. */
export default function ManageWidgetsDialog({
  workspaceId,
  widgets,
  isLoading,
  open,
  onOpenChange,
}: ManageWidgetsDialogProps) {
  const { t } = useTranslation();
  const updatePreferences = useUpdateHomePreferences();
  const { canReadAnalytics, isCheckingPermissions } = useWorkspacePermission();
  // The risks widget needs analytics:read; without it the row is left out,
  // but the saved list still names it.
  const listed = widgets.filter(
    (widget) =>
      widget.key !== "risks" || (!isCheckingPermissions && canReadAnalytics()),
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const save = (next: HomeWidget[]) => {
    updatePreferences.mutate(
      { workspaceId, widgets: next },
      { onError: () => toast.error(t("home:manage.saveError")) },
    );
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    document.body.classList.remove("margaya-dragging");
    if (!over || active.id === over.id) return;
    save(moveWidget(widgets, String(active.id), String(over.id)));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("home:manage.title")}</DialogTitle>
          <DialogDescription>{t("home:manage.description")}</DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragStart={() => document.body.classList.add("margaya-dragging")}
            onDragEnd={handleDragEnd}
            onDragCancel={() =>
              document.body.classList.remove("margaya-dragging")
            }
          >
            <SortableContext
              items={listed.map((widget) => widget.key)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-0.5">
                {listed.map((widget) => (
                  <WidgetRow
                    key={widget.key}
                    widget={widget}
                    disabled={isLoading}
                    onToggle={(enabled) =>
                      save(setWidgetEnabled(widgets, widget.key, enabled))
                    }
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common:actions.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

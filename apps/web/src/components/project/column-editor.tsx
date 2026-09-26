import {
  ArrowDownWideNarrow,
  GripVertical,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import columnIcons, {
  DEFAULT_COLUMN_ICON_NAMES,
} from "@/constants/column-icons";
import { useCreateColumn } from "@/hooks/mutations/column/use-create-column";
import { useDeleteColumn } from "@/hooks/mutations/column/use-delete-column";
import { useReorderColumns } from "@/hooks/mutations/column/use-reorder-columns";
import { useUpdateColumn } from "@/hooks/mutations/column/use-update-column";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getColumnIcon } from "@/lib/column";
import {
  type CreatableColumnGroup,
  columnGroupOf,
  DEFAULT_COLUMN_GROUP,
  getCompletedColumn,
  sortColumnsByGroup,
  withoutTriage,
} from "@/lib/column-groups";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import ColumnGroupSelect from "./column-group-select";

type ColumnEditorProps = {
  projectId: string;
};

function editableGroupOf(column: {
  slug: string;
  group?: string | null;
  isFinal?: boolean | null;
}): CreatableColumnGroup {
  const group = columnGroupOf(column);
  return group === "triage" ? DEFAULT_COLUMN_GROUP : group;
}

/** Reorders the board by group rank with one call to the reorder route. */
export function SortColumnsByGroupButton({ projectId }: ColumnEditorProps) {
  const { t } = useTranslation();
  const { data: allColumns } = useGetColumns(projectId);
  const { mutateAsync: reorderColumns, isPending } = useReorderColumns();
  const { canManageProjects } = useWorkspacePermission();
  const columns = allColumns ? withoutTriage(allColumns) : [];

  if (!canManageProjects() || columns.length < 2) return null;

  const handleSort = async () => {
    try {
      await reorderColumns({
        projectId,
        columns: sortColumnsByGroup(columns).map((column, position) => ({
          id: column.id,
          position,
        })),
      });
      toast.success(t("settings:columnEditor.toastSorted"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:columnEditor.toastUpdateError"),
      );
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="text-muted-foreground"
      onClick={handleSort}
      disabled={isPending}
    >
      <ArrowDownWideNarrow className="size-3.5" />
      {t("settings:columnEditor.sortByGroup")}
    </Button>
  );
}

export default function ColumnEditor({ projectId }: ColumnEditorProps) {
  const { t } = useTranslation();
  const { data: allColumns, isLoading } = useGetColumns(projectId);
  // Triage columns belong to intake and never appear in this editor.
  const columns = allColumns ? withoutTriage(allColumns) : undefined;
  const { mutateAsync: createColumn } = useCreateColumn();
  const { mutateAsync: updateColumn } = useUpdateColumn();
  const { mutateAsync: deleteColumn } = useDeleteColumn();
  const { mutateAsync: reorderColumns } = useReorderColumns();
  const { canManageProjects } = useWorkspacePermission();
  const canEdit = canManageProjects();
  const [newColumnName, setNewColumnName] = useState("");
  const [newColumnIcon, setNewColumnIcon] = useState("Circle");
  const [newColumnGroup, setNewColumnGroup] =
    useState<CreatableColumnGroup>(DEFAULT_COLUMN_GROUP);
  const [iconPickerColumnId, setIconPickerColumnId] = useState<string | null>(
    null,
  );
  const [newIconPickerOpen, setNewIconPickerOpen] = useState(false);
  const [iconSearch, setIconSearch] = useState("");
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      dragPreviewRef.current?.remove();
    };
  }, []);

  const handleCreate = async () => {
    if (!newColumnName.trim()) return;
    try {
      await createColumn({
        projectId,
        data: {
          name: newColumnName.trim(),
          icon: newColumnIcon,
          group: newColumnGroup,
        },
      });
      setNewColumnName("");
      setNewColumnIcon("Circle");
      setNewColumnGroup(DEFAULT_COLUMN_GROUP);
      toast.success(t("settings:columnEditor.toastCreated"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:columnEditor.toastCreateError"),
      );
    }
  };

  const handleRename = async (id: string, name: string) => {
    try {
      await updateColumn({ id, projectId, data: { name } });
      toast.success(t("settings:columnEditor.toastRenamed"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:columnEditor.toastRenameError"),
      );
    }
  };

  const handleChangeGroup = async (id: string, group: CreatableColumnGroup) => {
    try {
      await updateColumn({ id, projectId, data: { group } });
      toast.success(t("settings:columnEditor.toastGroupUpdated"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:columnEditor.toastUpdateError"),
      );
    }
  };

  const handleUpdateIcon = async (id: string, icon: string) => {
    try {
      await updateColumn({ id, projectId, data: { icon } });
      setIconPickerColumnId(null);
      setIconSearch("");
      toast.success(t("settings:columnEditor.toastIconUpdated"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:columnEditor.toastUpdateError"),
      );
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteColumn({ id, projectId });
      toast.success(t("settings:columnEditor.toastDeleted"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:columnEditor.toastDeleteError"),
      );
    }
  };

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    index: number,
  ) => {
    setDraggedIndex(index);

    dragPreviewRef.current?.remove();

    const sourceElement = e.currentTarget;
    const sourceRect = sourceElement.getBoundingClientRect();

    // Use an isolated clone so the drag image only captures the selected row.
    const dragPreview = sourceElement.cloneNode(true) as HTMLDivElement;

    dragPreview.setAttribute("aria-hidden", "true");
    dragPreview.inert = true;

    Object.assign(dragPreview.style, {
      position: "fixed",
      top: "-10000px",
      left: "-10000px",
      width: `${sourceRect.width}px`,
      height: `${sourceRect.height}px`,
      margin: "0",
      boxSizing: "border-box",
      overflow: "hidden",
      pointerEvents: "none",
      transform: "none",
      contain: "layout paint",
    });

    document.body.appendChild(dragPreview);
    dragPreviewRef.current = dragPreview;

    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    e.dataTransfer.setDragImage(
      dragPreview,
      e.clientX - sourceRect.left,
      e.clientY - sourceRect.top,
    );
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index || !columns) return;

    const reordered = [...columns];
    const [removed] = reordered.splice(draggedIndex, 1);
    reordered.splice(index, 0, removed);

    const updates = reordered.map((col, i) => ({ id: col.id, position: i }));
    reorderColumns({ projectId, columns: updates });
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);

    dragPreviewRef.current?.remove();
    dragPreviewRef.current = null;
  };

  const filteredIcons = Object.entries(columnIcons).filter(([iconName]) =>
    iconName.toLowerCase().includes(iconSearch.trim().toLowerCase()),
  );

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("settings:columnEditor.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        {columns?.map((col, index) => (
          // biome-ignore lint/a11y/useSemanticElements: false positive for role="listitem"
          <div
            key={col.id}
            role="listitem"
            draggable={canEdit}
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            className="flex items-center gap-2 p-2 border border-border rounded-md bg-card hover:bg-accent/50 transition-colors"
          >
            <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab shrink-0" />
            <Popover
              open={iconPickerColumnId === col.id}
              onOpenChange={(open) => {
                setIconPickerColumnId(open ? col.id : null);
                if (!open) setIconSearch("");
              }}
              modal={true}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 shrink-0"
                  title={t("settings:columnEditor.pickIconTitle")}
                  disabled={!canEdit}
                >
                  {getColumnIcon(col.slug, col.isFinal, col.icon, col.group)}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="start">
                <div className="space-y-2">
                  <Input
                    value={iconSearch}
                    onChange={(e) => setIconSearch(e.target.value)}
                    placeholder={t(
                      "settings:columnEditor.searchIconsPlaceholder",
                    )}
                    className="h-8 text-xs"
                  />
                  <div className="max-h-[280px] overflow-y-auto pr-1">
                    <div className="grid grid-cols-6 gap-1.5">
                      {filteredIcons.map(([iconName, Icon]) => {
                        const selectedIconName =
                          col.icon ||
                          DEFAULT_COLUMN_ICON_NAMES[
                            col.slug as keyof typeof DEFAULT_COLUMN_ICON_NAMES
                          ];
                        const isSelected = selectedIconName === iconName;
                        return (
                          <Button
                            key={iconName}
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleUpdateIcon(col.id, iconName)}
                            className={cn(
                              "h-10 items-center justify-center rounded-md p-0",
                              isSelected &&
                                "bg-sidebar-accent text-sidebar-accent-foreground",
                            )}
                            title={iconName}
                          >
                            <Icon className="h-4 w-4" />
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <Input
              defaultValue={col.name}
              aria-label={t("settings:columnEditor.nameAria", {
                name: col.name,
              })}
              className="h-8 text-sm flex-1"
              disabled={!canEdit}
              onBlur={(e) => {
                if (e.target.value !== col.name) {
                  handleRename(col.id, e.target.value);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
            <div className="flex items-center gap-1.5 shrink-0">
              <ColumnGroupSelect
                value={editableGroupOf(col)}
                onChange={(group) => handleChangeGroup(col.id, group)}
                disabled={!canEdit}
                aria-label={t("settings:columnEditor.groupPickerAria", {
                  name: col.name,
                })}
              />
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(col.id)}
                  aria-label={t("settings:columnEditor.deleteAria", {
                    name: col.name,
                  })}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {columns && columns.length > 0 && !getCompletedColumn(columns) && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert className="size-3.5 shrink-0" />
          {t("settings:columnEditor.noCompletedWarning")}
        </p>
      )}

      {canEdit && (
        <div className="flex items-center gap-2">
          <Popover
            open={newIconPickerOpen}
            onOpenChange={(open) => {
              setNewIconPickerOpen(open);
              if (!open) setIconSearch("");
            }}
            modal={true}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0 shrink-0"
                title={t("settings:columnEditor.pickIconTitle")}
              >
                {getColumnIcon("", false, newColumnIcon, newColumnGroup)}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="start">
              <div className="space-y-2">
                <Input
                  value={iconSearch}
                  onChange={(e) => setIconSearch(e.target.value)}
                  placeholder={t(
                    "settings:columnEditor.searchIconsPlaceholder",
                  )}
                  className="h-8 text-xs"
                />
                <div className="max-h-[280px] overflow-y-auto pr-1">
                  <div className="grid grid-cols-6 gap-1.5">
                    {filteredIcons.map(([iconName, Icon]) => {
                      const isSelected = newColumnIcon === iconName;
                      return (
                        <Button
                          key={iconName}
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setNewColumnIcon(iconName);
                            setNewIconPickerOpen(false);
                            setIconSearch("");
                          }}
                          className={cn(
                            "h-10 items-center justify-center rounded-md p-0",
                            isSelected &&
                              "bg-sidebar-accent text-sidebar-accent-foreground",
                          )}
                          title={iconName}
                        >
                          <Icon className="h-4 w-4" />
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Input
            placeholder={t("settings:columnEditor.newColumnPlaceholder")}
            value={newColumnName}
            onChange={(e) => setNewColumnName(e.target.value)}
            className="h-8 text-sm flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
          <ColumnGroupSelect
            value={newColumnGroup}
            onChange={setNewColumnGroup}
            aria-label={t("settings:columnEditor.groupLabel")}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleCreate}
            disabled={!newColumnName.trim()}
            className="h-8 gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("settings:columnEditor.add")}
          </Button>
        </div>
      )}
    </div>
  );
}

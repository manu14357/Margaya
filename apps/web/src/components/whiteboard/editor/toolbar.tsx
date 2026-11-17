import type { PenStyle } from "@margaya/whiteboard";
import {
  Brush,
  ChevronDown,
  Circle,
  Diamond,
  Eraser,
  Frame,
  Hand,
  Highlighter,
  ImageIcon,
  ListTodo,
  type LucideIcon,
  Minus,
  MoreHorizontal,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Pin,
  Shapes,
  Square,
  StickyNote,
  Type,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Kbd } from "@/components/ui/kbd";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
} from "@/components/ui/toolbar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ShapeIcon } from "./shape-icon";
import { ShapePicker } from "./shape-picker";
import { SHAPE_LABEL_KEYS } from "./shapes";
import {
  isShapeTool,
  isToolAllowed,
  type ShapeChoice,
  TOOL_SHORTCUTS,
  type ToolId,
} from "./tools";
import { useController, useEditorState } from "./use-editor";

export const TOOL_ICONS: Record<ToolId, LucideIcon> = {
  select: MousePointer2,
  hand: Hand,
  rectangle: Square,
  diamond: Diamond,
  ellipse: Circle,
  shape: Shapes,
  arrow: MoveUpRight,
  line: Minus,
  draw: Pencil,
  text: Type,
  sticky: StickyNote,
  image: ImageIcon,
  eraser: Eraser,
  frame: Frame,
  laser: Zap,
  task: ListTodo,
};

/** Static label keys, one per tool (i18n keys must not be built at runtime). */
export const TOOL_LABEL_KEYS: Record<ToolId, string> = {
  select: "whiteboardEditor:tools.select",
  hand: "whiteboardEditor:tools.hand",
  rectangle: "whiteboardEditor:tools.rectangle",
  diamond: "whiteboardEditor:tools.diamond",
  ellipse: "whiteboardEditor:tools.ellipse",
  shape: "whiteboardEditor:tools.shape",
  arrow: "whiteboardEditor:tools.arrow",
  line: "whiteboardEditor:tools.line",
  draw: "whiteboardEditor:tools.draw",
  text: "whiteboardEditor:tools.text",
  sticky: "whiteboardEditor:tools.sticky",
  image: "whiteboardEditor:tools.image",
  eraser: "whiteboardEditor:tools.eraser",
  frame: "whiteboardEditor:tools.frame",
  laser: "whiteboardEditor:tools.laser",
  task: "whiteboardEditor:tools.task",
};

const DESKTOP_TOOLS: ToolId[][] = [
  ["select", "hand"],
  // One button for every shape: R, D and O still pick the classic ones.
  ["shape", "arrow", "line", "draw", "text"],
  ["sticky", "task", "image", "frame"],
  ["eraser", "laser"],
];

/** On a phone the bar keeps the everyday tools and folds the rest away. */
const MOBILE_PRIMARY: ToolId[] = [
  "select",
  "hand",
  "draw",
  "sticky",
  "text",
  "shape",
  "arrow",
];

/** The pen button shows the style new strokes get. */
const PEN_ICONS: Record<PenStyle, LucideIcon> = {
  pen: Pencil,
  marker: Brush,
  highlighter: Highlighter,
};

export const BUTTON_CLASS =
  "relative inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent aria-pressed:text-accent-foreground disabled:pointer-events-none disabled:opacity-40 sm:size-8 pointer-coarse:size-11 motion-reduce:transition-none";

type ToolbarProps = {
  readOnly: boolean;
  compact: boolean;
  imagesEnabled: boolean;
  tasksEnabled: boolean;
  onPick: (tool: ToolId) => void;
  onPickShape: (shape: ShapeChoice) => void;
  onToggleLock: () => void;
};

export function EditorToolbar({
  readOnly,
  compact,
  imagesEnabled,
  tasksEnabled,
  onPick,
  onPickShape,
  onToggleLock,
}: ToolbarProps) {
  const { t } = useTranslation();
  const tool = useEditorState((state) => state.tool);
  const locked = useEditorState((state) => state.locked);
  const penStyle = useEditorState((state) => state.penStyle);

  const available = (id: ToolId) => {
    if (!isToolAllowed(id, readOnly)) return false;
    if (id === "image") return imagesEnabled;
    if (id === "task") return tasksEnabled;
    return true;
  };

  const renderTool = (id: ToolId) => {
    if (id === "shape")
      return (
        <ShapeToolButton key={id} compact={compact} onPickShape={onPickShape} />
      );
    const Icon = id === "draw" ? PEN_ICONS[penStyle] : TOOL_ICONS[id];
    const label = t(TOOL_LABEL_KEYS[id]);
    const keys = TOOL_SHORTCUTS[id];
    return (
      <Tooltip key={id}>
        <TooltipTrigger
          render={
            <ToolbarButton
              aria-label={label}
              aria-pressed={tool === id}
              aria-keyshortcuts={keys.map((key) => key.toUpperCase()).join(" ")}
              className={BUTTON_CLASS}
              onClick={() => onPick(id)}
              data-testid={`whiteboard-tool-${id}`}
            />
          }
        >
          <Icon className="size-4" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent
          side={compact ? "top" : "bottom"}
          className="flex items-center gap-2"
        >
          {label}
          {keys[0] && <Kbd>{keys[0].toUpperCase()}</Kbd>}
        </TooltipContent>
      </Tooltip>
    );
  };

  const lockLabel = locked
    ? t("whiteboardEditor:tools.unlockTool")
    : t("whiteboardEditor:tools.lockTool");
  const lockButton = !readOnly && (
    <Tooltip>
      <TooltipTrigger
        render={
          <ToolbarButton
            aria-label={lockLabel}
            aria-pressed={locked}
            aria-keyshortcuts="Q"
            className={BUTTON_CLASS}
            onClick={onToggleLock}
          />
        }
      >
        {/* A pin, not a padlock: the board's own lock sits in the header.
            The pressed state shows whether the tool stays active. */}
        <Pin className="size-4" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent
        side={compact ? "top" : "bottom"}
        className="flex items-center gap-2"
      >
        {lockLabel}
        <Kbd>Q</Kbd>
      </TooltipContent>
    </Tooltip>
  );

  if (compact) {
    const primary = MOBILE_PRIMARY.filter(available);
    const rest = DESKTOP_TOOLS.flat().filter(
      (id) => available(id) && !primary.includes(id),
    );
    const activeInRest = rest.includes(tool);
    return (
      <Toolbar
        aria-label={t("whiteboardEditor:tools.label")}
        className="max-w-[calc(100vw-1rem)] gap-0.5 overflow-x-auto shadow-lg/5"
      >
        {primary.map(renderTool)}
        {rest.length > 0 && (
          <Menu>
            <MenuTrigger
              render={
                <ToolbarButton
                  aria-label={t("whiteboardEditor:tools.more")}
                  aria-pressed={activeInRest}
                  className={BUTTON_CLASS}
                />
              }
            >
              {activeInRest ? (
                (() => {
                  const Icon = TOOL_ICONS[tool];
                  return <Icon className="size-4" aria-hidden="true" />;
                })()
              ) : (
                <MoreHorizontal className="size-4" aria-hidden="true" />
              )}
            </MenuTrigger>
            <MenuPopup side="top" align="end">
              {rest.map((id) => {
                const Icon = TOOL_ICONS[id];
                return (
                  <MenuItem key={id} onClick={() => onPick(id)}>
                    <Icon aria-hidden="true" />
                    {t(TOOL_LABEL_KEYS[id])}
                  </MenuItem>
                );
              })}
              {!readOnly && (
                <MenuItem onClick={onToggleLock}>
                  <Pin aria-hidden="true" />
                  {lockLabel}
                </MenuItem>
              )}
            </MenuPopup>
          </Menu>
        )}
      </Toolbar>
    );
  }

  const groups = DESKTOP_TOOLS.map((group) => group.filter(available)).filter(
    (group) => group.length > 0,
  );
  return (
    <Toolbar
      aria-label={t("whiteboardEditor:tools.label")}
      className="gap-0.5 shadow-lg/5"
    >
      {groups.map((group, index) => (
        <span key={group[0]} className="contents">
          {index > 0 && (
            <ToolbarSeparator orientation="vertical" className="mx-0.5" />
          )}
          {group.map(renderTool)}
        </span>
      ))}
      {lockButton && (
        <>
          <ToolbarSeparator orientation="vertical" className="mx-0.5" />
          {lockButton}
        </>
      )}
    </Toolbar>
  );
}

/**
 * The shape tool: the button draws the last shape picked, and the chevron
 * (or, on a narrow bar, the button itself) opens the shape library.
 */
function ShapeToolButton({
  compact,
  onPickShape,
}: {
  compact: boolean;
  onPickShape: (shape: ShapeChoice) => void;
}) {
  const { t } = useTranslation();
  const c = useController();
  const tool = useEditorState((state) => state.tool);
  const shapeKind = useEditorState((state) => state.shapeKind);
  const open = useEditorState((state) => state.dialog === "shapes");
  const active = isShapeTool(tool);
  const shapeLabel = t(SHAPE_LABEL_KEYS[shapeKind]);
  const libraryLabel = t("whiteboardEditor:shapes.library");
  const setOpen = (next: boolean) =>
    c.update((state) =>
      next
        ? { ...state, dialog: "shapes", contextMenu: null }
        : state.dialog === "shapes"
          ? { ...state, dialog: null }
          : state,
    );
  const side = compact ? "top" : "bottom";
  const picker = (
    <PopoverPopup side={side} align="center" sideOffset={8}>
      <ShapePicker value={shapeKind} onPick={onPickShape} />
    </PopoverPopup>
  );

  if (compact) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <ToolbarButton
              aria-label={libraryLabel}
              aria-pressed={active}
              aria-keyshortcuts="Shift+S"
              className={BUTTON_CLASS}
              data-testid="whiteboard-tool-shape"
            />
          }
        >
          <ShapeIcon shape={shapeKind} />
        </PopoverTrigger>
        {picker}
      </Popover>
    );
  }

  return (
    <span className="inline-flex items-center">
      <Tooltip>
        <TooltipTrigger
          render={
            <ToolbarButton
              aria-label={shapeLabel}
              aria-pressed={active}
              className={BUTTON_CLASS}
              onClick={() => onPickShape(shapeKind)}
              data-testid="whiteboard-tool-shape"
            />
          }
        >
          <ShapeIcon shape={shapeKind} />
        </TooltipTrigger>
        <TooltipContent side={side}>{shapeLabel}</TooltipContent>
      </Tooltip>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <ToolbarButton
                    aria-label={libraryLabel}
                    aria-keyshortcuts="Shift+S"
                    className="relative inline-flex h-9 w-4 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent sm:h-8 pointer-coarse:h-11 pointer-coarse:w-11 motion-reduce:transition-none"
                    data-testid="whiteboard-shape-picker-trigger"
                  />
                }
              />
            }
          >
            <ChevronDown className="size-3" aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent side={side} className="flex items-center gap-2">
            {libraryLabel}
            <Kbd>{t("whiteboardEditor:help.keys.shift")} S</Kbd>
          </TooltipContent>
        </Tooltip>
        {picker}
      </Popover>
    </span>
  );
}

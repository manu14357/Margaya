// These components read the board controller (history, collaborators,
// read-only state, the scene) while rendering. It is a mutable object whose
// identity never changes, so compiler memoisation would freeze those reads.
"use no memo";

import {
  type AlignEdge,
  type ArrowHead,
  type BoardElement,
  type FillStyle,
  type FontFamily,
  type LinearElement,
  type LineRouting,
  type LocalPoint,
  type PenStyle,
  routeElbow,
  type StrokeStyle,
  type TextAlign,
  updateBoundLines,
  updateElement,
} from "@margaya/whiteboard";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDownToLine,
  ArrowUpToLine,
  Brush,
  ChevronDown,
  ChevronUp,
  Copy,
  Crop,
  GitBranch,
  Group,
  Highlighter,
  Link2,
  ListTodo,
  Lock,
  LockOpen,
  Pencil,
  RotateCcw,
  Shapes,
  Trash2,
  Ungroup,
  Unlink,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { BackgroundSettings } from "./background-control";
import {
  align,
  changeShape,
  croppableImage,
  distribute,
  duplicateSelection,
  refitText,
  reorder,
  resetCrop,
  runCommand,
  setLocked,
} from "./commands";
import type { BoardController } from "./controller";
import { isLinear } from "./interaction";
import {
  describeSelection,
  type SelectionInfo,
  sharedStyle,
  sharedValue,
  stylePatchFor,
} from "./selection-info";
import { ShapeIcon } from "./shape-icon";
import { ShapePicker } from "./shape-picker";
import { type ItemStyle, patchStyle } from "./store";
import { isClassicShape, type ShapeChoice, type ToolId } from "./tools";
import { useController, useEditorState } from "./use-editor";

// Element colours are board content, not app chrome, so they are concrete
// colours rather than theme tokens (the renderer adapts them to dark mode).
export const STROKE_COLORS = [
  "#1e1e1e",
  "#dc2626",
  "#16a34a",
  "#2563eb",
  "#d97706",
  "#9333ea",
  "#0891b2",
  "#6b7280",
];
export const FILL_COLORS = [
  "transparent",
  "#fecaca",
  "#bbf7d0",
  "#bfdbfe",
  "#fde68a",
  "#e9d5ff",
  "#a5f3fc",
  "#e5e7eb",
];
/** Bright, see-through inks for the highlighter. */
export const HIGHLIGHTER_COLORS = [
  "#facc15",
  "#4ade80",
  "#60a5fa",
  "#f472b6",
  "#fb923c",
  "#c084fc",
];
export const STICKY_COLORS = [
  "#fff3bf",
  "#fed7aa",
  "#fecdd3",
  "#d9f99d",
  "#bae6fd",
  "#ddd6fe",
  "#f3f4f6",
];

const COLOR_NAME_KEYS: Record<string, string> = {
  "#1e1e1e": "whiteboardEditor:colors.black",
  "#dc2626": "whiteboardEditor:colors.red",
  "#16a34a": "whiteboardEditor:colors.green",
  "#2563eb": "whiteboardEditor:colors.blue",
  "#d97706": "whiteboardEditor:colors.orange",
  "#9333ea": "whiteboardEditor:colors.purple",
  "#0891b2": "whiteboardEditor:colors.teal",
  "#6b7280": "whiteboardEditor:colors.grey",
  transparent: "whiteboardEditor:colors.none",
  "#fecaca": "whiteboardEditor:colors.red",
  "#bbf7d0": "whiteboardEditor:colors.green",
  "#bfdbfe": "whiteboardEditor:colors.blue",
  "#fde68a": "whiteboardEditor:colors.yellow",
  "#e9d5ff": "whiteboardEditor:colors.purple",
  "#a5f3fc": "whiteboardEditor:colors.teal",
  "#e5e7eb": "whiteboardEditor:colors.grey",
  "#fff3bf": "whiteboardEditor:colors.yellow",
  "#fed7aa": "whiteboardEditor:colors.orange",
  "#fecdd3": "whiteboardEditor:colors.pink",
  "#d9f99d": "whiteboardEditor:colors.green",
  "#bae6fd": "whiteboardEditor:colors.blue",
  "#ddd6fe": "whiteboardEditor:colors.purple",
  "#f3f4f6": "whiteboardEditor:colors.grey",
  "#facc15": "whiteboardEditor:colors.yellow",
  "#4ade80": "whiteboardEditor:colors.green",
  "#60a5fa": "whiteboardEditor:colors.blue",
  "#f472b6": "whiteboardEditor:colors.pink",
  "#fb923c": "whiteboardEditor:colors.orange",
  "#c084fc": "whiteboardEditor:colors.purple",
};

const PEN_STYLE_OPTIONS: {
  value: PenStyle;
  labelKey: string;
  icon: typeof Pencil;
}[] = [
  { value: "pen", labelKey: "whiteboardEditor:pens.pen", icon: Pencil },
  { value: "marker", labelKey: "whiteboardEditor:pens.marker", icon: Brush },
  {
    value: "highlighter",
    labelKey: "whiteboardEditor:pens.highlighter",
    icon: Highlighter,
  },
];

/** Element types a creation tool makes, for the panel before anything exists. */
const TOOL_TYPES: Partial<Record<ToolId, BoardElement["type"]>> = {
  rectangle: "rectangle",
  diamond: "diamond",
  ellipse: "ellipse",
  shape: "shape",
  arrow: "arrow",
  line: "line",
  draw: "draw",
  text: "text",
  sticky: "sticky",
};

export type PanelActions = {
  onTurnIntoTasks: () => void;
  onMakeDependency: (link: {
    sourceTaskId: string;
    targetTaskId: string;
  }) => void;
  /** The selected task-card arrow already stands for a "blocks" relation. */
  dependencyExists: boolean;
  onRemoveDependency: () => void;
  onEditLink: () => void;
  tasksEnabled: boolean;
};

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 font-medium text-[11px] text-muted-foreground">
        {label}
      </legend>
      {children}
    </fieldset>
  );
}

type Option<T extends string> = { value: T; label: string; icon?: ReactNode };

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <ToggleGroup
      size="sm"
      variant="outline"
      aria-label={label}
      value={value === null ? [] : [value]}
      onValueChange={(values) => {
        const next = options.find((option) => option.value === values[0]);
        if (next) onChange(next.value);
      }}
      className="w-full flex-wrap"
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          aria-label={option.label}
          title={option.label}
          // Sized by the label, so a row of long labels wraps instead of
          // running the words together.
          className="flex-auto px-1.5"
        >
          {option.icon ?? option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

function Swatches({
  label,
  colors,
  value,
  onChange,
}: {
  label: string;
  colors: readonly string[];
  value: string | null;
  onChange: (color: string) => void;
}) {
  const { t } = useTranslation();
  const custom =
    value && !colors.includes(value) && /^#[0-9a-f]{6}$/i.test(value);
  return (
    <fieldset aria-label={label} className="flex flex-wrap items-center gap-1">
      {colors.map((color) => {
        const selected = value === color;
        return (
          <button
            key={color}
            type="button"
            aria-pressed={selected}
            aria-label={t(
              COLOR_NAME_KEYS[color] ?? "whiteboardEditor:colors.custom",
            )}
            title={t(
              COLOR_NAME_KEYS[color] ?? "whiteboardEditor:colors.custom",
            )}
            onClick={() => onChange(color)}
            className={cn(
              "relative size-6 shrink-0 rounded-md border border-border outline-none transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11 motion-reduce:transition-none",
              selected &&
                "ring-2 ring-ring ring-offset-1 ring-offset-background",
            )}
            style={
              color === "transparent"
                ? {
                    backgroundImage:
                      "linear-gradient(135deg, transparent 45%, var(--destructive) 45%, var(--destructive) 55%, transparent 55%)",
                  }
                : { backgroundColor: color }
            }
          />
        );
      })}
      <label
        className={cn(
          "relative size-6 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border focus-within:ring-2 focus-within:ring-ring pointer-coarse:size-11",
          custom && "ring-2 ring-ring ring-offset-1 ring-offset-background",
        )}
        title={t("whiteboardEditor:colors.custom")}
        style={{
          background: custom
            ? value
            : "conic-gradient(from 0deg, var(--chart-1), var(--chart-2), var(--chart-3), var(--chart-4), var(--chart-5), var(--chart-1))",
        }}
      >
        <span className="sr-only">{t("whiteboardEditor:colors.custom")}</span>
        <input
          type="color"
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          value={custom ? value : "#000000"}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </fieldset>
  );
}

function IconAction({
  label,
  onClick,
  children,
  disabled,
  pressed,
  destructive,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  pressed?: boolean;
  destructive?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
            className={cn(destructive && "text-destructive-foreground")}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Applies a style change to the selection and remembers it for new elements. */
function applyStyle(
  c: BoardController,
  patch: Partial<ItemStyle>,
  elements: readonly BoardElement[],
) {
  c.update((state) => patchStyle(state, patch));
  const { stickyColor, ...rest } = patch as Partial<ItemStyle> & {
    stickyColor?: string;
  };
  const next: BoardElement[] = [];
  for (const element of elements) {
    if (element.locked) continue;
    // Stickies keep their colour in the fill.
    const own =
      element.type === "sticky" && stickyColor !== undefined
        ? { ...stylePatchFor(element, rest), fillColor: stickyColor }
        : stylePatchFor(element, rest);
    if (Object.keys(own).length === 0) continue;
    next.push(
      refitText(updateElement(element, own as never, { userId: c.userId })),
    );
  }
  if (next.length > 0) c.commit(next);
}

export function PropertiesPanel({
  actions,
  className,
  showBoard = false,
}: {
  actions: PanelActions;
  className?: string;
  /** With nothing selected, show the board's background settings. */
  showBoard?: boolean;
}) {
  const { t } = useTranslation();
  const c = useController();
  const selectedIds = useEditorState((state) => state.selectedIds);
  useEditorState((state) => state.sceneVersion);
  const tool = useEditorState((state) => state.tool);
  const style = useEditorState((state) => state.style);
  const penStyle = useEditorState((state) => state.penStyle);
  const shapeKind = useEditorState((state) => state.shapeKind);
  const croppingId = useEditorState((state) => state.croppingId);
  const readOnly = c.readOnly;

  const selected = selectedIds
    .map((id) => c.get(id))
    .filter((e): e is BoardElement => Boolean(e));
  const toolType = TOOL_TYPES[tool];
  if (readOnly) return null;
  if (selected.length === 0 && !toolType) {
    if (!showBoard) return null;
    return (
      <section
        className={cn(
          "flex w-60 flex-col gap-1 rounded-xl border bg-card p-1 text-card-foreground shadow-lg/5",
          className,
        )}
        aria-label={t("whiteboardEditor:background.label")}
      >
        <BackgroundSettings className="w-full" />
      </section>
    );
  }

  // Before anything is selected, the panel edits the style of the next element.
  const subjects: BoardElement[] =
    selected.length > 0
      ? selected
      : [
          toolType === "shape"
            ? isClassicShape(shapeKind)
              ? c.newElement(shapeKind, {})
              : c.newElement("shape", { shape: shapeKind })
            : c.newElement(toolType as BoardElement["type"], {}),
        ];
  const info: SelectionInfo = describeSelection(subjects, (id) => c.get(id));
  const isSelection = selected.length > 0;
  const value = <T,>(key: keyof ItemStyle & string, fallback: T): T | null =>
    isSelection
      ? sharedStyle<T>(subjects, key)
      : ((style[key] as unknown as T) ?? fallback);
  const set = (patch: Partial<ItemStyle>) =>
    applyStyle(c, patch, isSelection ? selected : []);

  const cropTarget = isSelection ? croppableImage(c) : null;
  const cropping = Boolean(cropTarget) && croppingId === cropTarget?.id;

  const onlyStickies =
    info.hasSticky && subjects.every((element) => element.type === "sticky");
  const strokeLabel = subjects.every((element) => element.type === "text")
    ? t("whiteboardEditor:panel.textColor")
    : t("whiteboardEditor:panel.stroke");
  // Highlighters have their own inks and widths, remembered apart from the
  // stroke of everything else.
  const highlighting = subjects.every(
    (element) => element.type === "draw" && element.penStyle === "highlighter",
  );
  const setStroke = (patch: { strokeColor?: string; strokeWidth?: number }) => {
    if (!highlighting) {
      set(patch);
      return;
    }
    c.update((state) =>
      patchStyle(state, {
        ...(patch.strokeColor !== undefined
          ? { highlighterColor: patch.strokeColor }
          : {}),
        ...(patch.strokeWidth !== undefined
          ? { highlighterWidth: patch.strokeWidth }
          : {}),
      }),
    );
    const editable = selected.filter((element) => !element.locked);
    if (editable.length > 0) c.patch(editable, patch);
  };
  const strokeColor = highlighting
    ? isSelection
      ? sharedValue<string>(subjects, "strokeColor")
      : style.highlighterColor
    : value<string>("strokeColor", "#1e1e1e");
  const strokeWidth = highlighting
    ? isSelection
      ? sharedValue<number>(subjects, "strokeWidth")
      : style.highlighterWidth
    : value<number>("strokeWidth", 2);
  const setPenStyle = (next: PenStyle) => {
    c.update((state) => ({ ...state, penStyle: next }));
    const drawings = selected.filter(
      (element) => element.type === "draw" && !element.locked,
    );
    if (drawings.length > 0) c.patch(drawings, { penStyle: next });
  };

  return (
    <section
      className={cn(
        "flex w-60 flex-col gap-3 overflow-y-auto rounded-xl border bg-card p-3 text-card-foreground shadow-lg/5",
        className,
      )}
      aria-label={t("whiteboardEditor:panel.label")}
      data-testid="whiteboard-properties"
    >
      {info.hasDraw && subjects.every((element) => element.type === "draw") && (
        <Section label={t("whiteboardEditor:pens.label")}>
          <Segmented<PenStyle>
            label={t("whiteboardEditor:pens.label")}
            value={isSelection ? info.penStyle : penStyle}
            onChange={setPenStyle}
            options={PEN_STYLE_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
              icon: <option.icon aria-hidden="true" />,
            }))}
          />
        </Section>
      )}
      {isSelection && info.allShapes && (
        <Section label={t("whiteboardEditor:shapes.label")}>
          <ChangeShapeButton
            value={info.shapeChoice}
            onPick={(shape) => changeShape(c, shape)}
          />
        </Section>
      )}
      {info.hasStroke && !onlyStickies && (
        <Section label={strokeLabel}>
          <Swatches
            label={strokeLabel}
            colors={highlighting ? HIGHLIGHTER_COLORS : STROKE_COLORS}
            value={strokeColor}
            onChange={(next) => setStroke({ strokeColor: next })}
          />
        </Section>
      )}
      {info.hasSticky && (
        <Section label={t("whiteboardEditor:panel.stickyColor")}>
          <Swatches
            label={t("whiteboardEditor:panel.stickyColor")}
            colors={STICKY_COLORS}
            value={
              isSelection
                ? sharedValue<string>(
                    subjects.filter((element) => element.type === "sticky"),
                    "fillColor",
                  )
                : style.stickyColor
            }
            onChange={(stickyColor) => set({ stickyColor })}
          />
        </Section>
      )}
      {info.hasFill && (
        <>
          <Section label={t("whiteboardEditor:panel.fill")}>
            <Swatches
              label={t("whiteboardEditor:panel.fill")}
              colors={FILL_COLORS}
              value={value<string>("fillColor", "transparent")}
              onChange={(fillColor) =>
                // A colour picked for shapes without fill must show.
                set(
                  fillColor !== "transparent" &&
                    value<FillStyle>("fillStyle", "solid") === "none"
                    ? { fillColor, fillStyle: "solid" }
                    : { fillColor },
                )
              }
            />
          </Section>
          <Section label={t("whiteboardEditor:panel.fillStyle")}>
            <Segmented<FillStyle>
              label={t("whiteboardEditor:panel.fillStyle")}
              value={value<FillStyle>("fillStyle", "solid")}
              onChange={(fillStyle) => set({ fillStyle })}
              options={[
                {
                  value: "solid",
                  label: t("whiteboardEditor:panel.fillSolid"),
                },
                {
                  value: "hatch",
                  label: t("whiteboardEditor:panel.fillHatch"),
                },
                {
                  value: "cross",
                  label: t("whiteboardEditor:panel.fillCross"),
                },
                { value: "none", label: t("whiteboardEditor:panel.fillNone") },
              ]}
            />
          </Section>
        </>
      )}
      {info.hasStroke &&
        !onlyStickies &&
        subjects.some((element) => element.type !== "text") && (
          <>
            <Section label={t("whiteboardEditor:panel.strokeWidth")}>
              <Segmented<string>
                label={t("whiteboardEditor:panel.strokeWidth")}
                value={String(strokeWidth ?? "")}
                onChange={(width) => setStroke({ strokeWidth: Number(width) })}
                options={[
                  {
                    value: "1",
                    label: t("whiteboardEditor:panel.thin"),
                    icon: <StrokeIcon width={1} />,
                  },
                  {
                    value: "2",
                    label: t("whiteboardEditor:panel.medium"),
                    icon: <StrokeIcon width={2} />,
                  },
                  {
                    value: "4",
                    label: t("whiteboardEditor:panel.bold"),
                    icon: <StrokeIcon width={3.5} />,
                  },
                  {
                    value: "8",
                    label: t("whiteboardEditor:panel.extraBold"),
                    icon: <StrokeIcon width={5} />,
                  },
                ]}
              />
            </Section>
            {subjects.some((element) => element.type !== "draw") && (
              <Section label={t("whiteboardEditor:panel.strokeStyle")}>
                <Segmented<StrokeStyle>
                  label={t("whiteboardEditor:panel.strokeStyle")}
                  value={value<StrokeStyle>("strokeStyle", "solid")}
                  onChange={(strokeStyle) => set({ strokeStyle })}
                  options={[
                    {
                      value: "solid",
                      label: t("whiteboardEditor:panel.solid"),
                      icon: <DashIcon dash="" />,
                    },
                    {
                      value: "dashed",
                      label: t("whiteboardEditor:panel.dashed"),
                      icon: <DashIcon dash="5 3" />,
                    },
                    {
                      value: "dotted",
                      label: t("whiteboardEditor:panel.dotted"),
                      icon: <DashIcon dash="1.5 2.5" />,
                    },
                  ]}
                />
              </Section>
            )}
          </>
        )}
      {info.hasSketch && (
        <Section label={t("whiteboardEditor:panel.sketch")}>
          <Segmented<string>
            label={t("whiteboardEditor:panel.sketch")}
            value={String(value<number>("sketch", 1) ?? "")}
            onChange={(sketch) => set({ sketch: Number(sketch) as 0 | 1 | 2 })}
            options={[
              { value: "0", label: t("whiteboardEditor:panel.sketchClean") },
              { value: "1", label: t("whiteboardEditor:panel.sketchLight") },
              { value: "2", label: t("whiteboardEditor:panel.sketchRough") },
            ]}
          />
        </Section>
      )}
      {info.hasRectangle && (
        <Section label={t("whiteboardEditor:panel.corners")}>
          <Segmented<string>
            label={t("whiteboardEditor:panel.corners")}
            value={String(value<number>("cornerRadius", 8) ?? "")}
            onChange={(radius) => set({ cornerRadius: Number(radius) })}
            options={[
              { value: "0", label: t("whiteboardEditor:panel.cornersSharp") },
              { value: "8", label: t("whiteboardEditor:panel.cornersRound") },
              {
                value: "24",
                label: t("whiteboardEditor:panel.cornersRounder"),
              },
            ]}
          />
        </Section>
      )}
      {info.hasText && (
        <>
          <Section label={t("whiteboardEditor:panel.font")}>
            <Segmented<FontFamily>
              label={t("whiteboardEditor:panel.font")}
              value={value<FontFamily>("fontFamily", "hand")}
              onChange={(fontFamily) => set({ fontFamily })}
              options={[
                { value: "hand", label: t("whiteboardEditor:panel.fontHand") },
                { value: "sans", label: t("whiteboardEditor:panel.fontSans") },
                { value: "mono", label: t("whiteboardEditor:panel.fontMono") },
              ]}
            />
          </Section>
          <Section label={t("whiteboardEditor:panel.fontSize")}>
            <Segmented<string>
              label={t("whiteboardEditor:panel.fontSize")}
              value={String(value<number>("fontSize", 20) ?? "")}
              onChange={(size) => set({ fontSize: Number(size) })}
              options={[
                { value: "16", label: t("whiteboardEditor:panel.sizeSmall") },
                { value: "20", label: t("whiteboardEditor:panel.sizeMedium") },
                { value: "28", label: t("whiteboardEditor:panel.sizeLarge") },
                { value: "40", label: t("whiteboardEditor:panel.sizeHuge") },
              ]}
            />
          </Section>
          <Section label={t("whiteboardEditor:panel.align")}>
            <Segmented<TextAlign>
              label={t("whiteboardEditor:panel.align")}
              value={value<TextAlign>("textAlign", "left")}
              onChange={(textAlign) => set({ textAlign })}
              options={[
                { value: "left", label: t("whiteboardEditor:panel.alignLeft") },
                {
                  value: "center",
                  label: t("whiteboardEditor:panel.alignCenter"),
                },
                {
                  value: "right",
                  label: t("whiteboardEditor:panel.alignRight"),
                },
              ]}
            />
          </Section>
        </>
      )}
      {info.hasLinear && (
        <>
          <Section label={t("whiteboardEditor:panel.routing")}>
            <Segmented<LineRouting>
              label={t("whiteboardEditor:panel.routing")}
              value={value<LineRouting>("routing", "straight")}
              onChange={(routing) =>
                setRouting(c, routing, isSelection ? selected : [])
              }
              options={[
                {
                  value: "straight",
                  label: t("whiteboardEditor:panel.routingStraight"),
                },
                {
                  value: "curved",
                  label: t("whiteboardEditor:panel.routingCurved"),
                },
                {
                  value: "elbow",
                  label: t("whiteboardEditor:panel.routingElbow"),
                },
              ]}
            />
          </Section>
          <Section label={t("whiteboardEditor:panel.arrowheads")}>
            <HeadChoice
              label={t("whiteboardEditor:panel.startHead")}
              value={value<ArrowHead>("startHead", "none")}
              onChange={(startHead) => set({ startHead })}
            />
            <HeadChoice
              label={t("whiteboardEditor:panel.endHead")}
              value={value<ArrowHead>("endHead", "arrow")}
              onChange={(endHead) => set({ endHead })}
            />
          </Section>
        </>
      )}
      <Section label={t("whiteboardEditor:panel.opacity")}>
        <Slider
          aria-label={t("whiteboardEditor:panel.opacity")}
          min={10}
          max={100}
          step={10}
          value={value<number>("opacity", 100) ?? 100}
          onValueChange={(next) => {
            const opacity = Array.isArray(next) ? next[0] : next;
            if (typeof opacity === "number") set({ opacity });
          }}
        />
      </Section>

      {isSelection && (
        <>
          <Section label={t("whiteboardEditor:panel.layers")}>
            <div className="flex items-center gap-0.5">
              <IconAction
                label={t("whiteboardEditor:commands.sendToBack")}
                onClick={() => reorder(c, "back")}
              >
                <ArrowDownToLine aria-hidden="true" />
              </IconAction>
              <IconAction
                label={t("whiteboardEditor:commands.sendBackward")}
                onClick={() => reorder(c, "backward")}
              >
                <ChevronDown aria-hidden="true" />
              </IconAction>
              <IconAction
                label={t("whiteboardEditor:commands.bringForward")}
                onClick={() => reorder(c, "forward")}
              >
                <ChevronUp aria-hidden="true" />
              </IconAction>
              <IconAction
                label={t("whiteboardEditor:commands.bringToFront")}
                onClick={() => reorder(c, "front")}
              >
                <ArrowUpToLine aria-hidden="true" />
              </IconAction>
            </div>
          </Section>
          {selected.length > 1 && (
            <Section label={t("whiteboardEditor:panel.alignment")}>
              <div className="flex flex-wrap items-center gap-0.5">
                {ALIGN_ACTIONS.map((action) => (
                  <IconAction
                    key={action.edge}
                    label={t(action.labelKey)}
                    onClick={() => align(c, action.edge)}
                  >
                    <action.icon aria-hidden="true" />
                  </IconAction>
                ))}
                <IconAction
                  label={t("whiteboardEditor:commands.distributeHorizontal")}
                  disabled={selected.length < 3}
                  onClick={() => distribute(c, "horizontal")}
                >
                  <AlignHorizontalSpaceAround aria-hidden="true" />
                </IconAction>
                <IconAction
                  label={t("whiteboardEditor:commands.distributeVertical")}
                  disabled={selected.length < 3}
                  onClick={() => distribute(c, "vertical")}
                >
                  <AlignVerticalSpaceAround aria-hidden="true" />
                </IconAction>
              </div>
            </Section>
          )}
          <Section label={t("whiteboardEditor:panel.actions")}>
            <div className="flex flex-wrap items-center gap-0.5">
              <IconAction
                label={t("whiteboardEditor:commands.duplicate")}
                onClick={() => duplicateSelection(c)}
              >
                <Copy aria-hidden="true" />
              </IconAction>
              {selected.length > 1 && (
                <IconAction
                  label={t("whiteboardEditor:commands.group")}
                  onClick={() => runCommand(c, "group")}
                >
                  <Group aria-hidden="true" />
                </IconAction>
              )}
              {info.grouped && (
                <IconAction
                  label={t("whiteboardEditor:commands.ungroup")}
                  onClick={() => runCommand(c, "ungroup")}
                >
                  <Ungroup aria-hidden="true" />
                </IconAction>
              )}
              <IconAction
                label={
                  info.allLocked
                    ? t("whiteboardEditor:commands.unlock")
                    : t("whiteboardEditor:commands.lock")
                }
                pressed={info.allLocked}
                onClick={() => setLocked(c, !info.allLocked)}
              >
                {info.allLocked ? (
                  <LockOpen aria-hidden="true" />
                ) : (
                  <Lock aria-hidden="true" />
                )}
              </IconAction>
              {selected.length === 1 && (
                <IconAction
                  label={t("whiteboardEditor:commands.editLink")}
                  onClick={actions.onEditLink}
                >
                  <Link2 aria-hidden="true" />
                </IconAction>
              )}
              <IconAction
                label={t("whiteboardEditor:commands.delete")}
                destructive
                disabled={info.allLocked}
                onClick={() => c.remove([...c.state.selectedIds])}
              >
                <Trash2 aria-hidden="true" />
              </IconAction>
            </div>
          </Section>
          {cropTarget && (
            <Section label={t("whiteboardEditor:crop.section")}>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  aria-pressed={cropping}
                  onClick={() =>
                    cropping ? c.endCrop() : c.startCrop(cropTarget.id)
                  }
                >
                  <Crop aria-hidden="true" />
                  {cropping
                    ? t("whiteboardEditor:crop.finish")
                    : t("whiteboardEditor:crop.start")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!cropTarget.crop}
                  onClick={() => resetCrop(c)}
                >
                  <RotateCcw aria-hidden="true" />
                  {t("whiteboardEditor:crop.reset")}
                </Button>
              </div>
            </Section>
          )}
          {actions.tasksEnabled &&
            (info.stickies.length > 0 || info.dependency) && (
              <div className="flex flex-col gap-1.5">
                {info.stickies.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={actions.onTurnIntoTasks}
                  >
                    <ListTodo aria-hidden="true" />
                    {t("whiteboardEditor:tasks.turnIntoTasks", {
                      count: info.stickies.length,
                    })}
                  </Button>
                )}
                {info.dependency &&
                  (actions.dependencyExists ? (
                    <Button
                      size="sm"
                      variant="destructive-outline"
                      onClick={actions.onRemoveDependency}
                    >
                      <Unlink aria-hidden="true" />
                      {t("whiteboardEditor:tasks.removeDependency")}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        info.dependency &&
                        actions.onMakeDependency(info.dependency)
                      }
                    >
                      <GitBranch aria-hidden="true" />
                      {t("whiteboardEditor:tasks.makeDependency")}
                    </Button>
                  ))}
              </div>
            )}
        </>
      )}
    </section>
  );
}

const ALIGN_ACTIONS: {
  edge: AlignEdge;
  labelKey: string;
  icon: typeof AlignStartVertical;
}[] = [
  {
    edge: "left",
    labelKey: "whiteboardEditor:commands.alignLeft",
    icon: AlignStartVertical,
  },
  {
    edge: "center",
    labelKey: "whiteboardEditor:commands.alignCenter",
    icon: AlignCenterVertical,
  },
  {
    edge: "right",
    labelKey: "whiteboardEditor:commands.alignRight",
    icon: AlignEndVertical,
  },
  {
    edge: "top",
    labelKey: "whiteboardEditor:commands.alignTop",
    icon: AlignStartHorizontal,
  },
  {
    edge: "middle",
    labelKey: "whiteboardEditor:commands.alignMiddle",
    icon: AlignCenterHorizontal,
  },
  {
    edge: "bottom",
    labelKey: "whiteboardEditor:commands.alignBottom",
    icon: AlignEndHorizontal,
  },
];

function HeadChoice({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ArrowHead | null;
  onChange: (head: ArrowHead) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Segmented<ArrowHead>
        label={label}
        value={value}
        onChange={onChange}
        options={[
          { value: "none", label: t("whiteboardEditor:panel.headNone") },
          { value: "arrow", label: t("whiteboardEditor:panel.headArrow") },
          {
            value: "triangle",
            label: t("whiteboardEditor:panel.headTriangle"),
          },
          { value: "dot", label: t("whiteboardEditor:panel.headDot") },
          { value: "bar", label: t("whiteboardEditor:panel.headBar") },
        ]}
      />
    </div>
  );
}

/** Routing changes re-route the lines right away. */
function setRouting(
  c: BoardController,
  routing: LineRouting,
  elements: readonly BoardElement[],
) {
  c.update((state) => patchStyle(state, { routing }));
  const lines = elements.filter(
    (element): element is LinearElement => isLinear(element) && !element.locked,
  );
  if (lines.length === 0) return;
  const patched = lines.map((line) => {
    const first = line.points[0] ?? ([0, 0] as const);
    const last = line.points[line.points.length - 1] ?? first;
    let points: LocalPoint[] = [...line.points];
    if (routing === "elbow") {
      points = routeElbow(
        { x: line.x + first[0], y: line.y + first[1] },
        { x: line.x + last[0], y: line.y + last[1] },
      );
    } else if (line.routing === "elbow") {
      // Leaving elbow routing drops the generated corners.
      points = [first, last];
    }
    return updateElement(line, { routing, points }, { userId: c.userId });
  });
  const byId = new Map(patched.map((line) => [line.id, line as BoardElement]));
  const all = (c.scene.elements as BoardElement[]).map(
    (element) => byId.get(element.id) ?? element,
  );
  const targets = patched.flatMap((line) =>
    [line.startBinding?.elementId, line.endBinding?.elementId].filter(
      (id): id is string => Boolean(id),
    ),
  );
  for (const routed of updateBoundLines(all, targets, { userId: c.userId })) {
    if (byId.has(routed.id)) byId.set(routed.id, routed);
  }
  c.commit([...byId.values()]);
}

/** The current outline, opening the shape library to swap it. */
function ChangeShapeButton({
  value,
  onPick,
}: {
  value: ShapeChoice | null;
  onPick: (shape: ShapeChoice) => void;
}) {
  const { t } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            className="justify-start"
            data-testid="whiteboard-change-shape"
          />
        }
      >
        {value ? <ShapeIcon shape={value} /> : <Shapes aria-hidden="true" />}
        {t("whiteboardEditor:shapes.change")}
      </PopoverTrigger>
      <PopoverPopup side="right" align="start">
        <ShapePicker value={value} onPick={onPick} />
      </PopoverPopup>
    </Popover>
  );
}

function StrokeIcon({ width }: { width: number }) {
  return (
    <svg viewBox="0 0 20 12" className="h-3 w-5" aria-hidden="true">
      <line
        x1="2"
        y1="6"
        x2="18"
        y2="6"
        stroke="currentColor"
        strokeWidth={width}
        strokeLinecap="round"
      />
    </svg>
  );
}

function DashIcon({ dash }: { dash: string }) {
  return (
    <svg viewBox="0 0 20 12" className="h-3 w-5" aria-hidden="true">
      <line
        x1="2"
        y1="6"
        x2="18"
        y2="6"
        stroke="currentColor"
        strokeWidth={2}
        strokeDasharray={dash || undefined}
        strokeLinecap="round"
      />
    </svg>
  );
}

import { Search } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import {
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import { ShapeIcon } from "./shape-icon";
import { filterShapes, SHAPE_GROUPS, SHAPE_LABEL_KEYS } from "./shapes";
import type { ShapeChoice } from "./tools";

const COLUMNS = 5;

/**
 * The shape library: a search field over a grid of shapes in groups. Arrow
 * keys move through the grid and Enter in the search field picks the first
 * match.
 */
export function ShapePicker({
  value,
  onPick,
  className,
}: {
  value: ShapeChoice | null;
  onPick: (shape: ShapeChoice) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const gridRef = useRef<HTMLDivElement | null>(null);
  const label = (shape: ShapeChoice) => t(SHAPE_LABEL_KEYS[shape]);
  const groups = filterShapes(query, label);
  const first = groups[0]?.shapes[0];

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    const steps: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    };
    const step = steps[event.key];
    if (!step) return;
    const buttons = Array.from(
      gridRef.current?.querySelectorAll<HTMLButtonElement>(
        "button[data-shape-choice]",
      ) ?? [],
    );
    const index = buttons.indexOf(event.currentTarget);
    const next = buttons[index + step];
    if (index < 0 || !next) return;
    event.preventDefault();
    // Keep the board's own arrow-key handlers out of it.
    event.stopPropagation();
    next.focus();
  };

  return (
    <div
      className={cn("flex w-64 flex-col gap-2 p-2", className)}
      data-testid="whiteboard-shape-picker"
    >
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          size="sm"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && first) {
              event.preventDefault();
              onPick(first);
            }
          }}
          placeholder={t("whiteboardEditor:shapes.search")}
          aria-label={t("whiteboardEditor:shapes.search")}
          className="[&_input]:ps-7"
        />
      </div>
      <div
        ref={gridRef}
        className="flex max-h-80 flex-col gap-2 overflow-y-auto"
      >
        {groups.length === 0 && (
          <p className="px-1 py-3 text-center text-muted-foreground text-xs">
            {t("whiteboardEditor:shapes.noResults")}
          </p>
        )}
        {groups.map((group) => (
          <section key={group.id} aria-label={t(group.labelKey)}>
            <h3 className="mb-1 px-1 font-medium text-[11px] text-muted-foreground">
              {t(group.labelKey)}
            </h3>
            <div className="grid grid-cols-5 gap-1">
              {group.shapes.map((shape) => (
                <button
                  key={shape}
                  type="button"
                  data-shape-choice={shape}
                  aria-label={label(shape)}
                  aria-pressed={value === shape}
                  title={label(shape)}
                  onClick={() => onPick(shape)}
                  onKeyDown={moveFocus}
                  className="relative inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent aria-pressed:text-accent-foreground pointer-coarse:size-11 motion-reduce:transition-none"
                >
                  <ShapeIcon shape={shape} className="size-5" />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * The library as a submenu of a menu ("Add shape", "Change shape"): one
 * labelled group per shape family.
 */
export function ShapeSubmenu({
  label,
  value,
  onPick,
}: {
  label: string;
  value: ShapeChoice | null;
  onPick: (shape: ShapeChoice) => void;
}) {
  const { t } = useTranslation();
  return (
    <MenuSub>
      <MenuSubTrigger>{label}</MenuSubTrigger>
      <MenuSubPopup className="max-h-[min(28rem,var(--available-height))] min-w-48 overflow-y-auto">
        {SHAPE_GROUPS.map((group) => (
          <MenuGroup key={group.id}>
            <MenuGroupLabel>{t(group.labelKey)}</MenuGroupLabel>
            {group.shapes.map((shape) => (
              <MenuItem
                key={shape}
                onClick={() => onPick(shape)}
                aria-current={value === shape ? "true" : undefined}
                className={cn(value === shape && "font-medium")}
              >
                <ShapeIcon shape={shape} />
                {t(SHAPE_LABEL_KEYS[shape])}
              </MenuItem>
            ))}
          </MenuGroup>
        ))}
      </MenuSubPopup>
    </MenuSub>
  );
}

// These components read the board controller (settings, read-only state)
// while rendering. It is a mutable object whose identity never changes, so
// compiler memoisation would freeze those reads.
"use no memo";

import { type BackgroundPattern, themeColor } from "@margaya/whiteboard";
import { Grid2x2 } from "lucide-react";
import { type CSSProperties, useId } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { PATTERN_SIZES, setBackground } from "./commands";
import { useController, useEditorState } from "./use-editor";

// The board's background: a pattern, its spacing and the paper colour. It
// lives in the board settings, so every collaborator sees the same canvas.

const PATTERNS: { value: BackgroundPattern; labelKey: string }[] = [
  { value: "plain", labelKey: "whiteboardEditor:background.plain" },
  { value: "dots", labelKey: "whiteboardEditor:background.dots" },
  { value: "grid", labelKey: "whiteboardEditor:background.grid" },
  { value: "lines", labelKey: "whiteboardEditor:background.lines" },
];

const SPACINGS = [
  {
    size: PATTERN_SIZES.small,
    labelKey: "whiteboardEditor:background.small",
  },
  {
    size: PATTERN_SIZES.medium,
    labelKey: "whiteboardEditor:background.medium",
  },
  {
    size: PATTERN_SIZES.large,
    labelKey: "whiteboardEditor:background.large",
  },
] as const;

/**
 * Paper colours are board content (the renderer darkens them in dark mode),
 * so they are stored colours rather than theme tokens. All are light enough
 * that the dark theme turns them into a calm dark surface.
 */
export const PAPER_COLORS: { color: string; labelKey: string }[] = [
  { color: "#ffffff", labelKey: "whiteboardEditor:background.white" },
  { color: "#fbf8f1", labelKey: "whiteboardEditor:background.cream" },
  { color: "#f4f4f0", labelKey: "whiteboardEditor:background.stone" },
  { color: "#f1f5f9", labelKey: "whiteboardEditor:background.mist" },
  { color: "#f0f7f2", labelKey: "whiteboardEditor:background.mint" },
];

/** The spacing step closest to a stored pattern size. */
export function spacingIndex(size: number): number {
  let best = 0;
  SPACINGS.forEach((step, index) => {
    const current = SPACINGS[best]?.size ?? step.size;
    if (Math.abs(step.size - size) < Math.abs(current - size)) best = index;
  });
  return best;
}

function patternPreview(pattern: BackgroundPattern): CSSProperties {
  const ink = "color-mix(in srgb, var(--muted-foreground) 55%, transparent)";
  switch (pattern) {
    case "dots":
      return {
        backgroundImage: `radial-gradient(circle, ${ink} 1.2px, transparent 1.4px)`,
        backgroundSize: "8px 8px",
        backgroundPosition: "4px 4px",
      };
    case "grid":
      return {
        backgroundImage: `linear-gradient(${ink} 1px, transparent 1px), linear-gradient(90deg, ${ink} 1px, transparent 1px)`,
        backgroundSize: "8px 8px",
      };
    case "lines":
      return {
        backgroundImage: `linear-gradient(${ink} 1px, transparent 1px)`,
        backgroundSize: "8px 8px",
      };
    case "plain":
      return {};
  }
}

/** Pattern swatches, a spacing slider and paper colours. */
export function BackgroundSettings({ className }: { className?: string }) {
  const { t } = useTranslation();
  const c = useController();
  useEditorState((state) => state.sceneVersion);
  const settings = c.settings;
  const pattern = settings.pattern ?? "plain";
  const index = spacingIndex(settings.patternSize ?? PATTERN_SIZES.medium);
  const spacing = SPACINGS[index] ?? SPACINGS[1];
  const theme = c.options.theme;
  const spacingLabelId = useId();
  return (
    <div
      className={cn("flex w-60 flex-col gap-3 p-2", className)}
      data-testid="whiteboard-background"
    >
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-medium text-[11px] text-muted-foreground">
          {t("whiteboardEditor:background.pattern")}
        </legend>
        <div className="grid grid-cols-4 gap-1.5">
          {PATTERNS.map((option) => {
            const selected = pattern === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setBackground(c, { pattern: option.value })}
                data-pattern={option.value}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg p-1 text-[11px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:text-foreground motion-reduce:transition-none",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-8 w-full rounded-md border border-border bg-background",
                    selected &&
                      "ring-2 ring-ring ring-offset-1 ring-offset-background",
                  )}
                  style={patternPreview(option.value)}
                />
                {t(option.labelKey)}
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset
        className="flex flex-col gap-1.5"
        disabled={pattern === "plain"}
      >
        <legend className="mb-1.5 flex w-full items-center justify-between font-medium text-[11px] text-muted-foreground">
          <span id={spacingLabelId}>
            {t("whiteboardEditor:background.spacing")}
          </span>
          <span className="tabular-nums">{t(spacing.labelKey)}</span>
        </legend>
        {/* The slider's input takes its name only from aria-labelledby. */}
        <Slider
          aria-labelledby={spacingLabelId}
          min={0}
          max={SPACINGS.length - 1}
          step={1}
          value={index}
          disabled={pattern === "plain"}
          onValueChange={(next) => {
            const step = Array.isArray(next) ? next[0] : next;
            const size = typeof step === "number" ? SPACINGS[step]?.size : null;
            if (size) setBackground(c, { patternSize: size });
          }}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-medium text-[11px] text-muted-foreground">
          {t("whiteboardEditor:background.paper")}
        </legend>
        <div className="flex flex-wrap items-center gap-1">
          {PAPER_COLORS.map((paper) => {
            const selected =
              settings.background.toLowerCase() === paper.color.toLowerCase();
            return (
              <button
                key={paper.color}
                type="button"
                aria-pressed={selected}
                aria-label={t(paper.labelKey)}
                title={t(paper.labelKey)}
                onClick={() => setBackground(c, { background: paper.color })}
                className={cn(
                  "relative size-6 shrink-0 rounded-md border border-border outline-none transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11 motion-reduce:transition-none",
                  selected &&
                    "ring-2 ring-ring ring-offset-1 ring-offset-background",
                )}
                // Shown as the board will draw it in the current theme.
                style={{ backgroundColor: themeColor(paper.color, theme) }}
              />
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

/** The chrome bar's "Background" button; hidden on read-only boards. */
export function BackgroundButton() {
  const { t } = useTranslation();
  const c = useController();
  if (c.readOnly) return null;
  const label = t("whiteboardEditor:background.label");
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={label}
                  className="pointer-coarse:size-11"
                  data-testid="whiteboard-background-button"
                />
              }
            />
          }
        >
          <Grid2x2 aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
      <PopoverPopup side="top" align="start" sideOffset={8}>
        <BackgroundSettings />
      </PopoverPopup>
    </Popover>
  );
}

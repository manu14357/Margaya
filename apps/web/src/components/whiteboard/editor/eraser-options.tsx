import { useTranslation } from "react-i18next";
import { Slider } from "@/components/ui/slider";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
import { cn } from "@/lib/cn";
import { clampEraserSize, ERASER_MODES, ERASER_SIZE } from "./store";
import { useController, useEditorState } from "./use-editor";

/**
 * The eraser's size and what it takes, shown while the eraser is the tool.
 * Both are remembered on this device.
 */
export function EraserOptions({ className }: { className?: string }) {
  const { t } = useTranslation();
  const c = useController();
  const size = useEditorState((state) => state.eraserSize);
  const mode = useEditorState((state) => state.eraserMode);
  const label = t("whiteboardEditor:eraser.label");
  const sizeLabel = t("whiteboardEditor:eraser.size");
  const modeLabel = t("whiteboardEditor:eraser.mode");
  return (
    <section
      className={cn(
        "flex w-60 flex-col gap-3 rounded-xl border bg-card p-3 text-card-foreground shadow-lg/5",
        className,
      )}
      aria-label={label}
      data-testid="whiteboard-eraser-options"
    >
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 flex w-full items-center justify-between font-medium text-[11px] text-muted-foreground">
          <span>{sizeLabel}</span>
          <span className="tabular-nums">{size}</span>
        </legend>
        <div className="flex items-center gap-3">
          <Slider
            aria-label={sizeLabel}
            min={ERASER_SIZE.min}
            max={ERASER_SIZE.max}
            step={2}
            value={size}
            onValueChange={(next) => {
              const value = Array.isArray(next) ? next[0] : next;
              if (typeof value !== "number") return;
              c.update((state) => ({
                ...state,
                eraserSize: clampEraserSize(value),
              }));
            }}
          />
          {/* The ring the canvas will show, at its real size up to the box. */}
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center"
          >
            <span
              className="block rounded-full border border-foreground/70"
              style={{
                width: Math.min(size, 36),
                height: Math.min(size, 36),
              }}
            />
          </span>
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-medium text-[11px] text-muted-foreground">
          {modeLabel}
        </legend>
        <ToggleGroup
          size="sm"
          variant="outline"
          aria-label={modeLabel}
          value={[mode]}
          onValueChange={(values) => {
            const next = ERASER_MODES.find((value) => value === values[0]);
            if (next) c.update((state) => ({ ...state, eraserMode: next }));
          }}
          className="w-full"
        >
          {ERASER_MODES.map((value) => (
            <Toggle key={value} value={value} className="flex-auto px-1.5">
              {value === "parts"
                ? t("whiteboardEditor:eraser.parts")
                : t("whiteboardEditor:eraser.whole")}
            </Toggle>
          ))}
        </ToggleGroup>
        <p className="text-[11px] text-muted-foreground">
          {mode === "parts"
            ? t("whiteboardEditor:eraser.partsHint")
            : t("whiteboardEditor:eraser.wholeHint")}
        </p>
      </fieldset>
    </section>
  );
}

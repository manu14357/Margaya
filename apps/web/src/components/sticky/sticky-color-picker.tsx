import { Check, Palette } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import {
  STICKY_COLOR_META,
  STICKY_COLORS,
  type StickyColor,
} from "@/lib/sticky-colors";

type StickyColorPickerProps = {
  value: StickyColor;
  onChange: (color: StickyColor) => void;
  triggerClassName?: string;
};

/** The footer's Color button and its swatch grid. */
export default function StickyColorPicker({
  value,
  onChange,
  triggerClassName,
}: StickyColorPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className={triggerClassName}
            aria-label={t("stickies:color.button")}
            title={t("stickies:color.button")}
          />
        }
      >
        <Palette />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto">
        <p className="mb-2 text-xs text-muted-foreground">
          {t("stickies:color.label")}
        </p>
        <div className="grid grid-cols-5 gap-1.5">
          {STICKY_COLORS.map((key) => {
            const meta = STICKY_COLOR_META[key];
            const selected = key === value;
            return (
              <button
                key={key}
                type="button"
                aria-label={t(meta.nameKey)}
                aria-pressed={selected}
                title={t(meta.nameKey)}
                className={cn(
                  "flex size-6 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  meta.swatchClassName,
                )}
                onClick={() => {
                  setOpen(false);
                  if (!selected) onChange(key);
                }}
              >
                {selected && <Check className="size-3.5 text-white" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import {
  Angry,
  Frown,
  Laugh,
  type LucideIcon,
  Meh,
  Smile,
  Star,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { type FeedbackFormat, scaleOptions } from "@/lib/feedback";

const FACES5: LucideIcon[] = [Angry, Frown, Meh, Smile, Laugh];
const FACES3: LucideIcon[] = [Frown, Meh, Smile];

function iconFor(format: FeedbackFormat, index: number): LucideIcon | null {
  if (format === "faces5") return FACES5[index] ?? null;
  if (format === "faces3") return FACES3[index] ?? null;
  if (format === "stars") return Star;
  if (format === "thumbs") return index === 0 ? ThumbsDown : ThumbsUp;
  return null;
}

type RatingScaleProps = {
  format: FeedbackFormat;
  value: number | null;
  onChange: (score: number) => void;
  /** The question, read as the group's name. */
  label: string;
  disabled?: boolean;
  className?: string;
};

/**
 * A rating as a radio group: one Tab stop, arrow keys move between choices,
 * and every choice has a spoken name (a face's mood, "3 stars", "7 out of
 * 10"), never only an icon or a colour.
 */
export function RatingScale({
  format,
  value,
  onChange,
  label,
  disabled = false,
  className,
}: RatingScaleProps) {
  const { t } = useTranslation();
  const options = scaleOptions(format);
  const nps = format === "nps";

  return (
    <div className={cn("space-y-1", className)}>
      <RadioGroupPrimitive<number | null>
        aria-label={label}
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (typeof next === "number") onChange(next);
        }}
        className={cn("flex", nps ? "flex-wrap gap-1" : "gap-1.5")}
      >
        {options.map((option, index) => {
          const Icon = iconFor(format, index);
          const filled =
            format === "stars"
              ? value !== null && option.score <= value
              : value === option.score;
          return (
            <RadioPrimitive.Root
              key={option.score}
              value={option.score}
              aria-label={t(option.labelKey, { count: option.score })}
              className={cn(
                "inline-flex shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground outline-none transition-colors",
                "hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                "data-disabled:opacity-64 pointer-coarse:min-h-11 pointer-coarse:min-w-11",
                nps ? "h-8 min-w-8 px-1 font-mono text-xs" : "size-9",
                value === option.score &&
                  "border-primary bg-accent text-accent-foreground",
                format === "stars" && filled && "text-primary",
              )}
            >
              {Icon ? (
                <Icon
                  aria-hidden
                  className={cn(
                    "size-5",
                    format === "stars" && filled && "fill-current",
                  )}
                />
              ) : (
                <span aria-hidden>{option.score}</span>
              )}
            </RadioPrimitive.Root>
          );
        })}
      </RadioGroupPrimitive>
      {nps && (
        <div
          aria-hidden
          className="flex justify-between text-[11px] text-muted-foreground"
        >
          <span>{t("settings:feedback.scale.npsLow")}</span>
          <span>{t("settings:feedback.scale.npsHigh")}</span>
        </div>
      )}
    </div>
  );
}

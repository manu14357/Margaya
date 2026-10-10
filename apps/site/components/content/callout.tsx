import { Info, Lightbulb, TriangleAlert } from "lucide-react";
import type { GuideCallout } from "@/lib/guides";
import { cn } from "@/lib/utils";
import { InlineText } from "./inline-text";

const tones = {
  tip: {
    icon: Lightbulb,
    label: "Tip",
    frame: "border-success/30 bg-success/[0.06]",
    mark: "text-success-foreground",
  },
  note: {
    icon: Info,
    label: "Note",
    frame: "border-info/30 bg-info/[0.06]",
    mark: "text-info-foreground",
  },
  warning: {
    icon: TriangleAlert,
    label: "Careful",
    frame: "border-warning/40 bg-warning/[0.08]",
    mark: "text-warning-foreground",
  },
} as const;

export function Callout({
  callout,
  className,
}: {
  callout: GuideCallout;
  className?: string;
}) {
  const tone = tones[callout.tone];
  const Icon = tone.icon;

  return (
    <aside
      className={cn(
        "flex gap-3 rounded-xl border px-4 py-3.5 text-sm leading-relaxed",
        tone.frame,
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 size-4 shrink-0", tone.mark)}
      />
      <div className="min-w-0">
        <p className="font-medium text-foreground">
          <span className="sr-only">{tone.label}: </span>
          {callout.title}
        </p>
        <p className="mt-1 text-foreground/75">
          <InlineText text={callout.body} />
        </p>
      </div>
    </aside>
  );
}

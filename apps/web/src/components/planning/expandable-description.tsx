import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

/** Longer descriptions get a "Show more" toggle below the clamped text. */
const LONG_DESCRIPTION = 160;

/** A description clamped to three lines, expandable when it is long. */
export default function ExpandableDescription({
  text,
}: {
  text: string | null | undefined;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;

  return (
    <div>
      <p
        className={cn(
          "whitespace-pre-wrap text-muted-foreground text-sm",
          !expanded && "line-clamp-3",
        )}
      >
        {text}
      </p>
      {text.length > LONG_DESCRIPTION && (
        <button
          type="button"
          className="mt-1 text-primary text-xs hover:underline"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? t("planning:description.showLess")
            : t("planning:description.showMore")}
        </button>
      )}
    </div>
  );
}

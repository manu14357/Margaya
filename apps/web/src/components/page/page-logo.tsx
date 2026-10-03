import { cn } from "@/lib/cn";
import { resolvePageLogo } from "@/lib/pages/page-logo";

type PageLogoProps = {
  logoKind: string | null | undefined;
  logoValue: string | null | undefined;
  /** Sizes the icon or the emoji box, e.g. "size-4". */
  className?: string;
};

/** A page's emoji or icon (the page icon when it has none). */
export default function PageLogo({
  logoKind,
  logoValue,
  className,
}: PageLogoProps) {
  const logo = resolvePageLogo(logoKind, logoValue);
  if (logo.kind === "emoji") {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center leading-none",
          className,
        )}
      >
        <span className="text-[0.95em]">{logo.emoji}</span>
      </span>
    );
  }
  const { Icon } = logo;
  return (
    <Icon
      aria-hidden="true"
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
    />
  );
}

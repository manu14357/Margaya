import type { CSSProperties } from "react";
import { cn } from "../lib/cn";

const SIZES = {
  xs: "size-4 text-[8px]",
  sm: "size-5 text-[9px]",
  md: "size-6 text-[10px]",
  lg: "size-8 text-xs",
} as const;

export type AvatarSize = keyof typeof SIZES;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** The app's eight `--avatar-N` identity hues. */
const IDENTITY_HUES = 8;

/** FNV-1a, as the app hashes a seed to its identity hue. */
function identityHash(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A stable identity colour for a person or project, as a CSS value. */
export function identityColor(seed: string): string {
  return `var(--avatar-${(identityHash(seed) % IDENTITY_HUES) + 1})`;
}

/** A soft tile of the identity hue with legible text, like the app's avatar. */
export function identityTileStyle(seed: string): CSSProperties {
  const color = identityColor(seed);
  return {
    backgroundColor: `color-mix(in srgb, ${color} 18%, var(--background))`,
    color: `color-mix(in srgb, ${color} 60%, var(--foreground))`,
  };
}

/** A person's initials on their identity hue, like the app's avatar. */
export function Avatar({
  name,
  size = "sm",
  ring,
  className,
}: {
  name: string;
  size?: AvatarSize;
  /** The surface behind the avatar, so an overlap ring blends in. */
  ring?: "card" | "background";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      title={name}
      style={identityTileStyle(name)}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium",
        SIZES[size],
        ring && "ring-2",
        ring === "card" && "ring-card",
        ring === "background" && "ring-background",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Overlapping faces with a "+N" chip, like the board card's stack. */
export function AvatarStack({
  names,
  max = 2,
  size = "sm",
  ring = "background",
  className,
}: {
  names: readonly string[];
  max?: number;
  size?: AvatarSize;
  ring?: "card" | "background";
  className?: string;
}) {
  if (names.length === 0) {
    return (
      <span
        aria-hidden
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-muted font-medium text-muted-foreground",
          SIZES[size],
          className,
        )}
      >
        ?
      </span>
    );
  }
  const extra = names.length - max;
  return (
    <span
      role="img"
      aria-label={names.join(", ")}
      className={cn(
        "inline-flex shrink-0 items-center -space-x-1.5",
        className,
      )}
    >
      {names.slice(0, max).map((name) => (
        <Avatar key={name} name={name} size={size} ring={ring} />
      ))}
      {extra > 0 && (
        <span
          className={cn(
            "relative inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-muted font-medium text-muted-foreground ring-2",
            SIZES[size],
            ring === "card" ? "ring-card" : "ring-background",
          )}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

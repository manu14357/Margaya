"use client";

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";

import { cn } from "@/lib/cn";
import { identityHue, identityTileStyle } from "@/lib/identity-color";
import { resolveAvatarSrc } from "@/lib/resolve-avatar-src";

function Avatar({ className, ...props }: AvatarPrimitive.Root.Props) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "inline-flex size-8 shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-background align-middle font-medium text-xs",
        className,
      )}
      data-slot="avatar"
      {...props}
    />
  );
}

function AvatarImage({
  className,
  src,
  ...props
}: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      className={cn("size-full object-cover", className)}
      data-slot="avatar-image"
      src={typeof src === "string" ? resolveAvatarSrc(src) : src}
      {...props}
    />
  );
}

/**
 * Initials get a stable identity hue (`--avatar-1..8`), hashed from `seed` or
 * else from the initials themselves, so a person looks the same everywhere.
 * Placeholders (an icon or "?" for "unassigned") stay neutral.
 */
function AvatarFallback({
  className,
  seed,
  style,
  children,
  ...props
}: AvatarPrimitive.Fallback.Props & { seed?: string }) {
  const text =
    typeof children === "string" || typeof children === "number"
      ? String(children).trim()
      : "";
  // "?" and other placeholders (unassigned, unknown) stay neutral.
  const identity = seed || (/[\p{L}\p{N}]/u.test(text) ? text : "");
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        "flex size-full items-center justify-center rounded-full bg-muted",
        className,
      )}
      data-slot="avatar-fallback"
      data-identity={identity ? identityHue(identity) : undefined}
      style={
        identity && typeof style !== "function"
          ? { ...identityTileStyle(identity), ...style }
          : style
      }
      {...props}
    >
      {children}
    </AvatarPrimitive.Fallback>
  );
}

export { Avatar, AvatarFallback, AvatarImage };

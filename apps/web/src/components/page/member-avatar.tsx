import type { CSSProperties } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/get-initials";
import { resolveAvatarSrc } from "@/lib/resolve-avatar-src";

type MemberAvatarProps = {
  name: string;
  image?: string | null;
  className?: string;
  style?: CSSProperties;
};

/** A workspace member's face, with initials while the image loads. */
export default function MemberAvatar({
  name,
  image,
  className,
  style,
}: MemberAvatarProps) {
  return (
    <Avatar className={cn("size-5", className)} style={style}>
      <AvatarImage src={resolveAvatarSrc(image ?? undefined) ?? ""} alt="" />
      <AvatarFallback className="border border-border/30 font-medium text-[10px]">
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

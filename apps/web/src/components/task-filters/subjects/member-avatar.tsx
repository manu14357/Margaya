import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/get-initials";

/** A small face for filter rows, chips and group headers. */
export function MemberAvatar({
  name,
  image,
  className,
}: {
  name?: string | null;
  image?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-4", className)}>
      <AvatarImage src={image ?? ""} alt={name ?? ""} />
      <AvatarFallback className="border border-border/30 font-medium text-[9px]">
        {getInitials(name ?? undefined)}
      </AvatarFallback>
    </Avatar>
  );
}

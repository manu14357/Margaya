import Image from "next/image";
import type { BlogAuthor } from "@/lib/blog/types";
import { cn } from "@/lib/utils";

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function BlogAvatar({
  author,
  className,
}: {
  author: BlogAuthor;
  className?: string;
}) {
  if (author.avatar) {
    return (
      <Image
        alt=""
        className={cn("size-9 shrink-0 rounded-lg object-cover", className)}
        height={36}
        src={author.avatar}
        width={36}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted font-medium text-[0.6875rem] text-muted-foreground",
        className,
      )}
    >
      {initials(author.name)}
    </span>
  );
}

export function BlogByline({
  author,
  meta,
}: {
  author: BlogAuthor;
  meta?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <BlogAvatar author={author} />
      <div className="min-w-0 text-sm">
        <p className="font-medium leading-tight">{author.name}</p>
        <p className="mt-0.5 truncate text-muted-foreground text-xs leading-tight">
          {meta ?? author.role}
        </p>
      </div>
    </div>
  );
}

import { ArrowRight } from "lucide-react";
import Image from "next/image";
import { formatBlogDate, formatBlogDateShort } from "@/lib/blog/format";
import type { BlogPost } from "@/lib/blog/types";
import { blogPath } from "@/lib/blog/types";
import { cn } from "@/lib/utils";
import { BlogByline } from "./blog-byline";

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4";

function Cover({
  post,
  className,
  eager = false,
}: {
  post: BlogPost;
  className?: string;
  /** The featured cover is usually the largest thing above the fold. */
  eager?: boolean;
}) {
  // Comparison posts get a drawn cover: the tool in question, then the
  // options the post weighs. It says more than the social card would.
  if (post.subject) {
    return (
      <div
        aria-hidden="true"
        className={cn(
          "relative flex aspect-[1200/630] flex-col justify-between overflow-hidden rounded-xl border border-border bg-muted/50 p-5 transition-colors group-hover:border-foreground/25 md:p-6",
          className,
        )}
      >
        <div>
          <p className="font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-wider">
            Instead of
          </p>
          <p className="mt-1 font-medium text-3xl text-foreground/85 tracking-tight md:text-4xl">
            {post.subject}
          </p>
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {post.tools.map((tool) => (
            <li
              className={cn(
                "rounded-full border px-2.5 py-1 text-[0.6875rem] leading-none",
                tool === "Margaya"
                  ? "border-primary/40 bg-background font-medium text-primary"
                  : "border-border bg-background text-foreground/70",
              )}
              key={tool}
            >
              {tool}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-muted transition-colors group-hover:border-foreground/25",
        className,
      )}
    >
      <Image
        alt=""
        className="aspect-[1200/630] h-auto w-full object-cover"
        height={630}
        loading={eager ? "eager" : "lazy"}
        src={post.image}
        width={1200}
      />
    </div>
  );
}

function Meta({ post }: { post: BlogPost }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
      <span className="font-medium text-foreground/80">
        {post.category.name}
      </span>
      <span aria-hidden="true">·</span>
      <time dateTime={post.date}>{formatBlogDateShort(post.date)}</time>
      <span aria-hidden="true">·</span>
      <span>{post.readingTimeMinutes} min read</span>
    </p>
  );
}

/**
 * A post in a grid, or (`featured`) the wide lead story on the blog index.
 * The whole card is one link; the title carries its accessible name.
 */
export function BlogPostCard({
  post,
  featured = false,
}: {
  post: BlogPost;
  featured?: boolean;
}) {
  if (featured) {
    return (
      <a
        className={cn(
          "group grid gap-6 rounded-2xl border border-border bg-card p-3 transition-colors hover:border-foreground/25 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:items-center md:gap-10 md:p-4",
          FOCUS,
        )}
        href={blogPath(post.slug)}
      >
        <Cover eager post={post} />
        <div className="px-3 pb-4 md:px-0 md:py-4 md:pr-6">
          <p className="inline-flex items-center rounded-full border border-border/80 px-2.5 py-0.5 font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-wider">
            Featured
          </p>
          <h2 className="mt-4 text-balance font-medium text-2xl leading-tight md:text-[2rem] md:leading-[1.15]">
            {post.title}
          </h2>
          <p className="mt-4 text-muted-foreground leading-relaxed md:text-lg">
            {post.excerpt}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <BlogByline
              author={post.author}
              meta={`${formatBlogDate(post.updatedOn ?? post.date)} · ${post.readingTimeMinutes} min read`}
            />
            <span className="inline-flex items-center gap-1.5 font-medium text-sm">
              Read the post
              <ArrowRight
                aria-hidden="true"
                className="size-4 transition-transform group-hover:translate-x-0.5"
              />
            </span>
          </div>
        </div>
      </a>
    );
  }

  return (
    <a
      className={cn("group flex flex-col rounded-2xl", FOCUS)}
      href={blogPath(post.slug)}
    >
      <Cover post={post} />
      <div className="mt-5 flex flex-1 flex-col">
        <Meta post={post} />
        <h3 className="mt-3 text-balance font-medium text-lg leading-snug transition-colors group-hover:text-foreground/70">
          {post.title}
        </h3>
        <p className="mt-2 line-clamp-3 text-muted-foreground text-sm leading-relaxed">
          {post.excerpt}
        </p>
      </div>
    </a>
  );
}

import { Rss } from "lucide-react";
import type { BlogCategory, BlogPost } from "@/lib/blog/types";
import { blogCategoryPath } from "@/lib/blog/types";
import { cn } from "@/lib/utils";
import { BlogPostCard } from "./blog-post-card";

const RSS_PATH = "/blog/rss.xml";

export function BlogCategoryFilter({
  categories,
  activeSlug,
  counts,
}: {
  categories: BlogCategory[];
  activeSlug?: string;
  counts: Record<string, number> & { all: number };
}) {
  const chip =
    "inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2";
  const idle =
    "border-border/80 text-muted-foreground hover:border-foreground/25 hover:text-foreground";
  const current = "border-foreground bg-foreground text-background";

  const options = [
    { slug: undefined, name: "All posts", href: "/blog", count: counts.all },
    ...categories.map((category) => ({
      slug: category.slug,
      name: category.name,
      href: blogCategoryPath(category.slug),
      count: counts[category.slug] ?? 0,
    })),
  ];

  return (
    <nav aria-label="Blog categories">
      <ul className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.slug === activeSlug;
          return (
            <li key={option.href}>
              <a
                aria-current={active ? "page" : undefined}
                className={cn(chip, active ? current : idle)}
                href={option.href}
              >
                {option.name}
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    active ? "opacity-70" : "text-foreground/40",
                  )}
                >
                  {option.count}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function BlogIndex({
  eyebrow,
  title,
  description,
  categories,
  counts,
  activeSlug,
  featured,
  posts,
}: {
  eyebrow: string;
  title: string;
  description: string;
  categories: BlogCategory[];
  counts: Record<string, number> & { all: number };
  activeSlug?: string;
  featured?: BlogPost;
  posts: BlogPost[];
}) {
  return (
    <>
      <section className="px-6 pt-14 pb-10 md:pt-20 md:pb-12">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <header className="max-w-2xl">
            <p className="font-medium text-muted-foreground text-sm">
              {eyebrow}
            </p>
            <h1 className="mt-3 text-balance font-medium text-4xl leading-[1.06] md:text-5xl">
              {title}
            </h1>
            <p className="mt-5 text-balance text-lg text-muted-foreground leading-relaxed">
              {description}
            </p>
          </header>
          <a
            className="inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-full border border-border/80 px-4 text-muted-foreground text-sm transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 md:self-end"
            href={RSS_PATH}
          >
            <Rss aria-hidden="true" className="size-4" />
            Subscribe with RSS
          </a>
        </div>
      </section>

      {featured ? (
        <section aria-label="Featured post" className="px-4 md:px-6">
          <div className="mx-auto w-full max-w-6xl">
            <BlogPostCard featured post={featured} />
          </div>
        </section>
      ) : null}

      <section
        aria-labelledby="blog-all-posts"
        className="px-6 pt-14 pb-20 md:pt-16 md:pb-24"
      >
        <div className="mx-auto w-full max-w-6xl">
          <div className="flex flex-col gap-5 border-border/70 border-b pb-6 md:flex-row md:items-center md:justify-between">
            <h2 className="font-medium text-xl" id="blog-all-posts">
              {featured ? "More to read" : "Posts"}
            </h2>
            <BlogCategoryFilter
              activeSlug={activeSlug}
              categories={categories}
              counts={counts}
            />
          </div>

          {posts.length > 0 ? (
            <div className="mt-10 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <BlogPostCard key={post.slug} post={post} />
              ))}
            </div>
          ) : (
            <p className="mt-10 text-muted-foreground">
              {featured
                ? "That's everything for now. New posts appear in the RSS feed first."
                : "Nothing here yet. New posts appear in the RSS feed first."}
            </p>
          )}
        </div>
      </section>
    </>
  );
}

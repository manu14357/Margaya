import { ArrowLeft } from "lucide-react";
import { CtaBand } from "@/components/content/cta-band";
import { ReadingProgress } from "@/components/content/reading-progress";
import { formatBlogDate } from "@/lib/blog/format";
import type { BlogPost } from "@/lib/blog/types";
import { blogCategoryPath, blogPath } from "@/lib/blog/types";
import { BlogAvatar, BlogByline } from "./blog-byline";
import { BlogPostCard } from "./blog-post-card";
import { BlogToc, BlogTocDisclosure } from "./blog-toc";
import { Footer } from "./footer";
import { breadcrumbJsonLd, JsonLd } from "./json-ld";
import { Navbar } from "./navbar";

const SITE = "https://margaya.app";
const LINK =
  "transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4";

export function BlogPostPage({
  post,
  related,
}: {
  post: BlogPost;
  related: BlogPost[];
}) {
  const path = blogPath(post.slug);
  const updated = post.updatedOn && post.updatedOn !== post.date;

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Margaya", path: "/" },
          { name: "Blog", path: "/blog" },
          {
            name: post.category.name,
            path: blogCategoryPath(post.category.slug),
          },
          { name: post.title, path },
        ])}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: post.title,
          description: post.description,
          datePublished: post.date,
          dateModified: post.updatedOn ?? post.date,
          articleSection: post.category.name,
          image: `${SITE}${post.image}`,
          inLanguage: "en",
          mainEntityOfPage: `${SITE}${path}`,
          url: `${SITE}${path}`,
          wordCount: post.markdown.split(/\s+/).filter(Boolean).length,
          timeRequired: `PT${post.readingTimeMinutes}M`,
          author: {
            "@type": "Organization",
            name: post.author.name,
            ...(post.author.url ? { url: post.author.url } : {}),
          },
          publisher: {
            "@type": "Organization",
            name: "Margaya",
            url: SITE,
            logo: `${SITE}/logo-512.png`,
          },
        }}
      />
      <ReadingProgress targetId="post-body" />
      <Navbar />
      <main
        className="min-h-screen bg-[var(--background)] text-[var(--foreground)]"
        id="top"
      >
        <header className="px-6 pt-12 pb-10 md:pt-20 md:pb-14">
          <div className="mx-auto w-full max-w-3xl">
            <nav aria-label="Breadcrumb">
              <ol className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
                <li>
                  <a
                    className={`inline-flex items-center gap-1.5 ${LINK}`}
                    href="/blog"
                  >
                    <ArrowLeft aria-hidden="true" className="size-3.5" />
                    Blog
                  </a>
                </li>
                <li aria-hidden="true">/</li>
                <li>
                  <a
                    className={LINK}
                    href={blogCategoryPath(post.category.slug)}
                  >
                    {post.category.name}
                  </a>
                </li>
              </ol>
            </nav>
            <h1 className="mt-6 text-balance font-medium text-[2.5rem] leading-[1.08] tracking-[-0.03em] md:text-[3.25rem]">
              {post.title}
            </h1>
            <p className="mt-6 text-balance text-lg text-muted-foreground leading-relaxed md:text-xl">
              {post.description}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4 border-border/70 border-y py-4">
              <BlogByline author={post.author} />
              <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <div className="flex gap-1.5">
                  <dt className="text-muted-foreground">Published</dt>
                  <dd>
                    <time dateTime={post.date}>
                      {formatBlogDate(post.date)}
                    </time>
                  </dd>
                </div>
                {updated && post.updatedOn ? (
                  <div className="flex gap-1.5">
                    <dt className="text-muted-foreground">Updated</dt>
                    <dd>
                      <time dateTime={post.updatedOn}>
                        {formatBlogDate(post.updatedOn)}
                      </time>
                    </dd>
                  </div>
                ) : null}
                <div className="flex gap-1.5">
                  <dt className="sr-only">Reading time</dt>
                  <dd className="text-muted-foreground">
                    {post.readingTimeMinutes} min read
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </header>

        <div className="px-6 pb-20 md:pb-24">
          <div className="mx-auto grid w-full max-w-3xl gap-10 lg:max-w-6xl lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,42rem)_14rem] xl:justify-between">
            <aside className="max-lg:hidden">
              <div className="sticky top-24">
                <BlogToc entries={post.toc} />
              </div>
            </aside>

            <article className="min-w-0" id="post-body">
              <div className="mb-10 lg:hidden">
                <BlogTocDisclosure entries={post.toc} />
              </div>
              <div
                className="blog-prose"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: post bodies are trusted markdown files in this repository, rendered to HTML at build time.
                dangerouslySetInnerHTML={{ __html: post.html }}
              />

              <footer className="mt-16 flex gap-4 rounded-2xl border border-border/80 bg-card p-5 md:p-6">
                <BlogAvatar author={post.author} className="size-11" />
                <div className="min-w-0 text-sm leading-relaxed">
                  <p className="font-medium">
                    Written by the {post.author.name}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    We build Margaya, so we have a stake in this topic. We
                    describe other tools from their own documentation and update
                    posts when things change. Spotted something out of date?{" "}
                    <a
                      className="text-foreground underline decoration-border underline-offset-4 hover:decoration-current"
                      href="mailto:support@margaya.app"
                    >
                      Tell us
                    </a>
                    .
                  </p>
                </div>
              </footer>

              <div className="mt-10">
                <CtaBand />
              </div>
            </article>
          </div>
        </div>

        {related.length > 0 ? (
          <section
            aria-labelledby="related-posts"
            className="border-border/70 border-t px-6 py-16 md:py-20"
          >
            <div className="mx-auto w-full max-w-6xl">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <h2
                  className="font-medium text-2xl md:text-3xl"
                  id="related-posts"
                >
                  Keep reading
                </h2>
                <a
                  className={`text-muted-foreground text-sm ${LINK}`}
                  href="/blog"
                >
                  All posts
                </a>
              </div>
              <div className="mt-10 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
                {related.map((item) => (
                  <BlogPostCard key={item.slug} post={item} />
                ))}
              </div>
            </div>
          </section>
        ) : null}
      </main>
      <Footer />
    </>
  );
}

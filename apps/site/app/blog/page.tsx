import type { Metadata } from "next";
import { BlogIndex } from "@/components/landing/blog-index";
import { Footer } from "@/components/landing/footer";
import { breadcrumbJsonLd, JsonLd } from "@/components/landing/json-ld";
import { Navbar } from "@/components/landing/navbar";
import {
  blogPath,
  getCategoryCounts,
  getFeaturedPost,
  getPosts,
  getUsedCategories,
} from "@/lib/blog";

const SITE = "https://margaya.app";
const DESCRIPTION =
  "Fair comparisons and practical writing from the Margaya team on choosing, running and moving between project management tools.";

export const metadata: Metadata = {
  title: "Blog",
  description: DESCRIPTION,
  alternates: {
    canonical: "/blog",
    types: { "application/rss+xml": `${SITE}/blog/rss.xml` },
  },
  openGraph: {
    type: "website",
    title: "Blog | Margaya",
    description: DESCRIPTION,
    url: `${SITE}/blog`,
  },
};

export default function Page() {
  const posts = getPosts();
  const featured = getFeaturedPost();
  const rest = posts.filter((post) => post.slug !== featured?.slug);

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Margaya", path: "/" },
          { name: "Blog", path: "/blog" },
        ])}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Blog",
          name: "Margaya blog",
          description: DESCRIPTION,
          url: `${SITE}/blog`,
          inLanguage: "en",
          publisher: {
            "@type": "Organization",
            name: "Margaya",
            url: SITE,
            logo: `${SITE}/logo-512.png`,
          },
          blogPost: posts.map((post) => ({
            "@type": "BlogPosting",
            headline: post.title,
            description: post.excerpt,
            datePublished: post.date,
            dateModified: post.updatedOn ?? post.date,
            image: `${SITE}${post.image}`,
            url: `${SITE}${blogPath(post.slug)}`,
            author: {
              "@type": "Organization",
              name: post.author.name,
              ...(post.author.url ? { url: post.author.url } : {}),
            },
          })),
        }}
      />
      <Navbar />
      <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <BlogIndex
          categories={getUsedCategories()}
          counts={getCategoryCounts()}
          description="Fair comparisons of the tools teams choose between, and practical notes on running and moving between them. Written by the people who build Margaya, who say so whenever it matters."
          eyebrow="Blog"
          featured={featured}
          posts={rest}
          title="Notes on choosing and running project tools"
        />
      </main>
      <Footer />
    </>
  );
}

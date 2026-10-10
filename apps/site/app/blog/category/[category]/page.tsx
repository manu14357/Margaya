import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogIndex } from "@/components/landing/blog-index";
import { Footer } from "@/components/landing/footer";
import { breadcrumbJsonLd, JsonLd } from "@/components/landing/json-ld";
import { Navbar } from "@/components/landing/navbar";
import {
  blogCategoryPath,
  blogPath,
  categories,
  getCategoryCounts,
  getPostsByCategory,
  getUsedCategories,
} from "@/lib/blog";

// `output: "export"` can only serve the generated params; anything else is a 404.
export const dynamicParams = false;

const SITE = "https://margaya.app";

type Params = { category: string };

export function generateStaticParams(): Params[] {
  return getUsedCategories().map((category) => ({ category: category.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { category: slug } = await params;
  const category = categories[slug];
  if (!category) return {};

  return {
    title: `${category.name} | Blog`,
    description: category.description,
    alternates: {
      canonical: blogCategoryPath(category.slug),
      types: { "application/rss+xml": `${SITE}/blog/rss.xml` },
    },
    openGraph: {
      type: "website",
      title: `${category.name} | Margaya blog`,
      description: category.description,
      url: `${SITE}${blogCategoryPath(category.slug)}`,
    },
  };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { category: slug } = await params;
  const category = categories[slug];
  if (!category) notFound();

  const posts = getPostsByCategory(category.slug);

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Margaya", path: "/" },
          { name: "Blog", path: "/blog" },
          { name: category.name, path: blogCategoryPath(category.slug) },
        ])}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: `${category.name}, Margaya blog`,
          description: category.description,
          url: `${SITE}${blogCategoryPath(category.slug)}`,
          inLanguage: "en",
          mainEntity: {
            "@type": "ItemList",
            itemListElement: posts.map((post, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: post.title,
              url: `${SITE}${blogPath(post.slug)}`,
            })),
          },
        }}
      />
      <Navbar />
      <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <BlogIndex
          activeSlug={category.slug}
          categories={getUsedCategories()}
          counts={getCategoryCounts()}
          description={category.description}
          eyebrow="Blog"
          posts={posts}
          title={category.name}
        />
      </main>
      <Footer />
    </>
  );
}

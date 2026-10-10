import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogPostPage } from "@/components/landing/blog-post-page";
import { blogPath, getPost, getPosts, getRelatedPosts } from "@/lib/blog";

// `output: "export"` can only serve the generated params; anything else is a 404.
export const dynamicParams = false;

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return getPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};

  const url = `https://margaya.app${blogPath(post.slug)}`;

  return {
    title: post.title,
    description: post.description,
    authors: [{ name: post.author.name, url: post.author.url }],
    alternates: {
      canonical: blogPath(post.slug),
      types: { "application/rss+xml": "https://margaya.app/blog/rss.xml" },
    },
    openGraph: {
      type: "article",
      title: `${post.title} | Margaya`,
      description: post.description,
      url,
      publishedTime: post.date,
      modifiedTime: post.updatedOn ?? post.date,
      authors: [post.author.name],
      section: post.category.name,
      images: [{ url: post.image, width: 1200, height: 630, alt: post.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [post.image],
    },
  };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  return <BlogPostPage post={post} related={getRelatedPosts(post.slug)} />;
}

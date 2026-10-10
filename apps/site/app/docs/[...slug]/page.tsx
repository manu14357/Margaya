import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { DocsPageView, docMetadata } from "@/components/docs/docs-page";
import {
  getAllDocPages,
  getDocPageBySlug,
  getDocsRedirects,
} from "@/lib/docs/source";

// `output: "export"` can only serve the generated params; anything else is a 404.
export const dynamicParams = false;

type Params = { slug: string[] };

export function generateStaticParams(): Params[] {
  const pages = getAllDocPages()
    .filter((page) => page.href !== "/docs")
    .map((page) => ({ slug: page.href.replace(/^\/docs\//, "").split("/") }));
  const redirects = getDocsRedirects().map((redirect) => ({
    slug: redirect.slug,
  }));
  return [...pages, ...redirects];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = getDocPageBySlug(slug);
  return page ? docMetadata(page) : {};
}

export default async function DocsPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const page = getDocPageBySlug(slug);
  if (!page) {
    const redirect = getDocsRedirects().find(
      (entry) => entry.slug.join("/") === slug.join("/"),
    );
    if (redirect) permanentRedirect(redirect.href);
    notFound();
  }
  return <DocsPageView page={page} />;
}

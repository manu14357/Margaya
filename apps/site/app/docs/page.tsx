import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsPageView, docMetadata } from "@/components/docs/docs-page";
import { getDocPageBySlug } from "@/lib/docs/source";

export function generateMetadata(): Metadata {
  const page = getDocPageBySlug([]);
  return page ? docMetadata(page) : {};
}

export default function DocsIndexPage() {
  const page = getDocPageBySlug([]);
  if (!page) notFound();
  return <DocsPageView page={page} />;
}

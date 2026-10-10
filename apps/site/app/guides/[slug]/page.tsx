import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuidePage } from "@/components/landing/guide-page";
import { guideList, guidePath, guides } from "@/lib/guides";

// `output: "export"` can only serve the generated params; anything else is a 404.
export const dynamicParams = false;

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return guideList.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = guides[slug];
  if (!data) return {};

  return {
    title: data.title,
    description: data.description,
    alternates: { canonical: guidePath(data.slug) },
    openGraph: {
      type: "article",
      title: `${data.title} | Margaya`,
      description: data.description,
      url: `https://margaya.app${guidePath(data.slug)}`,
      modifiedTime: data.updatedOn,
      section: "Guides",
    },
    twitter: {
      card: "summary_large_image",
      title: data.title,
      description: data.description,
    },
  };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const data = guides[slug];
  if (!data) notFound();

  return <GuidePage data={data} />;
}

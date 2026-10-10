import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ComparisonPage } from "@/components/compare/comparison-page";
import {
  alternativePath,
  comparisonList,
  comparisons,
} from "@/lib/comparisons";

// `output: "export"` can only serve the generated params; anything else is a 404.
export const dynamicParams = false;

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return comparisonList.map((comparison) => ({
    slug: `${comparison.slug}-alternative`,
  }));
}

function lookup(slug: string) {
  return comparisons[slug.replace(/-alternative$/, "")];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = lookup(slug);
  if (!data) return {};
  const path = alternativePath(data.slug);

  return {
    title: data.title,
    description: data.description,
    alternates: { canonical: path },
    openGraph: {
      type: "article",
      siteName: "Margaya",
      title: `${data.title} | Margaya`,
      description: data.description,
      url: `https://margaya.app${path}`,
      images: [
        { url: "/og-image.png", width: 1200, height: 630, alt: "Margaya" },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${data.title} | Margaya`,
      description: data.description,
      images: ["/og-image.png"],
    },
  };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const data = lookup(slug);
  if (!data) notFound();

  return <ComparisonPage data={data} />;
}

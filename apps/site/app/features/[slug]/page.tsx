import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FeaturePageBody } from "@/components/features/feature-page";
import { Footer } from "@/components/landing/footer";
import { breadcrumbJsonLd, JsonLd } from "@/components/landing/json-ld";
import { Navbar } from "@/components/landing/navbar";
import { SiteLandingProviders } from "@/components/landing/site-landing";
import {
  featurePath,
  featureSlugs,
  getFeaturePage,
  isFeatureSlug,
} from "@/lib/features";

// `output: "export"` can only serve the generated params; anything else is a 404.
export const dynamicParams = false;

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return featureSlugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isFeatureSlug(slug)) return {};
  const { copy } = getFeaturePage(slug);
  const path = featurePath(slug);

  return {
    title: copy.metaTitle,
    description: copy.metaDescription,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "Margaya",
      title: `${copy.metaTitle} | Margaya`,
      description: copy.metaDescription,
      url: `https://margaya.app${path}`,
      images: [
        { url: "/og-image.png", width: 1200, height: 630, alt: "Margaya" },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${copy.metaTitle} | Margaya`,
      description: copy.metaDescription,
      images: ["/og-image.png"],
    },
  };
}

export default async function FeaturePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  if (!isFeatureSlug(slug)) notFound();
  const { copy } = getFeaturePage(slug);

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Margaya", path: "/" },
          { name: copy.eyebrow, path: featurePath(slug) },
        ])}
      />
      <Navbar localized />
      <SiteLandingProviders localized>
        <FeaturePageBody slug={slug} />
      </SiteLandingProviders>
      <Footer localized />
    </>
  );
}

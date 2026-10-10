export const dynamic = "force-static";

// /docs/sitemap.xml is served by app/docs/sitemap.xml/route.ts.

const SITE = "https://margaya.app";

export function GET() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${SITE}/sitemap-pages.xml</loc></sitemap>
  <sitemap><loc>${SITE}/docs/sitemap.xml</loc></sitemap>
</sitemapindex>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}

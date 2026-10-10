import { getAllDocPages } from "@/lib/docs/source";

export const dynamic = "force-static";

const SITE = "https://margaya.app";

export function GET() {
  const lastmod = new Date().toISOString();
  const urls = getAllDocPages()
    .map((page) => {
      const priority =
        page.href === "/docs" ? "0.8" : page.openapi ? "0.4" : "0.6";
      return `  <url>
    <loc>${SITE}${page.href}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}

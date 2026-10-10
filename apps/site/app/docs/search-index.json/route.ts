import { buildDocsSearchIndex } from "@/lib/docs/search";

export const dynamic = "force-static";

export function GET() {
  return Response.json(buildDocsSearchIndex(), {
    headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" },
  });
}

import { docPageMarkdown } from "@/lib/docs/page-markdown";
import { getAllDocPages } from "@/lib/docs/source";

export const dynamic = "force-static";
// `output: "export"` writes only the generated params; anything else is a 404.
export const dynamicParams = false;

type Params = { slug: string[] };

/** One Markdown copy per page: /docs/md/core/cycles.md. */
export function generateStaticParams(): Params[] {
  return getAllDocPages().map((page) => ({
    slug: `${page.id}.md`.split("/"),
  }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<Params> },
) {
  const { slug } = await params;
  const id = slug.join("/").replace(/\.md$/, "");
  const page = getAllDocPages().find((entry) => entry.id === id);
  if (!page) return new Response("Not found", { status: 404 });
  return new Response(docPageMarkdown(page), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}

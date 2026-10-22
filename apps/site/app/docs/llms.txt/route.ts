import { docMarkdownHref } from "@/lib/docs/page-markdown";
import { getDocsTabs, navGroupPages } from "@/lib/docs/source";

export const dynamic = "force-static";

const SITE = "https://margaya.app";

/** The docs as an llms.txt index of Markdown pages, in sidebar order. */
export function GET() {
  const sections = getDocsTabs().flatMap((tab) =>
    tab.groups.map((group) => {
      const links = navGroupPages(group)
        .map((item) => `- [${item.label}](${SITE}${docMarkdownHref(item)})`)
        .join("\n");
      return `## ${tab.tab}: ${group.group}\n\n${links}`;
    }),
  );
  const body = `# Margaya Docs

> Guides and API reference for Margaya, the open-source project management platform. Every page is also available as Markdown.

${sections.join("\n\n")}
`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}

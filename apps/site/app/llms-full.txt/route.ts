import {
  guideList,
  guidePath,
  guideMarkdown as renderGuide,
} from "@/lib/guides";

export const dynamic = "force-static";

const SITE = "https://margaya.app";

function guideMarkdown() {
  return guideList
    .map((guide) => {
      return `## ${guide.question}

URL: ${SITE}${guidePath(guide.slug)}
Last updated: ${guide.updatedOn}

${renderGuide(guide)}`;
    })
    .join("\n\n---\n\n");
}

export function GET() {
  const body = `# Margaya, full content

> Margaya is an open-source, self-hostable project management platform under the MIT license. This file contains the full text of Margaya's guides, written by the Margaya team.

# Guides

${guideMarkdown()}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}

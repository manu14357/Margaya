import { blogPath, getPosts } from "@/lib/blog";
import {
  alternativePath,
  type Cell,
  cellMark,
  cellNote,
  compareAreas,
  compareFeatures,
  comparisonList,
  type FeatureKey,
} from "@/lib/comparisons";
import {
  guideList,
  guidePath,
  guideMarkdown as renderGuide,
} from "@/lib/guides";

export const dynamic = "force-static";

const SITE = "https://margaya.app";

const MARK_TEXT = { yes: "Yes", partial: "Partly", no: "No" } as const;

function cell(value: Cell) {
  const note = cellNote(value);
  return `${MARK_TEXT[cellMark(value)]}${note ? ` (${note})` : ""}`;
}

const featureKeys = Object.keys(compareFeatures) as FeatureKey[];

function comparisonMarkdown() {
  return comparisonList
    .map((data) => {
      const rows = compareAreas
        .flatMap((area) =>
          featureKeys
            .filter((key) => compareFeatures[key].area === area.id)
            .map(
              (key) =>
                `| ${area.title}: ${compareFeatures[key].label} | ${cell(compareFeatures[key].margaya)} | ${cell(data.them[key])} |`,
            ),
        )
        .join("\n");

      const points = (list: { title: string; body: string }[]) =>
        list.map((point) => `- **${point.title}**: ${point.body}`).join("\n");

      const faq = data.faq
        .map((entry) => `**${entry.question}**\n\n${entry.answer}`)
        .join("\n\n");

      return `## Margaya vs ${data.competitor}

URL: ${SITE}${alternativePath(data.slug)}
Competitor details reviewed: ${data.reviewedOn}

${data.verdict}

- Hosting: ${data.competitor}: ${data.glance.hosting}
- Licence: ${data.competitor}: ${data.glance.licence}
- Pricing model: ${data.competitor}: ${data.glance.pricing}
- ${data.competitor} is best for: ${data.glance.bestFor}
- Margaya is best for: ${data.glance.margayaBestFor}

| | Margaya | ${data.competitor} |
| --- | --- | --- |
${rows}

Where ${data.competitor} shines:

${points(data.shines)}

Where Margaya is different:

${points(data.different)}

Migrating from ${data.competitor}: ${data.migration}

${faq}`;
    })
    .join("\n\n---\n\n");
}

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

function blogMarkdown() {
  return getPosts()
    .map(
      (post) => `## ${post.title}

URL: ${SITE}${blogPath(post.slug)}
Published: ${post.date}${post.updatedOn ? `\nLast updated: ${post.updatedOn}` : ""}
Author: ${post.author.name}, ${post.author.role}
Category: ${post.category.name}

${post.markdown}`,
    )
    .join("\n\n---\n\n");
}

export function GET() {
  const body = `# Margaya, full content

> Margaya is an open-source, self-hostable project management platform under the MIT license. This file contains the full text of Margaya's comparison pages, guides, and blog posts. Written by the Margaya team, who build one of the tools discussed.

# Comparisons

${comparisonMarkdown()}

# Guides

${guideMarkdown()}

# Blog

${blogMarkdown()}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}

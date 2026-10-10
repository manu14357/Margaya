import type { Guide, GuideCallout } from "./types";

function callout(value: GuideCallout) {
  return `> **${value.title}.** ${value.body}`;
}

/**
 * A guide as plain Markdown, for llms-full.txt. Keeps the step numbering the
 * page shows, so a quoted "step 4" means the same thing in both places.
 */
export function guideMarkdown(guide: Guide) {
  let step = 0;

  const sections = guide.sections.map((section) => {
    const parts: string[] = [`### ${section.heading}`];
    if (section.body) parts.push(...section.body);
    if (section.items) {
      parts.push(
        section.items
          .map(
            (item) =>
              `- **${item.name}**${item.meta ? ` (${item.meta})` : ""}: ${item.body}`,
          )
          .join("\n"),
      );
    }
    if (section.callout) parts.push(callout(section.callout));

    for (const entry of section.steps ?? []) {
      step += 1;
      parts.push(`#### Step ${step}: ${entry.title}`, ...entry.body);
      if (entry.bullets) {
        parts.push(entry.bullets.map((bullet) => `- ${bullet}`).join("\n"));
      }
      if (entry.code) {
        parts.push(
          `${entry.code.label}:\n\n\`\`\`\n${entry.code.content}\n\`\`\``,
        );
      }
      if (entry.callout) parts.push(callout(entry.callout));
    }

    return parts.join("\n\n");
  });

  const before = guide.before?.length
    ? `Before you start:\n\n${guide.before.map((line) => `- ${line}`).join("\n")}`
    : "";

  const faq = guide.faq
    .map((entry) => `**${entry.question}**\n\n${entry.answer}`)
    .join("\n\n");

  return [guide.answer, before, ...sections, faq].filter(Boolean).join("\n\n");
}

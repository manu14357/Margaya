import type { TFunction } from "i18next";
import type { CaptureProposal } from "@/fetchers/ai/capture";

/**
 * A proposal as an editable Markdown description, with section headings in
 * the reader's language: summary, steps to reproduce, expected, actual and
 * environment (each only when present).
 */
export function captureDescription(
  item: Pick<
    CaptureProposal,
    "summary" | "steps" | "expected" | "actual" | "environment"
  >,
  t: TFunction,
): string {
  const sections: string[] = [];
  if (item.summary.trim()) sections.push(item.summary.trim());
  if (item.steps.length > 0) {
    sections.push(
      `**${t("ai:capture.sections.steps")}**\n${item.steps
        .map((step, index) => `${index + 1}. ${step}`)
        .join("\n")}`,
    );
  }
  if (item.expected) {
    sections.push(`**${t("ai:capture.sections.expected")}**\n${item.expected}`);
  }
  if (item.actual) {
    sections.push(`**${t("ai:capture.sections.actual")}**\n${item.actual}`);
  }
  if (item.environment) {
    sections.push(
      `**${t("ai:capture.sections.environment")}**\n${item.environment}`,
    );
  }
  return sections.join("\n\n");
}

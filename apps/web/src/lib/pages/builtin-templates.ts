import type { TFunction } from "i18next";
import {
  CalendarDays,
  FileText,
  type LucideIcon,
  RefreshCw,
} from "lucide-react";

// Starter templates that ship with Margaya. Their headings come from the
// reader's language, so a new page reads naturally; the markdown is copied
// into the page like a saved template's.

export type BuiltinTemplate = {
  id: "meeting" | "spec" | "retro";
  icon: LucideIcon;
  name: string;
  description: string;
  markdown: string;
};

/** "## heading" sections, each followed by its starter line (a bullet...). */
function sections(parts: Array<[heading: string, starter: string]>): string {
  return parts
    .map(([heading, starter]) =>
      starter ? `## ${heading}\n\n${starter}` : `## ${heading}`,
    )
    .join("\n\n");
}

export function builtinTemplates(t: TFunction): BuiltinTemplate[] {
  return [
    {
      id: "meeting",
      icon: CalendarDays,
      name: t("pages:templates.builtin.meetingName"),
      description: t("pages:templates.builtin.meetingDescription"),
      markdown: sections([
        [t("pages:templates.builtin.meetingAttendees"), "-"],
        [t("pages:templates.builtin.meetingAgenda"), "1."],
        [t("pages:templates.builtin.meetingNotes"), ""],
        [t("pages:templates.builtin.meetingDecisions"), "-"],
        [t("pages:templates.builtin.meetingActionItems"), "-"],
      ]),
    },
    {
      id: "spec",
      icon: FileText,
      name: t("pages:templates.builtin.specName"),
      description: t("pages:templates.builtin.specDescription"),
      markdown: sections([
        [t("pages:templates.builtin.specSummary"), ""],
        [t("pages:templates.builtin.specProblem"), ""],
        [t("pages:templates.builtin.specGoals"), "-"],
        [t("pages:templates.builtin.specNonGoals"), "-"],
        [t("pages:templates.builtin.specProposal"), ""],
        [t("pages:templates.builtin.specOpenQuestions"), "-"],
      ]),
    },
    {
      id: "retro",
      icon: RefreshCw,
      name: t("pages:templates.builtin.retroName"),
      description: t("pages:templates.builtin.retroDescription"),
      markdown: sections([
        [t("pages:templates.builtin.retroWentWell"), "-"],
        [t("pages:templates.builtin.retroCouldBeBetter"), "-"],
        [t("pages:templates.builtin.retroTryNext"), "-"],
      ]),
    },
  ];
}

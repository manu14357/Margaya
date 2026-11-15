import {
  BOARD_TEMPLATE_IDS,
  type BoardElement,
  TEMPLATE_LABEL_KEYS,
  templateElements,
} from "@margaya/whiteboard";
import type { TFunction } from "i18next";
import {
  CalendarRange,
  Columns3,
  GitBranch,
  Lightbulb,
  type LucideIcon,
  Map as MapIcon,
  RefreshCcw,
  Square,
  Target,
} from "lucide-react";

export type WhiteboardTemplateId = (typeof BOARD_TEMPLATE_IDS)[number];

type TemplateCopy = {
  icon: LucideIcon;
  nameKey: string;
  descriptionKey: string;
};

// Static keys, so the i18n report sees every template's name and summary.
const TEMPLATE_COPY: Record<WhiteboardTemplateId, TemplateCopy> = {
  blank: {
    icon: Square,
    nameKey: "whiteboards:templates.names.blank",
    descriptionKey: "whiteboards:templates.descriptions.blank",
  },
  brainstorm: {
    icon: Lightbulb,
    nameKey: "whiteboards:templates.names.brainstorm",
    descriptionKey: "whiteboards:templates.descriptions.brainstorm",
  },
  retrospective: {
    icon: RefreshCcw,
    nameKey: "whiteboards:templates.names.retrospective",
    descriptionKey: "whiteboards:templates.descriptions.retrospective",
  },
  "sprint-planning": {
    icon: Target,
    nameKey: "whiteboards:templates.names.sprintPlanning",
    descriptionKey: "whiteboards:templates.descriptions.sprintPlanning",
  },
  "user-story-map": {
    icon: MapIcon,
    nameKey: "whiteboards:templates.names.userStoryMap",
    descriptionKey: "whiteboards:templates.descriptions.userStoryMap",
  },
  roadmap: {
    icon: CalendarRange,
    nameKey: "whiteboards:templates.names.roadmap",
    descriptionKey: "whiteboards:templates.descriptions.roadmap",
  },
  flowchart: {
    icon: GitBranch,
    nameKey: "whiteboards:templates.names.flowchart",
    descriptionKey: "whiteboards:templates.descriptions.flowchart",
  },
  kanban: {
    icon: Columns3,
    nameKey: "whiteboards:templates.names.kanban",
    descriptionKey: "whiteboards:templates.descriptions.kanban",
  },
};

export type WhiteboardTemplate = TemplateCopy & { id: WhiteboardTemplateId };

/** Every template in the package's order, blank first. */
export const WHITEBOARD_TEMPLATES: readonly WhiteboardTemplate[] =
  BOARD_TEMPLATE_IDS.map((id) => ({ id, ...TEMPLATE_COPY[id] }));

/** The translation key of a template label (`retrospective.wentWell`). */
export function templateLabelKey(labelKey: string): string {
  return `whiteboards:templates.labels.${labelKey}`;
}

/**
 * A template's starting elements with the labels in the viewer's language.
 * Blank has none, so a blank board is created without elements.
 */
export function buildTemplateElements(
  id: WhiteboardTemplateId,
  t: TFunction,
): BoardElement[] {
  if (id === "blank") return [];
  const labels: Record<string, string> = {};
  for (const key of TEMPLATE_LABEL_KEYS[id] ?? []) {
    labels[key] = t(templateLabelKey(key));
  }
  return templateElements(id, labels);
}

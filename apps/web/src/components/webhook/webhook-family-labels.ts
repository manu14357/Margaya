import { useCallback } from "react";
import { useTranslation } from "react-i18next";

// Static i18n keys per catalog family. A family the web build doesn't know
// yet (a newer API) falls back to its key, which is an identifier.

const FAMILY_LABEL_KEYS = {
  project: {
    label: "settings:workspaceWebhooks.families.project.label",
    description: "settings:workspaceWebhooks.families.project.description",
  },
  column: {
    label: "settings:workspaceWebhooks.families.column.label",
    description: "settings:workspaceWebhooks.families.column.description",
  },
  task: {
    label: "settings:workspaceWebhooks.families.task.label",
    description: "settings:workspaceWebhooks.families.task.description",
  },
  comment: {
    label: "settings:workspaceWebhooks.families.comment.label",
    description: "settings:workspaceWebhooks.families.comment.description",
  },
  reaction: {
    label: "settings:workspaceWebhooks.families.reaction.label",
    description: "settings:workspaceWebhooks.families.reaction.description",
  },
  time_entry: {
    label: "settings:workspaceWebhooks.families.time_entry.label",
    description: "settings:workspaceWebhooks.families.time_entry.description",
  },
  cycle: {
    label: "settings:workspaceWebhooks.families.cycle.label",
    description: "settings:workspaceWebhooks.families.cycle.description",
  },
  module: {
    label: "settings:workspaceWebhooks.families.module.label",
    description: "settings:workspaceWebhooks.families.module.description",
  },
  page: {
    label: "settings:workspaceWebhooks.families.page.label",
    description: "settings:workspaceWebhooks.families.page.description",
  },
  view: {
    label: "settings:workspaceWebhooks.families.view.label",
    description: "settings:workspaceWebhooks.families.view.description",
  },
  intake: {
    label: "settings:workspaceWebhooks.families.intake.label",
    description: "settings:workspaceWebhooks.families.intake.description",
  },
  estimate: {
    label: "settings:workspaceWebhooks.families.estimate.label",
    description: "settings:workspaceWebhooks.families.estimate.description",
  },
} as const;

type FamilyKey = keyof typeof FAMILY_LABEL_KEYS;

/** Translates a family's label and description, or shows its raw key. */
export function useFamilyText() {
  const { t } = useTranslation();
  return useCallback(
    (family: string) => {
      if (!Object.hasOwn(FAMILY_LABEL_KEYS, family)) {
        return { label: family, description: "" };
      }
      const keys = FAMILY_LABEL_KEYS[family as FamilyKey];
      return { label: t(keys.label), description: t(keys.description) };
    },
    [t],
  );
}

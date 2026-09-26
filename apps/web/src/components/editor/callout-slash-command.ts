import type { TFunction } from "i18next";
import type { SlashCommand } from "./use-slash-menu";

/** "/callout": wraps the current block in an info callout. */
export function calloutSlashCommand(t: TFunction): SlashCommand {
  return {
    id: "callout",
    label: t("tasks:detail.editor.slash.commands.callout"),
    group: "insert",
    search: "callout note info warning tip success danger alert admonition",
    run: (editor, range) => {
      const wrapped = editor
        .chain()
        .focus()
        .deleteRange(range)
        .setCallout()
        .run();
      // Where the block can't be wrapped (inside a table cell, say), a new
      // callout goes in at the cursor instead.
      if (!wrapped) {
        editor
          .chain()
          .focus()
          .insertContent({ type: "callout", content: [{ type: "paragraph" }] })
          .run();
      }
    },
  };
}

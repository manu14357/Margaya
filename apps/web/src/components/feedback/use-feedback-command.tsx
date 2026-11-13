import { MessageSquareHeart } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { PaletteActionItem } from "@/components/command-palette/palette-types";
import { openFeedbackDialog } from "./feedback-dialog-store";
import { useFeedbackAvailable } from "./feedback-host";

/** "Send feedback" in the command palette, while the instance has it on. */
export function useFeedbackCommand(): PaletteActionItem[] {
  const { t } = useTranslation();
  const available = useFeedbackAvailable();
  return useMemo(
    () =>
      available
        ? [
            {
              value: "send-feedback",
              label: t("settings:feedback.send.menuItem"),
              icon: (
                <MessageSquareHeart aria-hidden className="size-4 opacity-72" />
              ),
              // The dialog opens once the palette has closed, so focus
              // lands in it rather than back on the page.
              afterClose: true,
              onRun: openFeedbackDialog,
            },
          ]
        : [],
    [available, t],
  );
}

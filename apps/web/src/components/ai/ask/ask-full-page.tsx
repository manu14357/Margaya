import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/components/common/layout";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { useAskPanel } from "./ask-store";

/**
 * The full-page AI chat (/dashboard/workspace/$workspaceId/ai). It gives
 * the one mounted Ask panel a place to render at full width, with history
 * on the left, so the conversation carries over from the docked window.
 */
export function AskFullPage() {
  const { t } = useTranslation();
  const setSlot = useAskPanel((state) => state.setSlot);
  const setOpen = useAskPanel((state) => state.setOpen);
  const { available, isLoading } = useAiAvailability();
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!element) return;
    // The docked window closes: the chat now lives on this page.
    setOpen(false);
    setSlot(element);
    return () => setSlot(null);
  }, [element, setSlot, setOpen]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {!available && !isLoading ? (
        // Without the chat's own header the page still needs a top row: the
        // desktop app's title bar (drag area, room for the window buttons).
        <Layout.TopBar title={t("ai:ask.title")} />
      ) : (
        <h1 className="sr-only">{t("ai:ask.title")}</h1>
      )}
      {!available && !isLoading && (
        <p className="m-auto max-w-sm px-6 text-center text-muted-foreground text-sm">
          {t("ai:ask.fullPageUnavailable")}
        </p>
      )}
      <div ref={setElement} className="flex min-h-0 flex-1" />
    </div>
  );
}

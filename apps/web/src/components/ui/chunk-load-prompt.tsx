import { RefreshCw } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  hasChunkLoadFailed,
  subscribeToChunkLoadFailure,
} from "@/lib/chunk-load";
import { Button } from "./button";

/**
 * Asks for a reload once a chunk the whole app needs (its translations)
 * failed for good. The fallbacks are English because what failed may be the
 * translations themselves; every other language reads its own keys.
 */
export function ChunkLoadPrompt() {
  const failed = useSyncExternalStore(
    subscribeToChunkLoadFailure,
    hasChunkLoadFailed,
    () => false,
  );
  const { t } = useTranslation("common", { useSuspense: false });
  if (!failed) return null;

  return (
    <div
      className="fixed inset-x-4 bottom-4 z-[100] mx-auto flex max-w-md items-center gap-3 rounded-lg border bg-popover p-3 text-popover-foreground text-sm shadow-lg"
      data-slot="chunk-load-prompt"
      role="alert"
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {t("states.loadFailed.title", {
            defaultValue: "Part of Margaya didn't load",
          })}
        </p>
        <p className="text-muted-foreground text-xs">
          {t("states.loadFailed.description", {
            defaultValue:
              "The connection dropped while the app was loading. Reload the page to finish loading. Your saved work is safe.",
          })}
        </p>
      </div>
      <Button onClick={() => window.location.reload()} size="sm">
        <RefreshCw />
        {t("states.error.reload", { defaultValue: "Reload" })}
      </Button>
    </div>
  );
}

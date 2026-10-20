import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { openAsk } from "./ask-store";
import { useAskAvailability, useRouteProjectId } from "./use-ask-availability";

/** The top bar's small sparkle that opens Ask. Hidden while AI is off. */
export function AskButton() {
  const { t } = useTranslation();
  const routeProjectId = useRouteProjectId();
  const { available, projectId } = useAskAvailability(routeProjectId);
  if (!available) return null;
  const label = t("ai:ask.title");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={() => openAsk({ projectId })}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-hidden hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            data-slot="ask-button"
          />
        }
      >
        <Sparkles aria-hidden className="size-4" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

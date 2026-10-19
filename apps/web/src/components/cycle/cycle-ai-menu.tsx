import { Megaphone, MessagesSquare, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AiSummaryPanel } from "@/components/ai/ai-summary";
import { BriefCard } from "@/components/ai/brief/brief-button";
import RetroButton, {
  RetroCard,
  useCanRetro,
} from "@/components/insight/retro-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import type { Cycle } from "@/types/cycle";

type CycleAiMenuProps = {
  cycle: Cycle;
  workspaceId: string;
};

type Action = "summary" | "retro" | "brief";

/**
 * The cycle header's Summarize, Retro and Brief behind one "AI" button, for
 * top bars too narrow to show them side by side. The chosen card stays open
 * after the menu closes.
 */
export default function CycleAiMenu({ cycle, workspaceId }: CycleAiMenuProps) {
  const { t } = useTranslation();
  const { available } = useAiAvailability(cycle.projectId);
  const canRetro = useCanRetro(cycle);
  const [active, setActive] = useState<Action | null>(null);

  // Retro works without AI; alone it needs no menu.
  if (!available) {
    return canRetro ? (
      <RetroButton cycle={cycle} workspaceId={workspaceId} />
    ) : null;
  }

  const close = () => setActive(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="gap-1"
              aria-label={t("ai:writing.menuLabel")}
              title={t("ai:writing.menuLabel")}
            />
          }
        >
          <Sparkles className="size-3 text-muted-foreground" />
          {t("ai:writing.aiButton")}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={() => setActive("summary")}>
            <Sparkles />
            {t("ai:writing.summary.cycle")}
          </DropdownMenuItem>
          {canRetro && (
            <DropdownMenuItem onClick={() => setActive("retro")}>
              <MessagesSquare />
              {t("insight:retro.buttonLabel")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setActive("brief")}>
            <Megaphone />
            {t("ai:brief.buttonLabel")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {active === "summary" && (
        <AiSummaryPanel
          kind="cycle"
          id={cycle.id}
          projectId={cycle.projectId}
          workspaceId={workspaceId}
          name={cycle.name}
          onClose={close}
        />
      )}
      {active === "retro" && (
        <RetroCard cycle={cycle} workspaceId={workspaceId} onClose={close} />
      )}
      {active === "brief" && (
        <BriefCard
          scopeType="cycle"
          scopeId={cycle.id}
          projectId={cycle.projectId}
          workspaceId={workspaceId}
          name={cycle.name}
          onClose={close}
        />
      )}
    </>
  );
}

import { useNavigate } from "@tanstack/react-router";
import { Maximize2, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { PaletteActionItem } from "@/components/command-palette/palette-types";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { openAsk } from "./ask-store";
import { useAskAvailability } from "./use-ask-availability";

/**
 * The palette's Ask commands: "Ask AI…" and "Open AI chat (full page)"
 * among the suggestions, and with text typed, "Ask AI: <text>" that asks it
 * right away. None while AI is off here.
 */
export function useAskCommands({
  projectId,
  term,
}: {
  projectId: string | undefined;
  term: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { available, projectId: scope } = useAskAvailability(projectId ?? null);
  const question = term.trim();
  return useMemo(() => {
    if (!available) return { items: [], askItems: [] };
    const icon = <Sparkles aria-hidden className="size-4 opacity-72" />;
    const items: PaletteActionItem[] = [
      {
        value: "ask-ai",
        label: t("ai:ask.palette"),
        icon,
        afterClose: true,
        onRun: () => openAsk({ projectId: scope }),
      },
      ...(workspaceId
        ? [
            {
              value: "ask-ai-full-page",
              label: t("ai:ask.paletteFullPage"),
              icon: <Maximize2 aria-hidden className="size-4 opacity-72" />,
              afterClose: true,
              onRun: () =>
                navigate({
                  to: "/dashboard/workspace/$workspaceId/ai",
                  params: { workspaceId },
                }),
            },
          ]
        : []),
    ];
    const askItems: PaletteActionItem[] =
      question.length >= 2
        ? [
            {
              value: `ask-ai:${question}`,
              label: t("ai:ask.paletteAbout", { question }),
              icon,
              afterClose: true,
              onRun: () => openAsk({ projectId: scope, question }),
            },
          ]
        : [];
    return { items, askItems };
  }, [available, scope, question, t, navigate, workspaceId]);
}

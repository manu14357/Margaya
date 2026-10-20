import { Sparkles } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PaletteActionItem } from "@/components/command-palette/palette-types";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import useBuildWithAiStore from "@/store/build-with-ai";

// Loaded on first use, so the palette stays light for everyone else.
const BuildWithAiDialog = lazy(() => import("./build-with-ai-dialog"));

/**
 * The palette's "Build with AI…" command and the dialog it opens (also
 * opened from an empty project). No command while AI is unavailable or the
 * person can create neither projects nor tasks.
 */
export function useBuildWithAiCommand(projectId: string | undefined) {
  const { t } = useTranslation();
  const { available } = useAiAvailability(projectId ?? null);
  const { canCreateProjects, canCreateTasks, isCheckingPermissions } =
    useWorkspacePermission();
  const openBuild = useBuildWithAiStore((state) => state.openBuild);
  const canBuild =
    available &&
    !isCheckingPermissions &&
    (canCreateProjects() || (Boolean(projectId) && canCreateTasks()));

  const items = useMemo<PaletteActionItem[]>(
    () =>
      canBuild
        ? [
            {
              value: "build-with-ai",
              label: t("ai:build.command"),
              icon: <Sparkles aria-hidden className="size-4 opacity-72" />,
              onRun: () => openBuild(projectId ?? null),
            },
          ]
        : [],
    [canBuild, t, openBuild, projectId],
  );

  // Mounted from the first opening on, so closing still animates.
  const open = useBuildWithAiStore((state) => state.open);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  return {
    items,
    dialog: mounted ? (
      <Suspense fallback={null}>
        <BuildWithAiDialog />
      </Suspense>
    ) : null,
  };
}

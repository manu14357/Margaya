import { useLocation } from "@tanstack/react-router";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";

/** The project in the current path, if any. */
export function useRouteProjectId(): string | null {
  const pathname = useLocation({ select: (location) => location.pathname });
  return pathname.match(/\/project\/([^/]+)/)?.[1] ?? null;
}

/**
 * Whether Ask shows here, and the project it starts scoped to: the route's
 * project when AI is on there, else the whole workspace. Hidden while AI is
 * off, loading, or the person lacks ai:use.
 */
export function useAskAvailability(routeProjectId: string | null) {
  const workspace = useAiAvailability();
  const project = useAiAvailability(routeProjectId);
  return {
    available: workspace.available,
    projectId: routeProjectId && project.available ? routeProjectId : null,
  };
}

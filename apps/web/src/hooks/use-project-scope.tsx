import { useParams } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext } from "react";

// The project a screen acts in, so capability checks and pickers follow that
// project's role and people. Project routes set it from the URL; a task sheet
// or preview sets it to its task's project. Null outside a project.
const ProjectScopeContext = createContext<string | null>(null);

export function ProjectScope({
  projectId,
  children,
}: {
  projectId: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <ProjectScopeContext.Provider value={projectId || null}>
      {children}
    </ProjectScopeContext.Provider>
  );
}

/** The scope of the route's `$projectId`, when it has one. */
export function RouteProjectScope({ children }: { children: ReactNode }) {
  const projectId = useParams({
    strict: false,
    select: (params) => (params as { projectId?: string }).projectId,
  });
  return <ProjectScope projectId={projectId}>{children}</ProjectScope>;
}

/** The project the surrounding screen acts in, or null. */
export function useProjectScope(): string | null {
  return useContext(ProjectScopeContext);
}

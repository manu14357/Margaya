import { createContext, type ReactNode, useContext, useMemo } from "react";

type ModuleScope = { moduleId: string; projectId: string };

const ModuleScopeContext = createContext<ModuleScope | null>(null);

/**
 * Marks a subtree as one module's board, so slots (the create-modal picker,
 * card chips, the filter menu, bulk actions) can default to or hide for it
 * without threading props through the board components.
 */
export function ModuleScopeProvider({
  moduleId,
  projectId,
  children,
}: ModuleScope & { children: ReactNode }) {
  const value = useMemo(() => ({ moduleId, projectId }), [moduleId, projectId]);
  return (
    <ModuleScopeContext.Provider value={value}>
      {children}
    </ModuleScopeContext.Provider>
  );
}

/** The enclosing module page's scope, or null outside one. */
export function useModuleScope(): ModuleScope | null {
  return useContext(ModuleScopeContext);
}

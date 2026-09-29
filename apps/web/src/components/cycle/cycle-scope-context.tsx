import { createContext, type ReactNode, useContext, useMemo } from "react";

type CycleScope = { cycleId: string; projectId: string };

const CycleScopeContext = createContext<CycleScope | null>(null);

/**
 * Marks a subtree as the board of one cycle, so slots (the create-modal
 * picker, card chips, the filter menu) can default to or hide for it without
 * threading props through the board components.
 */
export function CycleScopeProvider({
  cycleId,
  projectId,
  children,
}: CycleScope & { children: ReactNode }) {
  const value = useMemo(() => ({ cycleId, projectId }), [cycleId, projectId]);
  return (
    <CycleScopeContext.Provider value={value}>
      {children}
    </CycleScopeContext.Provider>
  );
}

/** The enclosing cycle page's scope, or null outside one. */
export function useCycleScope(): CycleScope | null {
  return useContext(CycleScopeContext);
}

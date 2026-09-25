import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useShell } from "@/components/common/shell-context";

/**
 * Renders page-owned navigation inside the context panel, under the
 * destination's own rows (for example the settings sub-navigation).
 *
 *   <ContextPanelSlot fallback={<InlineNav />}>
 *     <PanelSection label="Workspace">…</PanelSection>
 *   </ContextPanelSlot>
 *
 * While the panel is closed (or shown as a closed drawer) there is no slot,
 * and `fallback` renders in place instead, so the page stays navigable.
 */
export function ContextPanelSlot({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const shell = useShell();
  if (!shell?.panelSlot) return <>{fallback}</>;
  return createPortal(children, shell.panelSlot);
}

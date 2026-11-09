import { lazy, Suspense, useEffect, useState } from "react";
import { onSignOut } from "@/lib/sign-out";
import { clearAllAskHistory } from "./ask-history";
import { useAskPanel } from "./ask-store";

const AskPanel = lazy(() => import("./ask-panel"));

/**
 * The Ask chat in the app layout. Its code (the chat, Build, history and
 * Markdown answers) loads the first time Ask opens, docked or on the
 * full-page route, not with every page. After that it stays mounted, so the
 * conversation carries on exactly as before.
 */
export default function LazyAskPanel() {
  const wanted = useAskPanel((state) => state.open || state.slot !== null);
  const [mounted, setMounted] = useState(wanted);
  if (wanted && !mounted) setMounted(true);

  // The panel clears this browser's saved conversations on sign-out; until
  // it has loaded, this does.
  useEffect(() => {
    if (mounted) return;
    return onSignOut(clearAllAskHistory);
  }, [mounted]);

  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <AskPanel />
    </Suspense>
  );
}

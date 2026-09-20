// "This page was deleted" hints from the project socket, for an open editor
// that is not connected to the page socket (it learns from its own socket
// otherwise).

type Listener = (pageId: string) => void;

const listeners = new Set<Listener>();

export function notifyPageDeleted(pageId: string) {
  for (const listener of listeners) listener(pageId);
}

/** Subscribes; returns the unsubscribe function. */
export function onPageDeleted(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Debounced saves of a task's title and description. They live outside the
// components because an edit outlives them: closing the panel or opening
// another task must neither drop a pending save nor lose a failed one.

type Handlers = {
  send: (value: string) => Promise<unknown>;
  /** Tells the user the save failed. Returns the id of what it showed. */
  notifyFailed: (retry: () => void) => string;
  dismissFailed: (shownId: string) => void;
};

type Edit = Handlers & {
  value: string;
  /** Which edit this is, so a late answer can't settle a newer one. */
  version: number;
  timer: ReturnType<typeof setTimeout> | null;
  shownFailure: string | null;
};

const edits = new Map<string, Edit>();
let lastVersion = 0;

function warnBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "";
}

function clearDelivery(edit: Edit) {
  if (edit.timer) clearTimeout(edit.timer);
  edit.timer = null;
  if (edit.shownFailure) edit.dismissFailed(edit.shownFailure);
  edit.shownFailure = null;
}

function remove(key: string) {
  edits.delete(key);
  if (edits.size === 0) {
    window.removeEventListener("beforeunload", warnBeforeUnload);
  }
}

async function deliver(key: string) {
  const edit = edits.get(key);
  if (!edit) return;
  clearDelivery(edit);
  const { version } = edit;
  try {
    await edit.send(edit.value);
    if (edits.get(key)?.version === version) remove(key);
  } catch (error) {
    console.error(`Failed to save ${key}:`, error);
    const current = edits.get(key);
    if (current?.version !== version) return;
    current.shownFailure = current.notifyFailed(() => void deliver(key));
  }
}

export function taskEditKey(field: "title" | "description", taskId: string) {
  return `task ${field} ${taskId}`;
}

/**
 * Records an edit and saves it after `delayMs`, or right away without one.
 * Until it has saved, the tab warns before closing and `unsavedTaskEdit`
 * returns it. A failed save stays unsaved until a retry or a newer edit.
 */
export function saveTaskEdit(
  key: string,
  value: string,
  handlers: Handlers,
  delayMs?: number,
) {
  const previous = edits.get(key);
  if (previous) clearDelivery(previous);
  if (edits.size === 0) {
    window.addEventListener("beforeunload", warnBeforeUnload);
  }
  edits.set(key, {
    ...handlers,
    value,
    version: ++lastVersion,
    timer:
      delayMs === undefined
        ? null
        : setTimeout(() => void deliver(key), delayMs),
    shownFailure: null,
  });
  if (delayMs === undefined) void deliver(key);
}

/** Forgets an edit the user took back, along with any failure shown for it. */
export function discardTaskEdit(key: string) {
  const edit = edits.get(key);
  if (!edit) return;
  clearDelivery(edit);
  remove(key);
}

/** The text not yet saved: what an editor should show instead of the task's. */
export function unsavedTaskEdit(key: string): string | undefined {
  return edits.get(key)?.value;
}

import {
  type BoardElement,
  createElement,
  deleteElement,
  type StickyElement,
  updateElement,
} from "@margaya/whiteboard";

// Stickies -> tasks. Each sticky becomes a task through the normal task
// create API; then, in one board edit (one undo step), the stickies are
// replaced by live task cards where they stood, and arrows that pointed at a
// sticky point at its card.

export type StickyDraft = {
  stickyId: string;
  title: string;
  /** The sticky's other lines. */
  description: string;
  /** Column slug the task starts in. */
  status: string;
};

export type CreateTaskInput = {
  projectId: string;
  title: string;
  description: string;
  status: string;
  priority: "no-priority";
  assigneeIds: string[];
};

export type ConversionResult = {
  created: { stickyId: string; taskId: string; cardId: string }[];
  failed: { stickyId: string; error: unknown }[];
};

const MAX_TITLE = 500;

/** The first line of a sticky, as a task title. */
export function titleFromSticky(text: string): string {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return (firstLine ?? "").slice(0, MAX_TITLE);
}

/** The rest of the sticky's text, kept as the task description. */
export function descriptionFromSticky(text: string): string {
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim().length > 0);
  if (index < 0) return "";
  return lines
    .slice(index + 1)
    .join("\n")
    .trim();
}

export function draftsFor(
  stickies: readonly StickyElement[],
  status: string,
): StickyDraft[] {
  return stickies.map((sticky) => ({
    stickyId: sticky.id,
    title: titleFromSticky(sticky.text),
    description: descriptionFromSticky(sticky.text),
    status,
  }));
}

/** The board edit that swaps converted stickies for task cards. */
export function replaceStickies(
  elements: readonly BoardElement[],
  created: readonly { sticky: StickyElement; taskId: string }[],
  userId: string | null,
): { writes: BoardElement[]; cards: Map<string, string> } {
  const cards = new Map<string, string>();
  const writes: BoardElement[] = [];
  for (const { sticky, taskId } of created) {
    const card = createElement(
      "task",
      {
        taskId,
        x: sticky.x,
        y: sticky.y,
        width: Math.max(220, sticky.width),
        height: 120,
        angle: sticky.angle,
        order: sticky.order,
        groupIds: sticky.groupIds,
        frameId: sticky.frameId,
        link: sticky.link,
      },
      { userId },
    );
    cards.set(sticky.id, card.id);
    writes.push(deleteElement(sticky, { userId }), card);
  }
  for (const element of elements) {
    if (
      element.deleted ||
      (element.type !== "arrow" && element.type !== "line")
    )
      continue;
    const start =
      element.startBinding && cards.get(element.startBinding.elementId);
    const end = element.endBinding && cards.get(element.endBinding.elementId);
    if (!start && !end) continue;
    writes.push(
      updateElement(
        element,
        {
          startBinding:
            start && element.startBinding
              ? { ...element.startBinding, elementId: start }
              : element.startBinding,
          endBinding:
            end && element.endBinding
              ? { ...element.endBinding, elementId: end }
              : element.endBinding,
        },
        { userId },
      ),
    );
  }
  return { writes, cards };
}

/**
 * Creates one task per draft, in order, and returns which succeeded. Tasks
 * are created one at a time so their numbers follow the board order.
 */
export async function createTasksForDrafts(
  drafts: readonly StickyDraft[],
  projectId: string,
  createTask: (input: CreateTaskInput) => Promise<{ id: string }>,
): Promise<{
  done: { stickyId: string; taskId: string }[];
  failed: ConversionResult["failed"];
}> {
  const done: { stickyId: string; taskId: string }[] = [];
  const failed: ConversionResult["failed"] = [];
  for (const draft of drafts) {
    const title = draft.title.trim();
    if (!title) {
      failed.push({
        stickyId: draft.stickyId,
        error: new Error("empty title"),
      });
      continue;
    }
    try {
      const task = await createTask({
        projectId,
        title,
        description: draft.description,
        status: draft.status,
        priority: "no-priority",
        assigneeIds: [],
      });
      done.push({ stickyId: draft.stickyId, taskId: task.id });
    } catch (error) {
      failed.push({ stickyId: draft.stickyId, error });
    }
  }
  return { done, failed };
}

import {
  type BoardElement,
  parseBoardFile,
  sanitizeElements,
} from "@margaya/whiteboard";

// Board elements travel through the system clipboard as text/plain JSON in a
// small envelope, so they paste between boards, tabs and browsers without a
// custom MIME type (which most browsers refuse to write).

export const CLIPBOARD_TYPE = "margaya-board/clipboard";
export const CLIPBOARD_VERSION = 1;

export type ClipboardEnvelope = {
  type: typeof CLIPBOARD_TYPE;
  version: number;
  /** The board the elements came from, so a paste back can keep task cards. */
  sourceBoardId: string | null;
  elements: BoardElement[];
};

export type ClipboardContent =
  | {
      kind: "elements";
      elements: BoardElement[];
      sourceBoardId: string | null;
      /** Pictures a pasted board file carries, by asset id. */
      images: Record<string, string>;
    }
  | { kind: "text"; text: string; url: string | null }
  | { kind: "empty" };

/** Guards a paste: a huge clipboard must not freeze the tab. */
export const MAX_CLIPBOARD_CHARS = 8 * 1024 * 1024;

export function serializeClipboard(
  elements: readonly BoardElement[],
  sourceBoardId: string | null,
): string {
  const envelope: ClipboardEnvelope = {
    type: CLIPBOARD_TYPE,
    version: CLIPBOARD_VERSION,
    sourceBoardId,
    elements: elements.filter((element) => !element.deleted),
  };
  return JSON.stringify(envelope);
}

const URL_PATTERN = /^https?:\/\/[^\s]+$/i;

/** Reads pasted text: board elements, a board file, a link or plain text. */
export function parseClipboardText(
  text: string | null | undefined,
): ClipboardContent {
  if (!text) return { kind: "empty" };
  if (text.length > MAX_CLIPBOARD_CHARS) return { kind: "empty" };
  const trimmed = text.trim();
  if (!trimmed) return { kind: "empty" };
  if (trimmed.startsWith("{")) {
    const parsed = safeJson(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if (record.type === CLIPBOARD_TYPE) {
        const raw = Array.isArray(record.elements) ? record.elements : [];
        const elements = sanitizeElements(raw).filter((el) => !el.deleted);
        if (elements.length === 0) return { kind: "empty" };
        return {
          kind: "elements",
          elements,
          sourceBoardId:
            typeof record.sourceBoardId === "string"
              ? record.sourceBoardId
              : null,
          images: {},
        };
      }
      const file = parseBoardFile(trimmed);
      if (file) {
        const elements = file.elements.filter((el) => !el.deleted);
        if (elements.length > 0)
          return {
            kind: "elements",
            elements,
            sourceBoardId: null,
            images: file.images,
          };
      }
    }
  }
  return {
    kind: "text",
    text: trimmed,
    url: URL_PATTERN.test(trimmed) ? trimmed : null,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Writes text to the clipboard, falling back to the copy event's data. */
export async function writeClipboardText(
  text: string,
  event?: ClipboardEvent | null,
): Promise<boolean> {
  if (event?.clipboardData) {
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
    return true;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Reads text and image files from a paste event. */
export function readPasteEvent(event: ClipboardEvent): {
  text: string | null;
  files: File[];
} {
  const data = event.clipboardData;
  if (!data) return { text: null, files: [] };
  const files: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return { text: data.getData("text/plain") || null, files };
}

/** Clipboard read for the context menu's paste, where no event exists. */
export async function readClipboard(): Promise<{
  text: string | null;
  files: File[];
}> {
  const files: File[] = [];
  let text: string | null = null;
  try {
    if ("read" in navigator.clipboard) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith("image/")) {
            const blob = await item.getType(type);
            files.push(new File([blob], "pasted-image", { type }));
          } else if (type === "text/plain" && text === null) {
            text = await (await item.getType(type)).text();
          }
        }
      }
      return { text, files };
    }
  } catch {
    // Fall through to the text-only API.
  }
  try {
    text = await navigator.clipboard.readText();
  } catch {
    text = null;
  }
  return { text, files };
}

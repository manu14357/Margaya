import { getDesktopOfflineSnapshotSaver } from "@/lib/desktop";

/**
 * Offline reading in the desktop app: when a task or page is on screen, the
 * web app hands the app a small read-only snapshot of it, which the app's
 * offline page shows when the server can't be reached. Plain text only
 * (never HTML), capped, debounced; without the bridge nothing happens.
 *
 * The caps match the app's (apps/desktop/src-tauri/src/offline_cache.rs),
 * which refuses anything larger.
 */
export type DesktopOfflineSnapshot = {
  kind: "task" | "page";
  id: string;
  /** A path of this web UI ("/dashboard/..."), never an API route. */
  path: string;
  title: string;
  workspaceName: string | null;
  projectName: string | null;
  status: string | null;
  priority: string | null;
  dueDate: string | null;
  assignees: string[];
  /** Plain text with a few markdown-like line markers; never HTML. */
  bodyText: string;
  updatedAt: string | null;
};

export const OFFLINE_BODY_MAX_BYTES = 200_000;
const MAX_TITLE_BYTES = 1000;
const MAX_NAME_BYTES = 500;
const MAX_LABEL_BYTES = 200;
const MAX_DATE_BYTES = 64;
const MAX_ASSIGNEES = 50;
export const OFFLINE_SNAPSHOT_DELAY_MS = 1500;

const encoder = new TextEncoder();

/** Cuts text to at most `maxBytes` of UTF-8, never inside a character. */
export function capUtf8(text: string, maxBytes: number): string {
  if (text.length * 3 <= maxBytes) return text;
  if (encoder.encode(text).length <= maxBytes) return text;
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += char.length;
  }
  return text.slice(0, end);
}

// C0 and C1 controls except tab and line feed.
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
const LINE_CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

function line(value: string | null | undefined, maxBytes: number) {
  if (!value) return null;
  const text = capUtf8(
    value.replace(LINE_CONTROL, " ").trim(),
    maxBytes,
  ).trim();
  return text || null;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string) {
  return text.replace(
    /&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,6});/gi,
    (match, name: string) => {
      if (name[0] === "#") {
        const code =
          name[1] === "x" || name[1] === "X"
            ? Number.parseInt(name.slice(2), 16)
            : Number.parseInt(name.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
      return ENTITIES[name.toLowerCase()] ?? match;
    },
  );
}

/**
 * Readable text from stored editor content (markdown, which may hold some
 * HTML): tags dropped, links and images reduced to their text, emphasis
 * markers removed. Headings, list and checklist markers stay, because the
 * offline page shows those few as structure; everything is text.
 */
export function offlineTextFromMarkdown(markdown: string | null | undefined) {
  if (!markdown) return "";
  const text = markdown
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre)>/gi, "\n")
    .replace(/<\/?[a-z][^<>]*>/gi, "")
    // Images, then links: their text only.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .split("\n")
    .filter((row) => !/^\s*(```|~~~)/.test(row))
    .map((row) => row.replace(/^\s{0,3}>\s?/, "").trimEnd())
    .join("\n");
  return capUtf8(
    decodeEntities(text)
      .replace(CONTROL, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    OFFLINE_BODY_MAX_BYTES,
  );
}

type SnapshotInput = {
  kind: DesktopOfflineSnapshot["kind"];
  id: string;
  path: string;
  title: string | null | undefined;
  workspaceName?: string | null;
  projectName?: string | null;
  status?: string | null;
  priority?: string | null;
  dueDate?: string | Date | null;
  assignees?: Array<string | null | undefined>;
  markdown?: string | null;
  updatedAt?: string | Date | null;
};

function isoDate(value: string | Date | null | undefined) {
  if (!value) return null;
  return line(
    value instanceof Date ? value.toISOString() : value,
    MAX_DATE_BYTES,
  );
}

/** The snapshot the app accepts, with every field cleaned and capped. */
export function buildOfflineSnapshot(
  input: SnapshotInput,
): DesktopOfflineSnapshot | null {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.id)) return null;
  if (!input.path.startsWith("/") || input.path.startsWith("//")) return null;
  if (/^\/api(\/|$)/i.test(input.path)) return null;
  return {
    kind: input.kind,
    id: input.id,
    path: input.path,
    title: line(input.title, MAX_TITLE_BYTES) ?? "",
    workspaceName: line(input.workspaceName, MAX_NAME_BYTES),
    projectName: line(input.projectName, MAX_NAME_BYTES),
    status: line(input.status, MAX_LABEL_BYTES),
    priority: line(input.priority, MAX_LABEL_BYTES),
    dueDate: isoDate(input.dueDate),
    assignees: (input.assignees ?? [])
      .map((name) => line(name, MAX_NAME_BYTES))
      .filter((name): name is string => name !== null)
      .slice(0, MAX_ASSIGNEES),
    bodyText: offlineTextFromMarkdown(input.markdown),
    updatedAt: isoDate(input.updatedAt),
  };
}

/**
 * Sends snapshots to the app after `delayMs` of quiet, skipping one that is
 * the same as the last sent. Without the bridge member it does nothing.
 */
export function createOfflineSnapshotSender(
  win: Window = window,
  delayMs = OFFLINE_SNAPSHOT_DELAY_MS,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSent: string | null = null;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    push(snapshot: DesktopOfflineSnapshot | null) {
      cancel();
      if (!snapshot) return;
      const save = getDesktopOfflineSnapshotSaver(win);
      if (!save) return;
      timer = setTimeout(() => {
        timer = undefined;
        const serialized = JSON.stringify(snapshot);
        if (serialized === lastSent) return;
        lastSent = serialized;
        save(snapshot);
      }, delayMs);
    },
    cancel,
  };
}

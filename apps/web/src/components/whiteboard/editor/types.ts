import type { TaskCardData } from "@margaya/whiteboard";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

// The contract between the whiteboard screen (data, sockets, header) and the
// canvas editor. The screen owns the Yjs document and the socket; the editor
// only reads and writes the document and the awareness states.

export type ExportImageOptions = {
  /** 1, 2 or 3. */
  scale?: number;
  /** Paint the board background (false: transparent PNG / no rect in SVG). */
  background?: boolean;
  /** Only the selected elements (falls back to the whole board). */
  selectionOnly?: boolean;
  /** Embed the board data so the image can be opened as a board again. */
  embedScene?: boolean;
  /**
   * Include background pattern: draw the board's dots, grid or lines behind
   * the drawing. Defaults to on for PNG and off for SVG; never drawn without
   * the background.
   */
  pattern?: boolean;
  theme?: "light" | "dark";
};

export type WhiteboardEditorHandle = {
  exportPng(options?: ExportImageOptions): Promise<Blob>;
  exportSvg(options?: ExportImageOptions): Promise<string>;
  /** The board as a `.margaya-board` JSON file body, pictures included. */
  exportFile(): Promise<string>;
  /** Adds the elements of a `.margaya-board` file or a PNG with an embedded board. */
  importFile(file: File): Promise<void>;
  zoomToFit(): void;
  scrollToElement(elementId: string): void;
};

/** What a collaborator publishes in the awareness `user` field. */
export type CollaboratorIdentity = {
  id: string;
  name: string;
  /** CSS colour for the cursor and selection outline. */
  color: string;
  image?: string | null;
};

export type WhiteboardEditorProps = {
  doc: Y.Doc;
  /** Null while offline or for the public read-only view. */
  awareness: Awareness | null;
  readOnly: boolean;
  user: CollaboratorIdentity | null;
  workspaceId: string;
  projectId: string;
  whiteboardId: string;
  theme: "light" | "dark";
  /** Uploads an image to the board's assets. Absent: images are off. */
  uploadImage?: (
    file: File,
  ) => Promise<{ assetId: string; width: number; height: number }>;
  /** URL the browser can load for an asset id. */
  imageUrl: (assetId: string) => string;
  /** Called once the editor can export and navigate. */
  onReady?: (handle: WhiteboardEditorHandle) => void;
  /** Scroll to and select this element on first load (`?element=`). */
  initialElementId?: string | null;
  /** Public view: no task data queries, no uploads, no menus that write. */
  isPublic?: boolean;
  /**
   * Task card data for the public view, keyed by task id (the public board
   * response carries a snapshot; signed-in views query live data instead).
   */
  publicTasks?: Record<string, TaskCardData>;
  /**
   * Present mode: read-only, no toolbars; arrow keys or a click step through
   * the frames, Esc calls `onExitPresent`.
   */
  presenting?: boolean;
  onExitPresent?: () => void;
  /**
   * The document holds the stored board (the first sync finished, or it is
   * the stored copy). From then on the first view is settled: content a
   * collaborator draws later never moves this viewer's view.
   */
  synced?: boolean;
  /**
   * AI is available for the board's project (useAiAvailability): shows the
   * AI menu. The API checks every switch and permission again.
   */
  aiEnabled?: boolean;
};

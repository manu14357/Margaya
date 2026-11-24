// These components read the board controller (history, collaborators,
// read-only state, the scene) while rendering. It is a mutable object whose
// identity never changes, so compiler memoisation would freeze those reads.
"use no memo";

import { type TaskCardData, taskIdsOf } from "@margaya/whiteboard";
import { useNavigate } from "@tanstack/react-router";
import { Palette } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { TooltipProvider } from "@/components/ui/tooltip";
import useCreateTaskRelation from "@/hooks/mutations/task-relation/use-create-task-relation";
import useGetTaskRelations from "@/hooks/queries/task-relation/use-get-task-relations";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import { BoardAiDialog, type BoardAiMode } from "./board-ai-dialog";
import { BoardAiMenu } from "./board-ai-menu";
import { BottomBar, Collaborators, FollowFrame, Minimap } from "./chrome";
import { readPasteEvent, writeClipboardText } from "./clipboard";
import {
  copySelection,
  flowchartAdd,
  insertImage,
  nudge,
  pasteContent,
  runCommand,
} from "./commands";
import { EditorContextMenu } from "./context-menu";
import { BoardController, type NoticeKind } from "./controller";
import {
  DependencyPrompt,
  findBlockingRelation,
  toDependencyRelation,
  useDependencyPrompt,
} from "./dependency-prompt";
import {
  exportFile,
  exportPng,
  exportSvg,
  importFile,
  isBoardFile,
  placeImported,
  readBoardFile,
} from "./export";
import { HelpDialog } from "./help-dialog";
import { Interaction } from "./interaction";
import { LinkDialog } from "./link-dialog";
import { resetTextMeasurements } from "./measure";
import { paintOverlay } from "./overlay";
import { PresentLayer } from "./present-layer";
import { PropertiesPanel } from "./properties-panel";
import { SearchDialog } from "./search-dialog";
import { dependencyLinkOf } from "./selection-info";
import { isWriteAction, resolveKey } from "./shortcuts";
import { escapeStep, openDialog, pickShape } from "./store";
import { TaskPickerDialog } from "./task-picker-dialog";
import { TextOverlay } from "./text-overlay";
import { EditorToolbar } from "./toolbar";
import { isDialogTool, type ShapeChoice, type ToolId } from "./tools";
import { TurnIntoTasksDialog } from "./turn-into-tasks-dialog";
import type { WhiteboardEditorHandle, WhiteboardEditorProps } from "./types";
import { EditorContext } from "./use-editor";
import { useTaskCards } from "./use-task-cards";
import { wheelZoomFactor, zoomAround } from "./viewport";

const COMPACT_WIDTH = 640;

const NOTICE_KEYS: Record<NoticeKind, string> = {
  readOnly: "whiteboardEditor:notices.readOnly",
  copied: "whiteboardEditor:notices.copied",
  linkCopied: "whiteboardEditor:notices.linkCopied",
  pasteEmpty: "whiteboardEditor:notices.pasteEmpty",
  uploadFailed: "whiteboardEditor:notices.uploadFailed",
  imageType: "whiteboards:toasts.imageType",
  imageMissing: "whiteboards:toasts.imageUploadError",
  uploading: "whiteboardEditor:notices.uploading",
  imagesOff: "whiteboardEditor:notices.imagesOff",
  importFailed: "whiteboardEditor:notices.importFailed",
  imported: "whiteboardEditor:notices.imported",
  tooManyElements: "whiteboardEditor:notices.tooManyElements",
  dependencyCreated: "whiteboardEditor:notices.dependencyCreated",
  dependencyFailed: "whiteboardEditor:notices.dependencyFailed",
  cropUnavailable: "whiteboardEditor:notices.cropUnavailable",
};

const ERROR_NOTICES = new Set<NoticeKind>([
  "readOnly",
  "uploadFailed",
  "imageType",
  "imageMissing",
  "importFailed",
  "tooManyElements",
  "dependencyFailed",
  "imagesOff",
  "cropUnavailable",
]);

/** How long a "read-only" notice keeps the next one from showing. */
const READ_ONLY_NOTICE_GAP_MS = 4000;

/** Notices that report nothing at all, not a success. */
const INFO_NOTICES = new Set<NoticeKind>(["pasteEmpty"]);

/** Notices that report work in progress, shown until the work ends. */
const PROGRESS_NOTICES = new Set<NoticeKind>(["uploading"]);

/** Whether a key event belongs to a text field rather than the canvas. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** A focused button or similar control inside the editor chrome. */
function isControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        "button,a,input,[role=radio],[role=slider],[role=toolbar]",
      ),
    )
  );
}

/** A control that moves focus or changes its value with the arrow keys. */
function usesArrowKeys(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        "[role=toolbar],[role=radiogroup],[role=radio],[role=slider],[role=tablist],[data-slot=toggle-group]",
      ),
    )
  );
}

/** Moves the selection to the next or previous element and shows it. */
function cycleSelection(c: BoardController, step: 1 | -1) {
  const elements = c.scene.elements;
  if (elements.length === 0) return;
  const current = c.state.selectedIds[0];
  const index = current
    ? elements.findIndex((element) => element.id === current)
    : -1;
  const next = elements[(index + step + elements.length) % elements.length];
  if (next) c.scrollToElement(next.id);
}

/** Another dialog or menu owns the keyboard while it is open. */
function insideOverlay(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        "[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[data-slot=popover-popup]",
      ),
    )
  );
}

export function WhiteboardEditor(props: WhiteboardEditorProps) {
  const {
    doc,
    awareness,
    readOnly: boardReadOnly,
    user,
    workspaceId,
    projectId,
    whiteboardId,
    theme,
    uploadImage,
    imageUrl,
    onReady,
    initialElementId,
    isPublic = false,
    presenting = false,
    onExitPresent,
    synced = false,
    aiEnabled = false,
  } = props;
  // Present mode shows the board read-only, whatever the viewer may do.
  const readOnly = boardReadOnly || presenting;
  // The editor's copy is a lazy namespace: this asks for it, and the "loaded"
  // binding (lib/i18n) re-renders the editor's parts once it arrives.
  const { t } = useTranslation(["common", "whiteboardEditor"], {
    useSuspense: false,
  });
  const navigate = useNavigate();
  const createRelation = useCreateTaskRelation();

  const [controller] = useState(
    () =>
      new BoardController({
        doc,
        awareness,
        readOnly,
        user,
        whiteboardId,
        theme,
        imageUrl,
        uploadImage,
        isPublic,
        frameTitle: t("whiteboardEditor:tools.frame"),
      }),
  );
  const c = controller;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const staticRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const coarseRef = useRef(false);
  const [editing, setEditing] = useState<{ id: string; isNew: boolean } | null>(
    null,
  );

  // The controller lives for the editor's lifetime; props flow into it.
  // Strict mode unmounts and mounts again, so mounting reconnects it.
  useEffect(() => {
    c.connect();
    return () => c.dispose();
  }, [c]);
  // An unnamed frame shows the word "Frame" so its title strip can be seen
  // and grabbed, on the board, in exports and on public boards alike.
  const frameTitle = t("whiteboardEditor:tools.frame");
  useEffect(() => {
    c.setOptions({
      readOnly,
      user,
      theme,
      imageUrl,
      uploadImage,
      isPublic,
      whiteboardId,
      frameTitle,
    });
  }, [
    c,
    readOnly,
    user,
    theme,
    imageUrl,
    uploadImage,
    isPublic,
    whiteboardId,
    frameTitle,
  ]);

  const editText = useCallback(
    (id: string, options: { isNew?: boolean } = {}) => {
      if (c.readOnly) return;
      c.update((state) => ({ ...state, editingTextId: id }));
      setEditing({ id, isNew: Boolean(options.isNew) });
    },
    [c],
  );

  const openTask = useCallback(
    (taskId: string) => {
      if (isPublic || !taskId) return;
      void navigate({
        to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
        params: { workspaceId, projectId, taskId },
      });
    },
    [isPublic, navigate, workspaceId, projectId],
  );

  const openLink = useCallback(
    (url: string) => {
      const match = /^#element=(.+)$/.exec(url);
      if (match?.[1]) {
        c.scrollToElement(decodeURIComponent(match[1]));
        return;
      }
      if (/^(https?:|mailto:)/i.test(url))
        window.open(url, "_blank", "noopener,noreferrer");
    },
    [c],
  );

  const [interaction] = useState(
    () =>
      new Interaction(c, {
        editText: (id, options) => editTextRef.current(id, options),
        openTask: (taskId) => openTaskRef.current(taskId),
        openLink: (url) => openLinkRef.current(url),
      }),
  );
  const editTextRef = useRef(editText);
  const openTaskRef = useRef(openTask);
  const openLinkRef = useRef(openLink);
  editTextRef.current = editText;
  openTaskRef.current = openTask;
  openLinkRef.current = openLink;
  const presentingRef = useRef(presenting);
  presentingRef.current = presenting;
  // Entering present mode drops what was in progress and the selection.
  useEffect(() => {
    if (!presenting) return;
    interaction.cancel();
    c.select([]);
    c.update((state) => ({ ...state, contextMenu: null, dialog: null }));
  }, [c, interaction, presenting]);
  // Write access and the theme live in the controller's options, not the
  // store: the canvas cursor follows them here (after setOptions above).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on these changes
  useEffect(() => {
    interaction.refreshCursor();
  }, [interaction, readOnly, theme]);

  // Every refused key press on a read-only board would stack another copy
  // of the same message; one at a time is enough.
  const lastReadOnlyNotice = useRef(0);
  const notice = useCallback(
    (kind: NoticeKind) => {
      if (kind === "readOnly") {
        const now = Date.now();
        if (now - lastReadOnlyNotice.current < READ_ONLY_NOTICE_GAP_MS)
          return undefined;
        lastReadOnlyNotice.current = now;
      }
      const message = t(NOTICE_KEYS[kind]);
      if (PROGRESS_NOTICES.has(kind)) {
        // Stays up while the work runs; the caller takes it down.
        const id = toast.loading(message);
        return () => toast.dismiss(id);
      }
      if (ERROR_NOTICES.has(kind)) toast.error(message);
      else if (INFO_NOTICES.has(kind)) toast.info(message);
      else if (kind !== "copied") toast.success(message);
      return undefined;
    },
    [t],
  );
  // Dependencies are task data: never on public or read-only boards.
  const dependencies = useDependencyPrompt({
    enabled: !isPublic && !readOnly && Boolean(projectId),
    cardKey: (taskId) => c.getTaskCard(taskId)?.key || null,
  });
  const askAboutDependencies = dependencies.ask;
  useEffect(() => {
    c.callbacks = {
      openTask,
      notice,
      openLink,
      dependencyArrowsRemoved: (links) => void askAboutDependencies(links),
    };
  }, [c, openTask, notice, openLink, askAboutDependencies]);

  // ----- task cards ---------------------------------------------------------
  const sceneVersion = useStore(c.store, (state) => state.sceneVersion);
  // biome-ignore lint/correctness/useExhaustiveDependencies: recomputed on scene changes
  const taskIds = useMemo(() => taskIdsOf(c.scene.elements), [c, sceneVersion]);
  const stableTaskIds = useStableArray(taskIds);
  const taskSource = useTaskCards(projectId, stableTaskIds, {
    enabled: !isPublic,
    theme,
  });
  useEffect(() => {
    if (!isPublic) c.setTaskCards(taskSource.cards);
  }, [c, isPublic, taskSource.cards]);
  useEffect(() => {
    if (isPublic && props.publicTasks) {
      c.setTaskCards(
        new Map(Object.entries(props.publicTasks)) as Map<string, TaskCardData>,
      );
    }
  }, [c, isPublic, props.publicTasks]);

  // ----- canvases -----------------------------------------------------------
  useEffect(() => {
    const root = rootRef.current;
    const staticCanvas = staticRef.current;
    const overlay = overlayRef.current;
    if (!root || !staticCanvas || !overlay) return;
    c.attach(staticCanvas, overlay);
    const stopCursor = interaction.watchCursor();
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    c.overlayPainter = (ctx) =>
      paintOverlay(ctx, c, interaction, {
        coarse: coarseRef.current,
        reducedMotion,
      });
    const measure = () => {
      const rect = root.getBoundingClientRect();
      c.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    };
    measure();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(root);
    window.addEventListener("resize", measure);
    // Text measured before the board font loaded is wrong: measure again.
    void document.fonts?.ready.then(() => {
      resetTextMeasurements();
      c.requestRender();
    });
    return () => {
      stopCursor();
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      c.detach();
    };
  }, [c, interaction]);

  // First view: the linked element, or the whole board once it has content.
  const syncedRef = useRef(synced);
  syncedRef.current = synced;
  const settleFirstView = useRef<() => void>(() => undefined);
  useEffect(() => {
    let done = false;
    const startViewport = c.state.viewport;
    // A board that is still empty once it has synced stays as it is: a
    // collaborator's first shape must not move this viewer's view.
    settleFirstView.current = () => {
      if (c.scene.elements.length === 0) done = true;
    };
    const place = (change?: { remote: boolean }) => {
      if (done) return;
      // Only content that arrives (stored or synced) is framed. Someone who
      // starts drawing on an empty board, or moves the view, keeps their view.
      if ((change && !change.remote) || c.state.viewport !== startViewport) {
        done = true;
        return;
      }
      if (c.scene.elements.length === 0) {
        if (syncedRef.current) done = true;
        return;
      }
      if (c.state.width === 0) return;
      done = true;
      if (initialElementId && c.scene.get(initialElementId))
        c.scrollToElement(initialElementId);
      else c.zoomToFit();
    };
    place();
    const stopScene = c.scene.subscribe(place);
    // The store changes on every scene change too (before the scene listener
    // above runs), so it only matters here once the canvas has its size.
    const stopStore = c.store.subscribe((state, previous) => {
      if (state.viewport !== startViewport) done = true;
      else if (state.width > 0 && previous.width === 0) place();
    });
    return () => {
      stopScene();
      stopStore();
    };
  }, [c, initialElementId]);
  useEffect(() => {
    if (synced) settleFirstView.current();
  }, [synced]);

  // ----- handle -------------------------------------------------------------
  useEffect(() => {
    if (!onReady) return;
    const handle: WhiteboardEditorHandle = {
      exportPng: (options) => exportPng(c, { theme, ...options }),
      exportSvg: (options) => exportSvg(c, { theme, ...options }),
      exportFile: () => exportFile(c),
      // The board menu reports the outcome itself.
      importFile: (file) => importFile(c, file, null, { quiet: true }),
      zoomToFit: () => c.zoomToFit(),
      scrollToElement: (id) => c.scrollToElement(id),
    };
    onReady(handle);
  }, [c, onReady, theme]);

  // ----- tools --------------------------------------------------------------
  const pickTool = useCallback(
    (tool: ToolId) => {
      if (isDialogTool(tool)) {
        if (!c.canWrite()) return;
        if (tool === "image") fileRef.current?.click();
        else c.update((state) => openDialog(state, "taskPicker"));
        return;
      }
      interaction.pickTool({ type: "pick", tool, readOnly: c.readOnly });
    },
    [c, interaction],
  );
  const pickShapeTool = useCallback(
    (shape: ShapeChoice) => {
      interaction.cancel();
      c.update((state) => pickShape(state, shape, c.readOnly));
      rootRef.current?.focus({ preventScroll: true });
    },
    [c, interaction],
  );

  // ----- keyboard -----------------------------------------------------------
  useEffect(() => {
    const root = rootRef.current;
    const owns = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || insideOverlay(event.target))
        return false;
      if (c.state.dialog || c.state.contextMenu || c.state.editingTextId)
        return false;
      const target = event.target;
      // Keys aimed at the window or the page body are the board's too.
      if (!(target instanceof Node)) return true;
      return target === document.body || Boolean(root?.contains(target));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // Present mode handles its own keys (see PresentLayer).
      if (presentingRef.current) return;
      if (!owns(event)) return;
      interaction.updateModifiers(event);
      if (
        (event.key === " " || event.code === "Space") &&
        !isControl(event.target)
      ) {
        event.preventDefault();
        if (!event.repeat) c.dispatchTool({ type: "holdHand" });
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (!interaction.cancel()) c.update(escapeStep);
        return;
      }
      if (event.key === "Enter" && interaction.finishPending()) {
        event.preventDefault();
        return;
      }
      // Keys that operate a focused control stay with it: Enter presses a
      // button, and arrows move through a toolbar or a segmented choice.
      // Arrows with Ctrl or Cmd (align, add a connected shape) are the board's.
      const onControl = event.target !== root && isControl(event.target);
      if (onControl && event.key === "Enter") return;
      if (
        onControl &&
        event.key.startsWith("Arrow") &&
        !event.ctrlKey &&
        !event.metaKey &&
        usesArrowKeys(event.target)
      )
        return;
      const action = resolveKey(event);
      if (!action) return;
      if (
        action.kind === "command" &&
        (action.command === "copy" ||
          action.command === "cut" ||
          action.command === "paste")
      ) {
        // The browser's clipboard events carry the data; see below.
        return;
      }
      event.preventDefault();
      if (isWriteAction(action) && !c.canWrite()) return;
      switch (action.kind) {
        case "tool":
          pickTool(action.tool);
          return;
        case "nudge":
          nudge(c, action.dx, action.dy);
          return;
        case "flowchart":
          flowchartAdd(c, action.direction);
          return;
        case "cycle":
          cycleSelection(c, action.step);
          return;
        case "command":
          runCommand(c, action.command, {
            at: interaction.pointer,
            editText: (id) => editTextRef.current(id),
          });
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      interaction.updateModifiers(event);
      if (event.key === " " || event.code === "Space")
        c.dispatchTool({ type: "releaseHand" });
    };
    const onBlur = () => c.dispatchTool({ type: "releaseHand" });
    const clipboardOwned = (event: Event) =>
      !isTypingTarget(event.target) &&
      !insideOverlay(event.target) &&
      !c.state.dialog &&
      !c.state.editingTextId;
    const onCopy = (event: ClipboardEvent) => {
      if (!clipboardOwned(event) || c.state.selectedIds.length === 0) return;
      void copySelection(c, event);
    };
    const onCut = (event: ClipboardEvent) => {
      if (!clipboardOwned(event) || c.state.selectedIds.length === 0) return;
      if (!c.canWrite()) return;
      void copySelection(c, event).then((ok) => {
        if (ok) c.remove([...c.state.selectedIds]);
      });
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!clipboardOwned(event)) return;
      event.preventDefault();
      if (!c.canWrite()) return;
      void pasteContent(c, readPasteEvent(event), interaction.pointer);
    };
    // Capture: the board decides first, so a key it uses ("?", a tool
    // letter) is marked handled before the app's own shortcuts see it.
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
    };
  }, [c, interaction, pickTool]);

  // ----- wheel (non-passive so the page never scrolls or zooms) -------------
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (c.state.followingClientId !== null) c.follow(null);
      const rect = overlay.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const viewport = c.state.viewport;
      if (event.ctrlKey || event.metaKey) {
        const factor = wheelZoomFactor(event.deltaY, event.deltaMode);
        c.setViewport(zoomAround(viewport, viewport.zoom * factor, x, y));
        return;
      }
      const unit = event.deltaMode === 1 ? 16 : 1;
      let dx = event.deltaX * unit;
      let dy = event.deltaY * unit;
      if (event.shiftKey && dx === 0) {
        dx = dy;
        dy = 0;
      }
      c.setViewport({
        ...viewport,
        scrollX: viewport.scrollX - dx / viewport.zoom,
        scrollY: viewport.scrollY - dy / viewport.zoom,
      });
    };
    overlay.addEventListener("wheel", onWheel, { passive: false });
    return () => overlay.removeEventListener("wheel", onWheel);
  }, [c]);

  // ----- drop ---------------------------------------------------------------
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    if (!c.canWrite()) return;
    const at = c.toBoard(event.clientX, event.clientY);
    const files = Array.from(event.dataTransfer.files);
    const board = files.find(isBoardFile);
    if (board) {
      void importFile(c, board, at).catch(() => undefined);
      return;
    }
    const text = event.dataTransfer.getData("text/plain") || null;
    const png = files.find((file) => file.type === "image/png");
    if (png) {
      // A PNG may carry a board; otherwise it is just an image, so there is
      // nothing to report about boards.
      void readBoardFile(png)
        .catch(() => null)
        .then((board) => {
          if (board && board.elements.length > 0)
            void placeImported(c, board, at);
          else void pasteContent(c, { text, files }, at);
        });
      return;
    }
    if (files.length > 0 || text) void pasteContent(c, { text, files }, at);
  };

  // ----- task actions -------------------------------------------------------
  const makeDependency = useCallback(
    (link: { sourceTaskId: string; targetTaskId: string }) => {
      if (!c.canWrite()) return;
      createRelation.mutate(
        {
          sourceTaskId: link.sourceTaskId,
          targetTaskId: link.targetTaskId,
          relationType: "blocks",
        },
        {
          onSuccess: () => notice("dependencyCreated"),
          onError: () => notice("dependencyFailed"),
        },
      );
    },
    [c, createRelation, notice],
  );

  const copyElementLink = useCallback(
    (elementId: string) => {
      const url = new URL(window.location.href);
      url.searchParams.set("element", elementId);
      url.hash = "";
      void writeClipboardText(url.toString()).then(
        (ok) => ok && notice("linkCopied"),
      );
    },
    [notice],
  );

  const dialog = useStore(c.store, (state) => state.dialog);
  const width = useStore(c.store, (state) => state.width);
  const showMinimap = useStore(c.store, (state) => state.showMinimap);
  const tool = useStore(c.store, (state) => state.tool);
  const compact = width > 0 && width < COMPACT_WIDTH;
  const tasksEnabled = !isPublic && Boolean(projectId);
  const setDialog = (next: typeof dialog) => (open: boolean) =>
    c.update((state) => ({ ...state, dialog: open ? next : null }));

  // A selected arrow between two task cards: does it already stand for a
  // "blocks" relation? Decides between "Make" and "Remove dependency".
  const selectedIds = useStore(c.store, (state) => state.selectedIds);
  const onlySelected =
    tasksEnabled && !readOnly && selectedIds.length === 1 && selectedIds[0]
      ? c.get(selectedIds[0])
      : undefined;
  const selectedLink = onlySelected
    ? dependencyLinkOf(onlySelected, (id) => c.get(id))
    : null;
  const selectedRelations = useGetTaskRelations(
    selectedLink?.sourceTaskId ?? "",
  );
  const existingDependency = selectedLink
    ? findBlockingRelation(
        selectedRelations.data,
        selectedLink.sourceTaskId,
        selectedLink.targetTaskId,
      )
    : null;
  const removeRelations = dependencies.removeRelations;

  // AI proposals: the dialog previews them; nothing changes until accepted.
  const [aiMode, setAiMode] = useState<BoardAiMode | null>(null);
  const aiOn = aiEnabled && !isPublic && Boolean(projectId) && !presenting;
  const openAi = (mode: BoardAiMode) => {
    setAiMode(mode);
    c.update((state) => openDialog(state, "ai"));
  };
  const closeAi = () => {
    setAiMode(null);
    c.update((state) =>
      state.dialog === "ai" ? { ...state, dialog: null } : state,
    );
  };
  // AI turned off meanwhile: the dialog is gone, so the board gets its keys back.
  useEffect(() => {
    if (aiOn) return;
    setAiMode(null);
    c.update((state) =>
      state.dialog === "ai" ? { ...state, dialog: null } : state,
    );
  }, [c, aiOn]);

  const panelActions = {
    onTurnIntoTasks: () =>
      c.update((state) => openDialog(state, "turnIntoTasks")),
    onMakeDependency: makeDependency,
    dependencyExists: Boolean(existingDependency),
    onRemoveDependency: () => {
      if (!existingDependency || !c.canWrite()) return;
      removeRelations([
        toDependencyRelation(
          existingDependency,
          (taskId) => c.getTaskCard(taskId)?.key || null,
        ),
      ]);
    },
    onEditLink: () => c.update((state) => openDialog(state, "link")),
    onEditText: (id: string) => editTextRef.current(id),
    tasksEnabled,
    onAiGroup: aiOn ? () => openAi("group") : undefined,
    onAiSummarize: aiOn ? () => openAi("summarize") : undefined,
  };

  // A collaborator deleting the element (or the board turning read-only)
  // closes the text editor without writing.
  const editingTextId = useStore(c.store, (state) => state.editingTextId);
  useEffect(() => {
    if (editing && editingTextId !== editing.id) {
      setEditing(null);
      c.cancelPreview();
    }
  }, [c, editing, editingTextId]);

  const finishEditing = useCallback(() => {
    setEditing(null);
    c.update((state) => ({ ...state, editingTextId: null }));
    rootRef.current?.focus({ preventScroll: true });
  }, [c]);

  return (
    <EditorContext.Provider value={c}>
      <TooltipProvider>
        <div
          ref={rootRef}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the board is an application surface that takes focus for its shortcuts
          tabIndex={0}
          // Clip, not hidden: a hidden box still scrolls to show a focused
          // control at its edge, which would slide every layer sideways.
          className="relative h-full w-full touch-none select-none overflow-clip bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          data-testid="whiteboard-editor"
          data-tool={tool}
          aria-label={t("whiteboardEditor:canvas.label")}
          role="application"
          aria-roledescription={t("whiteboardEditor:canvas.roleDescription")}
          onDragOver={(event) => {
            if (!c.readOnly) event.preventDefault();
          }}
          onDrop={onDrop}
        >
          <canvas ref={staticRef} className="absolute inset-0 size-full" />
          <canvas
            ref={overlayRef}
            className="absolute inset-0 size-full"
            onPointerDown={(event) => {
              coarseRef.current = event.pointerType === "touch";
              if (c.state.followingClientId !== null) c.follow(null);
              if (c.state.contextMenu)
                c.update((state) => ({ ...state, contextMenu: null }));
              rootRef.current?.focus({ preventScroll: true });
              interaction.pointerDown(event.nativeEvent);
            }}
            onPointerMove={(event) =>
              interaction.pointerMove(event.nativeEvent)
            }
            onPointerUp={(event) => interaction.pointerUp(event.nativeEvent)}
            onPointerCancel={(event) =>
              interaction.pointerCancel(event.nativeEvent)
            }
            onPointerLeave={() => interaction.pointerLeave()}
            onContextMenu={(event) => {
              event.preventDefault();
              interaction.contextMenu(event.clientX, event.clientY);
            }}
          />
          <FollowFrame />
          {editing && (
            <TextOverlay
              key={editing.id}
              controller={c}
              elementId={editing.id}
              isNew={editing.isNew}
              onDone={finishEditing}
            />
          )}

          {presenting ? (
            <PresentLayer controller={c} onExit={() => onExitPresent?.()} />
          ) : (
            <>
              <div
                className={cn(
                  "pointer-events-none absolute inset-x-0 z-20 flex justify-center px-2",
                  compact ? "bottom-2" : "top-2",
                )}
              >
                <div className="pointer-events-auto">
                  <EditorToolbar
                    readOnly={readOnly}
                    compact={compact}
                    imagesEnabled={Boolean(uploadImage) && !isPublic}
                    tasksEnabled={tasksEnabled}
                    onPick={pickTool}
                    onPickShape={pickShapeTool}
                    onToggleLock={() => c.dispatchTool({ type: "toggleLock" })}
                    extra={
                      aiOn ? (
                        <BoardAiMenu compact={compact} onOpen={openAi} />
                      ) : null
                    }
                  />
                </div>
              </div>

              {!compact && (
                <div className="pointer-events-none absolute top-16 left-2 z-20 flex max-h-[calc(100%-8rem)]">
                  <PropertiesPanel
                    actions={panelActions}
                    className="pointer-events-auto"
                  />
                </div>
              )}

              <div
                className={cn(
                  "pointer-events-none absolute left-2 z-20 flex max-w-[calc(100%-1rem)] items-end gap-2",
                  compact ? "top-2" : "bottom-2",
                )}
              >
                <BottomBar
                  compact={compact}
                  extra={
                    compact && !readOnly ? (
                      <CompactStyleButton
                        actions={panelActions}
                        label={t("whiteboardEditor:panel.label")}
                      />
                    ) : null
                  }
                />
              </div>

              <div className="pointer-events-none absolute top-2 right-2 z-20">
                {!compact && <Collaborators />}
              </div>
              {dependencies.items.length > 0 && (
                <div
                  className={cn(
                    "pointer-events-none absolute inset-x-0 z-30 flex justify-center px-2",
                    compact ? "bottom-16" : "bottom-14",
                  )}
                >
                  <div className="pointer-events-auto">
                    <DependencyPrompt
                      items={dependencies.items}
                      onRemove={dependencies.remove}
                      onKeep={dependencies.keep}
                    />
                  </div>
                </div>
              )}
              {showMinimap && !compact && (
                <div className="pointer-events-none absolute right-2 bottom-2 z-20">
                  <Minimap controller={c} />
                </div>
              )}
            </>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const { width: w, height: h, viewport } = c.state;
              const centre = {
                x: w / 2 / viewport.zoom - viewport.scrollX,
                y: h / 2 / viewport.zoom - viewport.scrollY,
              };
              void insertImage(c, file, centre);
            }}
          />

          <EditorContextMenu
            controller={c}
            actions={{
              ...panelActions,
              onCopyLink: copyElementLink,
              onOpenLink: openLink,
              onEditText: (id) => editTextRef.current(id),
              pointer: () => interaction.pointer,
            }}
          />
          <HelpDialog
            open={dialog === "help"}
            onOpenChange={setDialog("help")}
          />
          <SearchDialog
            open={dialog === "search"}
            onOpenChange={setDialog("search")}
            controller={c}
          />
          <LinkDialog
            open={dialog === "link"}
            onOpenChange={setDialog("link")}
            controller={c}
          />
          {aiOn && (
            <BoardAiDialog
              mode={dialog === "ai" ? aiMode : null}
              onClose={closeAi}
              controller={c}
              whiteboardId={whiteboardId}
            />
          )}
          {tasksEnabled && (
            <>
              <TaskPickerDialog
                open={dialog === "taskPicker"}
                onOpenChange={setDialog("taskPicker")}
                controller={c}
                tasks={taskSource.tasks}
                projectSlug={taskSource.projectSlug}
                isLoading={taskSource.isLoading}
              />
              <TurnIntoTasksDialog
                open={dialog === "turnIntoTasks"}
                onOpenChange={setDialog("turnIntoTasks")}
                controller={c}
                projectId={projectId}
                columns={taskSource.columns}
              />
            </>
          )}
        </div>
      </TooltipProvider>
    </EditorContext.Provider>
  );
}

/** The properties panel in a popover, for narrow screens. */
function CompactStyleButton({
  actions,
  label,
}: {
  actions: Parameters<typeof PropertiesPanel>[0]["actions"];
  label: string;
}) {
  // With nothing selected the popover holds the board background, so the
  // button is always there on a writable board.
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className="pointer-coarse:size-11"
          />
        }
      >
        <Palette aria-hidden="true" />
      </PopoverTrigger>
      <PopoverPopup
        side="bottom"
        align="start"
        className="max-h-[70vh] overflow-y-auto"
      >
        <PropertiesPanel
          actions={actions}
          showBoard
          className="border-0 shadow-none"
        />
      </PopoverPopup>
    </Popover>
  );
}

/** Keeps the same array instance while its contents stay equal. */
function useStableArray(values: readonly string[]): readonly string[] {
  const ref = useRef(values);
  const current = ref.current;
  if (
    current.length !== values.length ||
    current.some((value, index) => value !== values[index])
  ) {
    ref.current = values;
  }
  return ref.current;
}

import { Trash2 } from "lucide-react";
import {
  type KeyboardEvent,
  lazy,
  type PointerEvent,
  type ReactNode,
  Suspense,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { Sticky } from "@/fetchers/sticky/get-stickies";
import {
  useDeleteSticky,
  useUpdateSticky,
} from "@/hooks/mutations/sticky/use-sticky-mutations";
import { cn } from "@/lib/cn";
import { isBlankStickyContent } from "@/lib/sticky-cache";
import { getStickyColor, type StickyColor } from "@/lib/sticky-colors";
import { toast } from "@/lib/toast";
import StickyColorPicker from "./sticky-color-picker";
import type {
  StickyCaret,
  StickyEditorHandle,
  StickyFocusTarget,
  StickyKey,
} from "./sticky-editor";
import { parseStickyPreview, StickyPreview } from "./sticky-preview";
import { useStickyAutosave } from "./use-sticky-autosave";

// The editor and its dependencies are most of Home's code: they load the
// first time someone works in a sticky (or points at one), not with the page.
const loadStickyEditor = () => import("./sticky-editor");
const StickyEditor = lazy(loadStickyEditor);

const EDITOR_CLASSES =
  "[&_.margaya-comment-editor-content_.ProseMirror]:min-h-32 [&_.margaya-comment-editor-content_.ProseMirror]:max-h-80 [&_.margaya-comment-editor-content_.ProseMirror]:overflow-y-auto [&_.margaya-comment-editor-content_.ProseMirror]:px-3 [&_.margaya-comment-editor-content_.ProseMirror]:pt-3 [&_.margaya-comment-editor-content_.ProseMirror]:pb-2 [&_.margaya-comment-editor-content_.ProseMirror]:text-sm";

// Footer controls show on hover and focus, and always on touch screens.
const FOOTER_BUTTON =
  "text-muted-foreground opacity-0 transition-opacity group-hover/sticky:opacity-100 group-focus-within/sticky:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100";

// A busy device can take many frames to draw the to-do checkboxes.
const SETTLE_FRAMES = 30;
// How long a button held down on the preview may delay the swap (frames).
const HOLD_FRAMES = 600;

const CARET_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/**
 * "preview": static text. "loading": the editor loads and mounts hidden
 * behind the preview. "ready": the editor shows in its place.
 */
type Phase = "preview" | "loading" | "ready";

type Handoff = {
  caret: StickyCaret;
  /** Focus the editor whatever has focus by then (a just-created sticky). */
  forceFocus: boolean;
  /** The text was pressed: focus it unless focus has moved elsewhere. */
  pressedText: boolean;
  focus: StickyFocusTarget | null;
  scrollTop: number;
  keys: StickyKey[];
  toggles: Map<number, boolean>;
};

/** A key the preview keeps for the editor, or null for one it lets through. */
function keyForEditor(event: KeyboardEvent<HTMLElement>): StickyKey | null {
  if (event.nativeEvent.isComposing || event.metaKey) return null;
  // AltGr reports Ctrl+Alt and still types a character.
  const typing = !event.ctrlKey || event.altKey;
  if (typing && [...event.key].length === 1) return { text: event.key };
  if (event.ctrlKey || event.altKey) return null;
  if (event.key === "Enter") {
    return { key: event.shiftKey ? "Shift-Enter" : "Enter" };
  }
  if (event.key === "Backspace" || event.key === "Delete") {
    return { key: event.key };
  }
  return null;
}

type StickyCardProps = {
  sticky: Sticky;
  workspaceId: string;
  /** Focus the editor once it mounts (a sticky just created). */
  autoFocus?: boolean;
  /** The drag handle, on the Stickies page only. */
  dragHandle?: ReactNode;
  className?: string;
};

export default function StickyCard({
  sticky,
  workspaceId,
  autoFocus = false,
  dragHandle,
  className,
}: StickyCardProps) {
  const { t } = useTranslation();
  const updateSticky = useUpdateSticky();
  const deleteSticky = useDeleteSticky();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const color = getStickyColor(sticky.color);

  const { draft, setDraft, status, flush, onFocus, onBlur, cancel } =
    useStickyAutosave({
      serverContent: sticky.content,
      save: (content) =>
        updateSticky.mutateAsync({
          workspaceId,
          stickyId: sticky.id,
          changes: { content },
        }),
      onSaveError: () => toast.error(t("stickies:toast.saveError")),
    });

  // Null when the text needs the editor to be drawn as it is.
  const blocks = useMemo(() => parseStickyPreview(draft), [draft]);
  const [phase, setPhase] = useState<Phase>(
    autoFocus || blocks === null ? "loading" : "preview",
  );
  if (phase === "preview" && blocks === null) setPhase("loading");
  const [checkedOverrides, setCheckedOverrides] = useState<
    ReadonlyMap<number, boolean>
  >(() => new Map());
  const previewRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<StickyEditorHandle | null>(null);
  const handoffRef = useRef<Handoff>({
    caret: autoFocus ? "end" : "keep",
    forceFocus: autoFocus,
    pressedText: false,
    focus: null,
    scrollTop: 0,
    keys: [],
    toggles: new Map(),
  });
  // The hidden editor never edits on its own; only once it shows do its
  // changes count (and the autosave's focus check applies as before).
  const editsLiveRef = useRef(false);
  // A button is down on the preview: its focus and click are still to come.
  const pressedRef = useRef(false);

  const activate = useCallback(() => {
    setPhase((current) => (current === "preview" ? "loading" : current));
  }, []);

  const onEditorChange = useCallback(
    (value: string) => {
      if (editsLiveRef.current) setDraft(value);
    },
    [setDraft],
  );

  const onEditorReady = useCallback((handle: StickyEditorHandle) => {
    handleRef.current = handle;
    const settle = (frame: number) => {
      if (handleRef.current !== handle) return;
      // At least one frame, and not while a button is held on the preview:
      // with the editor's code already loaded it is ready within the press,
      // before the press has focused the preview or ticked a to-do.
      const wait =
        frame === 0 ||
        (pressedRef.current && frame < HOLD_FRAMES) ||
        (!handle.isSettled() && frame < SETTLE_FRAMES);
      if (wait) {
        requestAnimationFrame(() => settle(frame + 1));
        return;
      }
      // Read what the preview holds before it goes.
      const handoff = handoffRef.current;
      const preview = previewRef.current;
      const active = document.activeElement;
      handoff.scrollTop = preview?.scrollTop ?? 0;
      if (
        preview &&
        active instanceof HTMLElement &&
        preview.contains(active)
      ) {
        const boxes = Array.from(
          preview.querySelectorAll('[data-slot="checkbox"]'),
        );
        const box = boxes.indexOf(active);
        handoff.focus = box === -1 ? "text" : { checkbox: box };
      } else {
        // A tap can focus later than the press; focus the text unless the
        // person has moved focus somewhere else meanwhile.
        const unclaimed = !active || active === document.body;
        handoff.focus =
          handoff.forceFocus || (handoff.pressedText && unclaimed)
            ? "text"
            : null;
      }
      setPhase("ready");
    };
    settle(0);
  }, []);

  // Runs in the commit that swaps the editor in, before the browser paints
  // or handles another event: the caret, focus and anything typed meanwhile
  // move over in one step.
  useLayoutEffect(() => {
    if (phase !== "ready" || editsLiveRef.current) return;
    const handle = handleRef.current;
    if (!handle) return;
    const handoff = handoffRef.current;
    editsLiveRef.current = true;
    handle.placeCaret(handoff.caret, handoff.scrollTop);
    if (handoff.focus) handle.focus(handoff.focus);
    if (handoff.toggles.size > 0 || handoff.keys.length > 0) {
      // Clicks and keys made before focus moved on still count as edits.
      const focused = handle.hasFocus();
      if (!focused) onFocus();
      handle.applyEdits(handoff.toggles, handoff.keys);
      if (!focused) onBlur();
    }
    handoff.keys = [];
    handoff.toggles.clear();
  }, [phase, onFocus, onBlur]);

  const prefetchEditor = () => {
    // A failed load shows when the editor mounts; nothing to do here.
    if (phase === "preview") loadStickyEditor().catch(() => {});
  };

  const handlePreviewPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    pressedRef.current = true;
    const release = () => {
      pressedRef.current = false;
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
    };
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    // A to-do's checkbox loads the editor once it has focus or is ticked.
    if (
      event.target instanceof Element &&
      event.target.closest('[data-slot="checkbox"]')
    ) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    handoffRef.current.caret = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    handoffRef.current.pressedText = true;
    activate();
  };

  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Escape") {
      event.currentTarget.blur();
      return;
    }
    const key = keyForEditor(event);
    if (!key) {
      // Caret keys have no caret to move yet; they must not scroll the page.
      if (CARET_KEYS.has(event.key)) event.preventDefault();
      return;
    }
    // Held for the editor; nothing else on the page sees it.
    event.preventDefault();
    event.stopPropagation();
    handoffRef.current.keys.push(key);
    activate();
  };

  const handleToggleTask = (index: number, checked: boolean) => {
    setCheckedOverrides((current) => new Map(current).set(index, checked));
    handoffRef.current.toggles.set(index, checked);
    activate();
  };

  const handleColor = (next: StickyColor) => {
    updateSticky.mutate(
      { workspaceId, stickyId: sticky.id, changes: { color: next } },
      { onError: () => toast.error(t("stickies:toast.saveError")) },
    );
  };

  const remove = () => {
    cancel();
    setConfirmOpen(false);
    // The delete removes this card at once, and `mutate` callbacks are
    // dropped once their component unmounts; the promise still settles.
    deleteSticky.mutateAsync({ workspaceId, stickyId: sticky.id }).then(
      () => toast.success(t("stickies:toast.deleted")),
      () => toast.error(t("stickies:toast.deleteError")),
    );
  };

  const handleDelete = () => {
    if (isBlankStickyContent(draft)) remove();
    else setConfirmOpen(true);
  };

  const editorShowing = phase === "ready";

  return (
    <div
      data-sticky-id={sticky.id}
      className={cn(
        "group/sticky flex flex-col rounded-lg border text-foreground focus-within:ring-2 focus-within:ring-ring/40",
        color.cardClassName,
        className,
      )}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a labelled group around the editor region */}
      <div
        role="group"
        aria-label={t("stickies:editorLabel")}
        className="relative"
        onPointerEnter={prefetchEditor}
        onFocus={(event) => {
          onFocus();
          if (previewRef.current?.contains(event.target)) activate();
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            onBlur();
          }
        }}
      >
        {!editorShowing &&
          (blocks ? (
            <StickyPreview
              blocks={blocks}
              placeholder={t("stickies:placeholder")}
              className={EDITOR_CLASSES}
              checkedOverrides={checkedOverrides}
              onToggleTask={handleToggleTask}
              rootRef={previewRef}
              onRootKeyDown={handlePreviewKeyDown}
              onRootPointerDown={handlePreviewPointerDown}
            />
          ) : (
            // Text only the editor can draw: an empty box of the editor's
            // size until it shows.
            <div className={cn("margaya-comment-editor-shell", EDITOR_CLASSES)}>
              <div className="margaya-comment-editor-content">
                <div className="ProseMirror margaya-comment-editor-prose" />
              </div>
            </div>
          ))}
        {phase !== "preview" && (
          <div
            className={
              editorShowing ? undefined : "invisible absolute inset-x-0 top-0"
            }
            aria-hidden={editorShowing ? undefined : true}
            inert={!editorShowing}
          >
            <Suspense fallback={null}>
              <StickyEditor
                value={draft}
                onChange={onEditorChange}
                onReady={onEditorReady}
                placeholder={t("stickies:placeholder")}
                showQuickAttachButton={false}
                allowFileUploads={false}
                fileUploadsDisabledMessage={t("stickies:filesNotAllowed")}
                onCancelShortcut={() => {
                  const active = document.activeElement;
                  if (active instanceof HTMLElement) active.blur();
                }}
                className={EDITOR_CLASSES}
              />
            </Suspense>
          </div>
        )}
      </div>

      <div className="flex h-9 items-center gap-1 px-2">
        <StickyColorPicker
          value={color.key}
          onChange={handleColor}
          triggerClassName={FOOTER_BUTTON}
        />
        {dragHandle}
        <span className="flex-1" />
        {status === "saving" && (
          <span className="text-xs text-muted-foreground">
            {t("stickies:status.saving")}
          </span>
        )}
        {status === "error" && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {t("stickies:status.saveFailed")}
            <Button
              variant="link"
              size="xs"
              className="h-auto px-0 text-xs sm:h-auto"
              onClick={flush}
            >
              {t("stickies:status.retry")}
            </Button>
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className={FOOTER_BUTTON}
          aria-label={t("stickies:delete.button")}
          title={t("stickies:delete.button")}
          onClick={handleDelete}
        >
          <Trash2 />
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("stickies:delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("stickies:delete.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button variant="destructive" onClick={remove}>
              {t("common:actions.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

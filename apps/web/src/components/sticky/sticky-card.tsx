import { Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";
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
import { useStickyAutosave } from "./use-sticky-autosave";

const EDITOR_CLASSES =
  "[&_.margaya-comment-editor-content_.ProseMirror]:min-h-32 [&_.margaya-comment-editor-content_.ProseMirror]:max-h-80 [&_.margaya-comment-editor-content_.ProseMirror]:overflow-y-auto [&_.margaya-comment-editor-content_.ProseMirror]:px-3 [&_.margaya-comment-editor-content_.ProseMirror]:pt-3 [&_.margaya-comment-editor-content_.ProseMirror]:pb-2 [&_.margaya-comment-editor-content_.ProseMirror]:text-sm";

// Footer controls show on hover and focus, and always on touch screens.
const FOOTER_BUTTON =
  "text-muted-foreground opacity-0 transition-opacity group-hover/sticky:opacity-100 group-focus-within/sticky:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100";

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
        onFocus={onFocus}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            onBlur();
          }
        }}
      >
        <CommentEditor
          value={draft}
          onChange={setDraft}
          autoFocus={autoFocus}
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

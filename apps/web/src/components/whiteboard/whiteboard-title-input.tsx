import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUpdateWhiteboard } from "@/hooks/mutations/whiteboard/use-whiteboard-mutations";
import { cn } from "@/lib/cn";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";
import { WHITEBOARD_TITLE_MAX_LENGTH } from "./rename-whiteboard-dialog";

export const BOARD_TITLE_SAVE_DEBOUNCE_MS = 600;

type WhiteboardTitleInputProps = {
  whiteboardId: string;
  projectId: string;
  title: string;
  canEdit: boolean;
  className?: string;
};

/**
 * The board's name in its header: saved 600 ms after typing stops, on blur
 * and on Enter. While it has focus, refetched titles don't overwrite it.
 */
export default function WhiteboardTitleInput({
  whiteboardId,
  projectId,
  title,
  canEdit,
  className,
}: WhiteboardTitleInputProps) {
  const { t } = useTranslation();
  const update = useUpdateWhiteboard();
  const [value, setValue] = useState(title);
  const focusedRef = useRef(false);
  // Escape blurs without saving what was typed.
  const discardRef = useRef(false);
  const savedRef = useRef(title);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    savedRef.current = title;
    if (!focusedRef.current) setValue(title);
  }, [title]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const save = useCallback(
    (next: string) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const trimmed = next.trim();
      if (!canEdit || trimmed === savedRef.current.trim()) return;
      const previous = savedRef.current;
      savedRef.current = trimmed;
      update.mutate(
        { whiteboardId, projectId, title: trimmed },
        {
          onError: (error) => {
            savedRef.current = previous;
            setValue(previous);
            toast.error(
              pageErrorMessage(error) ?? t("whiteboards:toasts.renameError"),
            );
          },
        },
      );
    },
    [canEdit, projectId, t, update, whiteboardId],
  );

  if (!canEdit) {
    return (
      <h1
        className={cn(
          "min-w-0 truncate px-1.5 font-semibold text-sm",
          className,
        )}
      >
        {title.trim() || t("whiteboards:list.untitled")}
      </h1>
    );
  }

  return (
    <input
      value={value}
      maxLength={WHITEBOARD_TITLE_MAX_LENGTH}
      aria-label={t("whiteboards:screen.titleLabel")}
      // The whole title while the header truncates it.
      title={value}
      placeholder={t("whiteboards:list.untitled")}
      className={cn(
        "h-7 min-w-0 text-ellipsis rounded-md border pointer-coarse:h-11 border-transparent bg-transparent px-1.5 font-semibold text-base outline-none transition-colors duration-150 placeholder:text-muted-foreground hover:border-border focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 sm:text-sm",
        className,
      )}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        if (discardRef.current) {
          discardRef.current = false;
          return;
        }
        save(value);
      }}
      onChange={(event) => {
        const next = event.target.value;
        setValue(next);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(
          () => save(next),
          BOARD_TITLE_SAVE_DEBOUNCE_MS,
        );
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          save(value);
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          if (timerRef.current) clearTimeout(timerRef.current);
          discardRef.current = true;
          setValue(savedRef.current);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUpdatePage } from "@/hooks/mutations/page/use-update-page";
import { cn } from "@/lib/cn";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";

export const TITLE_SAVE_DEBOUNCE_MS = 600;
export const TITLE_MAX_LENGTH = 255;

type PageTitleInputProps = {
  pageId: string;
  projectId: string;
  title: string;
  canEdit: boolean;
  /** Enter: continue in the body. */
  onEnter?: () => void;
  autoFocus?: boolean;
};

/**
 * The page title: saved 600 ms after typing stops, on blur and on Enter.
 * While it has focus, refetched titles don't overwrite what is typed.
 */
export default function PageTitleInput({
  pageId,
  projectId,
  title,
  canEdit,
  onEnter,
  autoFocus,
}: PageTitleInputProps) {
  const { t } = useTranslation();
  const updatePage = useUpdatePage();
  const [value, setValue] = useState(title);
  const focusedRef = useRef(false);
  const savedRef = useRef(title);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    savedRef.current = title;
    if (!focusedRef.current) setValue(title);
  }, [title]);

  const save = useCallback(
    (next: string) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const trimmed = next.trim();
      if (!canEdit || trimmed === savedRef.current.trim()) return;
      savedRef.current = trimmed;
      updatePage.mutate(
        { pageId, projectId, json: { title: trimmed } },
        {
          onError: (error, _variables, context) => {
            const previous = context?.detail?.title ?? title;
            savedRef.current = previous;
            setValue(previous);
            toast.error(
              pageErrorMessage(error) ?? t("pages:toasts.titleError"),
            );
          },
        },
      );
    },
    [canEdit, pageId, projectId, t, title, updatePage],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <input
      type="text"
      // biome-ignore lint/a11y/noAutofocus: a new page starts at its title
      autoFocus={autoFocus && canEdit}
      value={value}
      readOnly={!canEdit}
      maxLength={TITLE_MAX_LENGTH}
      placeholder={t("pages:editor.titlePlaceholder")}
      aria-label={t("pages:editor.titleAria")}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        save(value);
      }}
      onChange={(event) => {
        const next = event.target.value;
        setValue(next);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => save(next), TITLE_SAVE_DEBOUNCE_MS);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        save(value);
        onEnter?.();
      }}
      className={cn(
        "w-full border-0 bg-transparent p-0 font-bold text-[2rem] leading-tight tracking-tight outline-none placeholder:text-muted-foreground/50 print:hidden",
        !canEdit && "cursor-default",
      )}
    />
  );
}

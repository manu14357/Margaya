import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { Sticky } from "@/fetchers/sticky/get-stickies";
import { useCreateSticky } from "@/hooks/mutations/sticky/use-sticky-mutations";
import { HttpError } from "@/lib/http-error";
import {
  flattenStickies,
  isBlankStickyContent,
  isSearchedStickiesKey,
  type StickyListData,
  stickiesKeyPrefix,
} from "@/lib/sticky-cache";
import { randomStickyColor } from "@/lib/sticky-colors";
import { toast } from "@/lib/toast";

export const STICKIES_LIMIT = 500;
// A time budget, not a frame count: on a busy device the editor can take
// well over 30 frames to mount, and the new sticky then never got focus.
const FOCUS_BUDGET_MS = 3000;

/**
 * Scrolls a sticky into view and focuses its editor. The editor mounts a
 * little after its card, so this retries every frame for up to 3 s.
 */
export function focusSticky(stickyId: string, deadline?: number) {
  const until = deadline ?? Date.now() + FOCUS_BUDGET_MS;
  const card = document.querySelector<HTMLElement>(
    `[data-sticky-id="${CSS.escape(stickyId)}"]`,
  );
  const editor = card?.querySelector<HTMLElement>('[contenteditable="true"]');
  if (card && editor) {
    card.scrollIntoView({ block: "nearest" });
    editor.focus();
    return;
  }
  if (Date.now() < until) {
    requestAnimationFrame(() => focusSticky(stickyId, until));
  }
}

/** The first sticky of the workspace's unfiltered list, from any cached list. */
function firstCachedSticky(
  lists: Array<[readonly unknown[], StickyListData<Sticky> | undefined]>,
): Sticky | null {
  for (const [queryKey, data] of lists) {
    if (isSearchedStickiesKey(queryKey) || !data) continue;
    return flattenStickies(data)[0] ?? null;
  }
  return null;
}

/**
 * "Add sticky": one blank sticky at a time. A blank first sticky gets the
 * focus instead of a new one; otherwise a sticky with a random color goes on
 * top and its editor is focused.
 */
export function useAddSticky(workspaceId: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const createSticky = useCreateSticky();

  const add = useCallback(() => {
    const first = firstCachedSticky(
      queryClient.getQueriesData<StickyListData<Sticky>>({
        queryKey: stickiesKeyPrefix(workspaceId),
      }),
    );
    if (first && isBlankStickyContent(first.content)) {
      focusSticky(first.id);
      toast.info(t("stickies:toast.alreadyEmpty"));
      return;
    }

    createSticky.mutate(
      { workspaceId, color: randomStickyColor() },
      {
        onSuccess: (sticky) => focusSticky(sticky.id),
        onError: (error) => {
          toast.error(
            error instanceof HttpError && error.status === 409
              ? t("stickies:toast.limit", { count: STICKIES_LIMIT })
              : t("stickies:toast.createError"),
          );
        },
      },
    );
  }, [createSticky, queryClient, t, workspaceId]);

  return { add, isPending: createSticky.isPending };
}

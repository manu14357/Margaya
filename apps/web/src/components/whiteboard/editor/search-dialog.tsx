// These components read the board controller (history, collaborators,
// read-only state, the scene) while rendering. It is a mutable object whose
// identity never changes, so compiler memoisation would freeze those reads.
"use no memo";

import type { BoardElement, TaskCardData } from "@margaya/whiteboard";
import { Search } from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import type { BoardController } from "./controller";

export type SearchHit = {
  id: string;
  text: string;
  type: BoardElement["type"];
};

const MAX_HITS = 50;

/** The searchable text of an element: its text, frame name or task title. */
export function searchableText(
  element: BoardElement,
  task: (taskId: string) => TaskCardData | null,
): string {
  if (element.type === "frame") return element.name;
  if (element.type === "task") {
    const card = task(element.taskId);
    return card ? `${card.key} ${card.title}` : "";
  }
  return "text" in element ? element.text : "";
}

export function searchBoard(
  elements: readonly BoardElement[],
  query: string,
  task: (taskId: string) => TaskCardData | null,
): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: SearchHit[] = [];
  for (const element of elements) {
    const text = searchableText(element, task);
    if (text?.toLowerCase().includes(needle)) {
      hits.push({
        id: element.id,
        text: text.replace(/\s+/g, " ").trim(),
        type: element.type,
      });
      if (hits.length >= MAX_HITS) break;
    }
  }
  return hits;
}

export function SearchDialog({
  open,
  onOpenChange,
  controller,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controller: BoardController;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  // Results follow the board while the dialog is open: it may still be
  // syncing, and collaborators keep editing. Re-render on every scene change.
  useStore(controller.store, (state) => state.sceneVersion);
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);
  const hits = open
    ? searchBoard(controller.scene.elements, deferred, (id) =>
        controller.getTaskCard(id),
      )
    : [];
  const jump = (id: string) => {
    controller.scrollToElement(id);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("whiteboardEditor:search.title")}</DialogTitle>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-3">
          <InputGroup>
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              autoFocus
              value={query}
              placeholder={t("whiteboardEditor:search.placeholder")}
              aria-label={t("whiteboardEditor:search.placeholder")}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && hits[0]) {
                  event.preventDefault();
                  jump(hits[0].id);
                }
              }}
            />
          </InputGroup>
          {deferred.trim() && hits.length === 0 && (
            <p className="py-4 text-center text-muted-foreground text-sm">
              {t("whiteboardEditor:search.noResults")}
            </p>
          )}
          {hits.length > 0 && (
            <ul
              className="flex max-h-80 flex-col gap-0.5 overflow-y-auto"
              aria-label={t("whiteboardEditor:search.results")}
            >
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => jump(hit.id)}
                    className="flex min-h-9 w-full items-center rounded-md px-2 py-1.5 text-start text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
                  >
                    <span className="line-clamp-2 break-words">{hit.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

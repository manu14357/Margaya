// These components read the board controller (scene, selection, write
// access) while rendering. It is a mutable object whose identity never
// changes, so compiler memoisation would freeze those reads.
"use no memo";

import type { BoardElement, StickyElement } from "@margaya/whiteboard";
import { RefreshCw, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  useWhiteboardBrainstorm,
  useWhiteboardGroup,
  useWhiteboardSummarize,
} from "@/hooks/mutations/ai/use-whiteboard-ai";
import { aiErrorCode, aiErrorKey } from "@/lib/ai/format";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import {
  brainstormElements,
  brainstormSize,
  centreOf,
  findFreeSpot,
  type GroupPlan,
  groupableNotes,
  groupElements,
  groupsLayout,
  occupiedBoxes,
  summaryText,
} from "./board-ai";
import { writeClipboardText } from "./clipboard";
import { commitWithLines, textElement } from "./commands";
import type { BoardController } from "./controller";
import { visibleRect } from "./viewport";

// AI on the board. Each mode asks the API for a proposal, previews it here,
// and writes nothing until the person accepts. Accepting writes through the
// controller like a manual edit: one undo step, synced to collaborators.

export type BoardAiMode = "brainstorm" | "group" | "summarize";

const IDEA_COUNTS = [5, 8, 12] as const;

function viewportCentre(c: BoardController) {
  const { viewport, width, height } = c.state;
  const rect = visibleRect(viewport, width, height);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Brings placed elements into view without zooming in. */
function reveal(c: BoardController, placed: readonly BoardElement[]) {
  const { viewport, width, height } = c.state;
  if (placed.length === 0 || width === 0) return;
  const rect = visibleRect(viewport, width, height);
  const inside = occupiedBoxes(placed).every(
    (box) =>
      box.x >= rect.x &&
      box.y >= rect.y &&
      box.x + box.width <= rect.x + rect.width &&
      box.y + box.height <= rect.y + rect.height,
  );
  if (!inside) c.zoomToElements(placed, viewport.zoom);
}

function useErrorText() {
  const { t } = useTranslation();
  return (error: unknown) => {
    if (aiErrorCode(error)) return t(aiErrorKey(error));
    if (error instanceof HttpError && error.status === 400)
      return t("whiteboardEditor:ai.nothingToUse");
    if (error instanceof HttpError && error.status === 409)
      return t("whiteboardEditor:notices.readOnly");
    return t("ai:errors.unknown");
  };
}

function Working() {
  const { t } = useTranslation();
  return (
    <div
      className="flex items-center gap-2 py-6 text-muted-foreground text-sm"
      aria-live="polite"
    >
      <Spinner className="size-4" aria-hidden="true" />
      {t("whiteboardEditor:ai.working")}
    </div>
  );
}

function Failure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  return (
    <div className="flex flex-col items-start gap-2 py-2">
      <p role="alert" className="text-destructive text-sm">
        {errorText(error)}
      </p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <RefreshCw aria-hidden="true" />
        {t("whiteboardEditor:ai.tryAgain")}
      </Button>
    </div>
  );
}

function Note() {
  const { t } = useTranslation();
  return (
    <p className="text-muted-foreground text-xs">
      {t("ai:writing.preview.note")}
    </p>
  );
}

type BodyProps = {
  controller: BoardController;
  whiteboardId: string;
  onClose: () => void;
};

// ----- brainstorm -----------------------------------------------------------

type Idea = { key: number; text: string };

function BrainstormBody({ controller: c, whiteboardId, onClose }: BodyProps) {
  const { t } = useTranslation();
  const promptId = useId();
  const titleId = useId();
  const framedId = useId();
  const brainstorm = useWhiteboardBrainstorm();
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState<number>(8);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [title, setTitle] = useState("");
  const [framed, setFramed] = useState(true);
  const nextKey = useRef(0);

  const ask = () => {
    const text = prompt.trim();
    if (text.length < 2 || brainstorm.isPending) return;
    brainstorm.mutate(
      { whiteboardId, json: { prompt: text, count } },
      {
        onSuccess: (result) => {
          setTitle(result.title);
          setIdeas(
            result.ideas.map((idea) => ({
              key: nextKey.current++,
              text: idea,
            })),
          );
        },
      },
    );
  };

  const kept = (ideas ?? [])
    .map((idea) => idea.text.trim())
    .filter((idea) => idea.length > 0);

  const accept = () => {
    if (kept.length === 0 || !c.canWrite()) return;
    const at = findFreeSpot(
      occupiedBoxes(c.scene.elements),
      brainstormSize(kept.length),
      viewportCentre(c),
    );
    const elements = brainstormElements(
      (type, props) => c.newElement(type, props),
      { ideas: kept, title: title.trim(), framed },
      at,
    );
    if (!c.insert(elements, { select: false })) return;
    const frame = elements.find((element) => element.type === "frame");
    c.select(frame ? [frame.id] : elements.map((element) => element.id));
    reveal(c, elements);
    toast.success(t("whiteboardEditor:ai.notesAdded", { count: kept.length }));
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("whiteboardEditor:ai.brainstormTitle")}</DialogTitle>
        <DialogDescription>
          {t("whiteboardEditor:ai.brainstormDescription")}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="flex flex-col gap-4">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            ask();
          }}
        >
          <Label htmlFor={promptId}>{t("whiteboardEditor:ai.topic")}</Label>
          <Textarea
            id={promptId}
            value={prompt}
            maxLength={500}
            rows={2}
            placeholder={t("whiteboardEditor:ai.topicPlaceholder")}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                ask();
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <fieldset className="flex items-center gap-1">
              <legend className="sr-only">
                {t("whiteboardEditor:ai.ideaCount")}
              </legend>
              <span
                aria-hidden="true"
                className="text-muted-foreground text-xs"
              >
                {t("whiteboardEditor:ai.ideaCount")}
              </span>
              {IDEA_COUNTS.map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="xs"
                  variant={count === value ? "secondary" : "ghost"}
                  aria-pressed={count === value}
                  onClick={() => setCount(value)}
                >
                  {value}
                </Button>
              ))}
            </fieldset>
            <Button
              type="submit"
              size="sm"
              className="ms-auto"
              loading={brainstorm.isPending}
              disabled={prompt.trim().length < 2}
              data-testid="whiteboard-ai-generate"
            >
              {ideas
                ? t("whiteboardEditor:ai.regenerate")
                : t("whiteboardEditor:ai.generate")}
            </Button>
          </div>
        </form>

        {brainstorm.isPending && <Working />}
        {brainstorm.isError && !brainstorm.isPending && (
          <Failure error={brainstorm.error} onRetry={ask} />
        )}
        {ideas && !brainstorm.isPending && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id={framedId}
                checked={framed}
                onCheckedChange={(value) => setFramed(value === true)}
              />
              <Label htmlFor={framedId}>
                {t("whiteboardEditor:ai.putInFrame")}
              </Label>
            </div>
            {framed && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={titleId}>
                  {t("whiteboardEditor:ai.frameName")}
                </Label>
                <Input
                  id={titleId}
                  value={title}
                  maxLength={200}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
            )}
            <ul
              className="flex flex-col gap-1.5"
              aria-label={t("whiteboardEditor:ai.ideas")}
            >
              {ideas.map((idea, index) => (
                <li key={idea.key} className="flex items-center gap-1.5">
                  <Input
                    aria-label={t("whiteboardEditor:ai.ideaLabel", {
                      index: index + 1,
                    })}
                    value={idea.text}
                    maxLength={500}
                    onChange={(event) => {
                      const text = event.target.value;
                      setIdeas((current) =>
                        (current ?? []).map((entry) =>
                          entry.key === idea.key ? { ...entry, text } : entry,
                        ),
                      );
                    }}
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("whiteboardEditor:ai.removeIdea", {
                      index: index + 1,
                    })}
                    onClick={() =>
                      setIdeas((current) =>
                        (current ?? []).filter(
                          (entry) => entry.key !== idea.key,
                        ),
                      )
                    }
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
            <Note />
          </div>
        )}
      </DialogPanel>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t("whiteboardEditor:ai.discard")}
        </Button>
        <Button
          disabled={!ideas || kept.length === 0 || brainstorm.isPending}
          onClick={accept}
          data-testid="whiteboard-ai-accept"
        >
          {t("whiteboardEditor:ai.addNotes", { count: kept.length })}
        </Button>
      </DialogFooter>
    </>
  );
}

// ----- group ----------------------------------------------------------------

type DraftGroup = { key: number; title: string; elementIds: string[] };

function GroupBody({ controller: c, whiteboardId, onClose }: BodyProps) {
  const { t } = useTranslation();
  const group = useWhiteboardGroup();
  const [noteIds] = useState(() =>
    groupableNotes(c.selectedElements()).map((note) => note.id),
  );
  const [groups, setGroups] = useState<DraftGroup[] | null>(null);
  const other = t("whiteboardEditor:ai.otherGroup");

  const ask = () => {
    if (noteIds.length < 2 || group.isPending) return;
    group.mutate(
      { whiteboardId, json: { elementIds: noteIds } },
      {
        onSuccess: (result) =>
          setGroups(
            result.groups.map((entry, index) => ({
              key: index,
              title: entry.title ?? other,
              elementIds: entry.elementIds,
            })),
          ),
      },
    );
  };
  // Ask once when the dialog opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on open
  useEffect(ask, []);

  const noteText = (id: string) => {
    const note = c.get(id);
    return note?.type === "sticky" ? note.text : "";
  };

  const accept = () => {
    if (!groups || !c.canWrite()) return;
    // Notes may have changed meanwhile: use them as they are now.
    const plans: GroupPlan[] = groups
      .map((entry) => ({
        title: entry.title.trim(),
        notes: entry.elementIds
          .map((id) => c.get(id))
          .filter(
            (note): note is StickyElement =>
              note?.type === "sticky" && !note.locked,
          ),
      }))
      .filter((plan) => plan.notes.length > 0);
    if (plans.length === 0) return;
    const moved = plans.flatMap((plan) => plan.notes);
    const movedIds = new Set(moved.map((note) => note.id));
    const all = c.scene.elements as BoardElement[];
    const centre = centreOf(occupiedBoxes(moved)) ?? viewportCentre(c);
    const at = findFreeSpot(
      occupiedBoxes(all, movedIds),
      groupsLayout(plans.map((plan) => plan.notes)).size,
      centre,
    );
    const { frames, notes } = groupElements(
      (type, props) => c.newElement(type, props),
      plans,
      all,
      at,
      c.userId,
    );
    if (
      !commitWithLines(
        c,
        [...frames, ...notes],
        notes.map((note) => note.id),
      )
    )
      return;
    c.select(frames.map((frame) => frame.id));
    reveal(c, frames);
    toast.success(t("whiteboardEditor:ai.grouped", { count: frames.length }));
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("whiteboardEditor:ai.groupTitle")}</DialogTitle>
        <DialogDescription>
          {t("whiteboardEditor:ai.groupDescription", {
            count: noteIds.length,
          })}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="flex flex-col gap-3">
        {group.isPending && <Working />}
        {group.isError && !group.isPending && (
          <Failure error={group.error} onRetry={ask} />
        )}
        {groups && !group.isPending && (
          <>
            <ul
              className="flex flex-col gap-3"
              aria-label={t("whiteboardEditor:ai.themes")}
            >
              {groups.map((entry, index) => (
                <li
                  key={entry.key}
                  className="flex flex-col gap-1.5 rounded-md border p-2"
                >
                  <Input
                    aria-label={t("whiteboardEditor:ai.themeLabel", {
                      index: index + 1,
                    })}
                    value={entry.title}
                    maxLength={200}
                    onChange={(event) => {
                      const title = event.target.value;
                      setGroups((current) =>
                        (current ?? []).map((item) =>
                          item.key === entry.key ? { ...item, title } : item,
                        ),
                      );
                    }}
                  />
                  <ul className="flex flex-wrap gap-1">
                    {entry.elementIds.map((id) => (
                      <li
                        key={id}
                        className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs"
                      >
                        {noteText(id)}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            <Note />
          </>
        )}
      </DialogPanel>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t("whiteboardEditor:ai.discard")}
        </Button>
        <Button
          disabled={!groups || group.isPending}
          onClick={accept}
          data-testid="whiteboard-ai-accept"
        >
          {t("whiteboardEditor:ai.arrange", { count: groups?.length ?? 0 })}
        </Button>
      </DialogFooter>
    </>
  );
}

// ----- summarize ------------------------------------------------------------

function SummarizeBody({ controller: c, whiteboardId, onClose }: BodyProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const summaryId = useId();
  const summarize = useWhiteboardSummarize();
  const [selection] = useState(() => [...c.state.selectedIds]);
  const [draft, setDraft] = useState<{
    title: string;
    summary: string;
    elementCount: number;
  } | null>(null);
  const canWrite = !c.readOnly;

  const ask = () => {
    if (summarize.isPending) return;
    summarize.mutate(
      {
        whiteboardId,
        json: selection.length > 0 ? { elementIds: selection } : {},
      },
      { onSuccess: (result) => setDraft(result) },
    );
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on open
  useEffect(ask, []);

  const text = draft ? summaryText(draft.title, draft.summary) : "";

  const copy = () => {
    if (!text) return;
    void writeClipboardText(text).then((ok) => {
      if (ok) toast.success(t("whiteboardEditor:ai.copied"));
    });
  };

  const accept = () => {
    if (!text || !c.canWrite()) return;
    const selected = selection
      .map((id) => c.get(id))
      .filter((element): element is BoardElement => Boolean(element));
    const element = textElement(c, text, { x: 0, y: 0 });
    // Beside the selection it summarizes, or in view.
    const centre = centreOf(occupiedBoxes(selected)) ?? viewportCentre(c);
    const at = findFreeSpot(occupiedBoxes(c.scene.elements), element, centre);
    const placed = { ...element, x: at.x, y: at.y } as BoardElement;
    if (!c.insert([placed])) return;
    reveal(c, [placed]);
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {selection.length > 0
            ? t("whiteboardEditor:ai.summarizeSelectionTitle")
            : t("whiteboardEditor:ai.summarizeBoardTitle")}
        </DialogTitle>
        <DialogDescription>
          {t("whiteboardEditor:ai.summarizeDescription")}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="flex flex-col gap-3">
        {summarize.isPending && <Working />}
        {summarize.isError && !summarize.isPending && (
          <Failure error={summarize.error} onRetry={ask} />
        )}
        {draft && !summarize.isPending && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={titleId}>
                {t("whiteboardEditor:ai.summaryTitle")}
              </Label>
              <Input
                id={titleId}
                value={draft.title}
                maxLength={200}
                onChange={(event) => {
                  const title = event.target.value;
                  setDraft((current) => current && { ...current, title });
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={summaryId}>
                {t("whiteboardEditor:ai.summary")}
              </Label>
              <Textarea
                id={summaryId}
                value={draft.summary}
                rows={7}
                maxLength={4000}
                onChange={(event) => {
                  const summary = event.target.value;
                  setDraft((current) => current && { ...current, summary });
                }}
              />
            </div>
            <p className="text-muted-foreground text-xs">
              {t("whiteboardEditor:ai.madeFrom", {
                count: draft.elementCount,
              })}
            </p>
            <Note />
          </>
        )}
      </DialogPanel>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t("whiteboardEditor:ai.discard")}
        </Button>
        <Button
          variant={canWrite ? "outline" : "default"}
          disabled={!text || summarize.isPending}
          onClick={copy}
        >
          {t("whiteboardEditor:ai.copy")}
        </Button>
        {canWrite && (
          <Button
            disabled={!text || summarize.isPending}
            onClick={accept}
            data-testid="whiteboard-ai-accept"
          >
            {t("whiteboardEditor:ai.addSummary")}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

// ----- dialog ---------------------------------------------------------------

export function BoardAiDialog({
  mode,
  onClose,
  controller,
  whiteboardId,
}: {
  /** The open mode; null when closed. */
  mode: BoardAiMode | null;
  onClose: () => void;
  controller: BoardController;
  whiteboardId: string;
}) {
  const props = { controller, whiteboardId, onClose };
  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-lg" data-testid="whiteboard-ai-dialog">
        {/* Bodies mount per opening, so no proposal outlives its dialog. */}
        {mode === "brainstorm" && <BrainstormBody {...props} />}
        {mode === "group" && <GroupBody {...props} />}
        {mode === "summarize" && <SummarizeBody {...props} />}
      </DialogPopup>
    </Dialog>
  );
}

// These components read the board controller (history, collaborators,
// read-only state, the scene) while rendering. It is a mutable object whose
// identity never changes, so compiler memoisation would freeze those reads.
"use no memo";

import type { BoardElement, StickyElement } from "@margaya/whiteboard";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import useCreateTask from "@/hooks/mutations/task/use-create-task";
import { toast } from "@/lib/toast";
import type { BoardController } from "./controller";
import {
  createTasksForDrafts,
  draftsFor,
  replaceStickies,
  type StickyDraft,
} from "./stickies-to-tasks";

type TurnIntoTasksDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controller: BoardController;
  projectId: string;
  columns: readonly { id: string; name: string; slug: string }[];
};

export function TurnIntoTasksDialog({
  open,
  onOpenChange,
  controller: c,
  projectId,
  columns,
}: TurnIntoTasksDialogProps) {
  const { t } = useTranslation();
  const statusId = useId();
  const { mutateAsync: createTask } = useCreateTask();
  const [stickies, setStickies] = useState<StickyElement[]>([]);
  const [drafts, setDrafts] = useState<StickyDraft[]>([]);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  // Snapshot the selected stickies when the dialog opens.
  useEffect(() => {
    if (!open) return;
    const selected = c
      .selectedElements()
      .filter((element): element is StickyElement => element.type === "sticky");
    const first = columns[0]?.slug ?? "";
    setStickies(selected);
    setStatus((current) =>
      columns.some((column) => column.slug === current) ? current : first,
    );
    setDrafts(draftsFor(selected, first));
  }, [open, c, columns]);

  const valid = drafts.filter((draft) => draft.title.trim().length > 0);

  const submit = async () => {
    if (pending || valid.length === 0 || !status || !c.canWrite()) return;
    setPending(true);
    try {
      const { done, failed } = await createTasksForDrafts(
        valid.map((draft) => ({ ...draft, status })),
        projectId,
        (input) => createTask(input),
      );
      const byId = new Map(stickies.map((sticky) => [sticky.id, sticky]));
      const created = done.flatMap(({ stickyId, taskId }) => {
        // The sticky may have moved meanwhile: replace it where it is now.
        const current = c.get(stickyId) ?? byId.get(stickyId);
        return current?.type === "sticky" ? [{ sticky: current, taskId }] : [];
      });
      if (created.length > 0) {
        const { writes, cards } = replaceStickies(
          c.scene.elements as BoardElement[],
          created,
          c.userId,
        );
        if (c.commit(writes)) c.select([...cards.values()]);
      }
      if (failed.length > 0) {
        toast.error(
          t("whiteboardEditor:tasks.convertPartial", { count: failed.length }),
        );
      } else {
        toast.success(
          t("whiteboardEditor:tasks.converted", { count: done.length }),
        );
      }
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("whiteboardEditor:tasks.turnIntoTasksTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("whiteboardEditor:tasks.turnIntoTasksDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={statusId}>
              {t("whiteboardEditor:tasks.column")}
            </Label>
            <Select
              value={status}
              onValueChange={(value) => setStatus(String(value ?? ""))}
            >
              <SelectTrigger id={statusId} className="w-full">
                <SelectValue>
                  {columns.find((column) => column.slug === status)?.name ?? ""}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {columns.map((column) => (
                  <SelectItem key={column.id} value={column.slug}>
                    {column.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ol
            className="flex flex-col gap-2"
            aria-label={t("whiteboardEditor:tasks.titles")}
          >
            {drafts.map((draft, index) => (
              <li key={draft.stickyId} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
                  {index + 1}
                </span>
                <Input
                  aria-label={t("whiteboardEditor:tasks.taskTitle", {
                    index: index + 1,
                  })}
                  value={draft.title}
                  maxLength={500}
                  placeholder={t("whiteboardEditor:tasks.emptyTitle")}
                  onChange={(event) => {
                    const title = event.target.value;
                    setDrafts((current) =>
                      current.map((entry) =>
                        entry.stickyId === draft.stickyId
                          ? { ...entry, title }
                          : entry,
                      ),
                    );
                  }}
                />
              </li>
            ))}
          </ol>
          {drafts.length > valid.length && (
            <p className="text-muted-foreground text-xs">
              {t("whiteboardEditor:tasks.skippedEmpty")}
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("whiteboardEditor:actions.cancel")}
          </Button>
          <Button
            loading={pending}
            disabled={valid.length === 0 || !status}
            onClick={submit}
            data-testid="whiteboard-create-tasks"
          >
            {t("whiteboardEditor:tasks.createTasks", { count: valid.length })}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

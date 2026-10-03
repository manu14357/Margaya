import { type FormEvent, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePublicBoardRequestMutations } from "@/hooks/mutations/public-board/use-public-board-requests";
import { participationState } from "@/lib/public-board/participation";
import { toast } from "@/lib/toast";
import type { PublicBoard } from "@/types/public-board";
import ParticipationPrompt from "./participation-prompt";

const MAX_TITLE = 255;

type RequestDialogProps = {
  token: string;
  board: PublicBoard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenMyRequests: () => void;
};

/**
 * "Send a request to {project}": a title and optional details for the
 * project's intake. Visitors and guests get the sign-in prompt instead.
 */
export default function RequestDialog({
  token,
  board,
  open,
  onOpenChange,
  onOpenMyRequests,
}: RequestDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const state = participationState(board, "request");
  const { submit } = usePublicBoardRequestMutations(token);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");

  useEffect(() => {
    if (open) {
      setTitle("");
      setDetails("");
    }
  }, [open]);

  const send = () => {
    const trimmed = title.trim();
    if (!trimmed || submit.isPending) return;
    submit.mutate(
      {
        title: trimmed,
        ...(details.trim() ? { description: details } : {}),
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          toast.success(t("publicProject:requests.sent"), {
            action: {
              label: t("publicProject:viewer.myRequests"),
              onClick: onOpenMyRequests,
            },
          });
        },
        onError: (error) =>
          toast.error(error.message || t("publicProject:requests.error")),
      },
    );
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {t("publicProject:requests.dialogTitle", {
              project: board.project.name,
            })}
          </DialogTitle>
          <DialogDescription>
            {t("publicProject:requests.note")}
          </DialogDescription>
        </DialogHeader>
        {state.prompt === "allowed" ? (
          <form
            onSubmit={handleSubmit}
            className="flex min-h-0 flex-1 flex-col gap-4"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                send();
              }
            }}
          >
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6">
              <div className="space-y-1.5">
                <Label htmlFor={titleId}>
                  {t("publicProject:requests.titleLabel")}
                </Label>
                <Input
                  id={titleId}
                  value={title}
                  maxLength={MAX_TITLE}
                  autoFocus
                  required
                  placeholder={t("publicProject:requests.titlePlaceholder")}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <p className="font-medium text-sm">
                  {t("publicProject:requests.detailsLabel")}
                </p>
                <div className="min-h-[120px] rounded-lg border border-input">
                  <CommentEditor
                    value={details}
                    onChange={setDetails}
                    placeholder={t("publicProject:requests.detailsPlaceholder")}
                    allowFileUploads={false}
                    showQuickAttachButton={false}
                    className="[&_.margaya-comment-editor-content_.ProseMirror]:min-h-[6rem] [&_.margaya-comment-editor-content_.ProseMirror]:px-3 [&_.margaya-comment-editor-content_.ProseMirror]:py-2"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                {t("common:actions.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                loading={submit.isPending}
                disabled={!title.trim()}
              >
                {submit.isPending
                  ? t("publicProject:requests.submitting")
                  : t("publicProject:requests.submit")}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="px-6 pb-6">
            <ParticipationPrompt
              token={token}
              state={state}
              message={
                state.prompt === "blocked"
                  ? undefined
                  : t("publicProject:requests.signInPrompt")
              }
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

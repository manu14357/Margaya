import { useLocation } from "@tanstack/react-router";
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { APP_VERSION } from "@/components/version-display";
import { useSubmitFeedback } from "@/hooks/mutations/feedback/use-feedback-mutations";
import {
  feedbackClient,
  feedbackPageType,
  PAGE_TYPE_KEYS,
} from "@/lib/feedback";
import { useFeedbackDialog } from "./feedback-dialog-store";
import { RatingScale } from "./rating-scale";

export const MAX_COMMENT = 1000;

/**
 * Send feedback: a mood, an optional comment, and what goes with it (the
 * kind of page and the app version, never task content). It goes to this
 * server's admins only.
 */
export function SendFeedbackDialog() {
  const { t } = useTranslation();
  const open = useFeedbackDialog((state) => state.open);
  const setOpen = useFeedbackDialog((state) => state.setOpen);
  const pathname = useLocation({ select: (location) => location.pathname });
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { mutateAsync, isPending } = useSubmitFeedback();
  const pageType = feedbackPageType(pathname);
  const canSend = (score !== null || comment.trim() !== "") && !isPending;

  const handleOpenChange = (next: boolean) => {
    if (isPending) return;
    setOpen(next);
    if (!next) {
      setScore(null);
      setComment("");
      setSent(false);
      setError(null);
    }
  };

  const send = async () => {
    if (!canSend) return;
    setError(null);
    try {
      await mutateAsync({
        kind: "general",
        format: "faces5",
        score,
        comment: comment.trim() || undefined,
        pageType,
        appVersion: APP_VERSION,
        client: feedbackClient(),
      });
      setSent(true);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : t("settings:feedback.send.error"),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("settings:feedback.send.title")}</DialogTitle>
          <DialogDescription>
            {t("settings:feedback.send.description")}
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <DialogPanel>
            <p
              role="status"
              className="flex items-start gap-2 text-sm text-foreground"
            >
              <CircleCheck
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-success-foreground"
              />
              <span>{t("settings:feedback.send.thanks")}</span>
            </p>
          </DialogPanel>
        ) : (
          <DialogPanel>
            <form
              id="send-feedback-form"
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <div className="space-y-2">
                <p className="text-sm font-medium" id="send-feedback-mood">
                  {t("settings:feedback.send.mood")}
                </p>
                <RatingScale
                  format="faces5"
                  value={score}
                  onChange={setScore}
                  label={t("settings:feedback.send.mood")}
                  disabled={isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="send-feedback-comment">
                  {t("settings:feedback.send.comment")}
                </Label>
                <Textarea
                  id="send-feedback-comment"
                  value={comment}
                  maxLength={MAX_COMMENT}
                  rows={4}
                  disabled={isPending}
                  placeholder={t("settings:feedback.send.commentPlaceholder")}
                  onChange={(event) => setComment(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("settings:feedback.send.context", {
                    page: t(PAGE_TYPE_KEYS[pageType]),
                    version: APP_VERSION,
                  })}
                </p>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive-foreground">
                  {error}
                </p>
              )}
            </form>
          </DialogPanel>
        )}

        <DialogFooter>
          {sent ? (
            <Button onClick={() => handleOpenChange(false)}>
              {t("settings:feedback.send.done")}
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                disabled={isPending}
                onClick={() => handleOpenChange(false)}
              >
                {t("settings:feedback.send.cancel")}
              </Button>
              <Button
                type="submit"
                form="send-feedback-form"
                disabled={!canSend}
              >
                {isPending && <Spinner className="size-4" aria-hidden />}
                {t("settings:feedback.send.submit")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

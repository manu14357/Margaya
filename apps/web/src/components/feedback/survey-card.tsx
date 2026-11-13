import { useLocation } from "@tanstack/react-router";
import { CircleCheck, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { APP_VERSION, CHANGELOG_URL } from "@/components/version-display";
import {
  useDismissFeedbackSurvey,
  useSetFeedbackSurveyPreference,
  useSubmitFeedback,
} from "@/hooks/mutations/feedback/use-feedback-mutations";
import {
  feedbackClient,
  feedbackPageType,
  type SurveyFormat,
} from "@/lib/feedback";
import { RatingScale } from "./rating-scale";
import { MAX_COMMENT } from "./send-feedback-dialog";

const QUESTION_KEYS: Record<SurveyFormat, string> = {
  faces3: "settings:feedback.survey.questionMood",
  faces5: "settings:feedback.survey.questionMood",
  stars: "settings:feedback.survey.questionStars",
  nps: "settings:feedback.survey.questionNps",
};

const THANKS_VISIBLE_MS = 6000;

type SurveyCardProps = {
  format: SurveyFormat;
  onClose: () => void;
};

/**
 * The occasional survey: a small card in the corner, never a modal. It
 * doesn't take focus; closing it is a snooze, and Don't ask again stops it.
 */
export function SurveyCard({ format, onClose }: SurveyCardProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const commentId = useId();
  const pathname = useLocation({ select: (location) => location.pathname });
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);
  const submit = useSubmitFeedback();
  const dismiss = useDismissFeedbackSurvey();
  const preference = useSetFeedbackSurveyPreference();

  useEffect(() => {
    if (!sent) return;
    const timer = setTimeout(onClose, THANKS_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [sent, onClose]);

  const notNow = () => {
    if (!sent) dismiss.mutate();
    onClose();
  };

  const neverAsk = () => {
    preference.mutate(true);
    onClose();
  };

  const send = async () => {
    if (score === null) return;
    setError(false);
    try {
      await submit.mutateAsync({
        kind: "survey",
        format,
        score,
        comment: comment.trim() || undefined,
        pageType: feedbackPageType(pathname),
        appVersion: APP_VERSION,
        client: feedbackClient(),
      });
      setSent(true);
    } catch {
      setError(true);
    }
  };

  return (
    <section
      aria-labelledby={titleId}
      className="fixed right-4 bottom-20 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg min-[520px]:bottom-4"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id={titleId} className="text-sm font-medium">
          {sent
            ? t("settings:feedback.survey.thanksTitle")
            : t(QUESTION_KEYS[format])}
        </h2>
        <Button
          variant="ghost"
          size="icon-xs"
          className="-mt-1 -mr-1 shrink-0"
          aria-label={t("settings:feedback.survey.notNow")}
          onClick={notNow}
        >
          <X aria-hidden />
        </Button>
      </div>

      {sent ? (
        <div className="mt-2 space-y-2 text-sm" role="status">
          <p className="flex items-start gap-2 text-muted-foreground">
            <CircleCheck
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-success-foreground"
            />
            <span>{t("settings:feedback.survey.thanks")}</span>
          </p>
          <a
            href={CHANGELOG_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary underline-offset-4 hover:underline"
          >
            {t("settings:feedback.survey.whatsNew")}
          </a>
        </div>
      ) : (
        <form
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <RatingScale
            format={format}
            value={score}
            onChange={setScore}
            label={t(QUESTION_KEYS[format])}
            disabled={submit.isPending}
          />
          {score !== null && (
            <div className="space-y-1">
              <label
                htmlFor={commentId}
                className="text-xs text-muted-foreground"
              >
                {t("settings:feedback.survey.comment")}
              </label>
              <Textarea
                id={commentId}
                value={comment}
                rows={2}
                maxLength={MAX_COMMENT}
                disabled={submit.isPending}
                onChange={(event) => setComment(event.target.value)}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive-foreground">
              {t("settings:feedback.send.error")}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="link"
              size="xs"
              className="px-0 text-muted-foreground"
              onClick={neverAsk}
            >
              {t("settings:feedback.survey.neverAsk")}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={score === null || submit.isPending}
            >
              {t("settings:feedback.send.submit")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("settings:feedback.survey.privacy")}
          </p>
        </form>
      )}
    </section>
  );
}

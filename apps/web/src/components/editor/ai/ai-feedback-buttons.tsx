import type { AiStreamMeta } from "@margaya/libs";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { AiFeedbackInput } from "@/fetchers/ai/feedback";
import { useSendAiFeedback } from "@/hooks/mutations/ai/use-ai-assistant-mutations";
import { cn } from "@/lib/cn";

type AiFeedbackButtonsProps = {
  workspaceId: string;
  feature: AiFeedbackInput["feature"];
  /** The rated answer's provider and model, when the stream sent them. */
  meta?: AiStreamMeta | null;
  /** A new answer (another key) can be rated again. */
  answerKey?: unknown;
  className?: string;
};

/**
 * 👍 / 👎 on an AI answer. Only the rating and the model are sent, never
 * the text. One rating per answer; a failed send lets the person retry.
 */
export default function AiFeedbackButtons({
  workspaceId,
  feature,
  meta,
  answerKey,
  className,
}: AiFeedbackButtonsProps) {
  const { t } = useTranslation();
  const send = useSendAiFeedback();
  const [rating, setRating] = useState<1 | -1 | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new answer resets the rating
  useEffect(() => {
    setRating(null);
  }, [answerKey]);

  const rate = (value: 1 | -1) => {
    if (rating !== null || send.isPending) return;
    setRating(value);
    send.mutate(
      {
        workspaceId,
        feature,
        rating: value,
        ...(meta?.provider ? { provider: meta.provider } : {}),
        ...(meta?.model ? { model: meta.model } : {}),
      },
      { onError: () => setRating(null) },
    );
  };

  if (rating !== null) {
    return (
      <span
        role="status"
        className={cn("text-muted-foreground text-xs", className)}
      >
        {t("ai:writing.feedback.thanks")}
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("ai:writing.feedback.good")}
        title={t("ai:writing.feedback.good")}
        disabled={send.isPending}
        onClick={() => rate(1)}
      >
        <ThumbsUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("ai:writing.feedback.bad")}
        title={t("ai:writing.feedback.bad")}
        disabled={send.isPending}
        onClick={() => rate(-1)}
      >
        <ThumbsDown />
      </Button>
    </span>
  );
}

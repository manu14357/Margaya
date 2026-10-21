import { MessageCircleQuestion, Send } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  useFollowUpAgentRun,
  useReplyToAgentRun,
} from "@/hooks/mutations/ai/use-agent-mutations";
import { toast } from "@/lib/toast";

const MAX_TEXT = 4_000;

/**
 * A run that needs input: the agent's question, its suggested answers as
 * buttons and a free reply. Answering continues the same run.
 */
export function NeedsInputPanel({
  workspaceId,
  runId,
  question,
}: {
  workspaceId: string;
  runId: string;
  question: { text: string; options: string[] };
}) {
  const { t } = useTranslation();
  const id = useId();
  const reply = useReplyToAgentRun();
  const [text, setText] = useState("");

  const send = async (answer: string) => {
    const value = answer.trim();
    if (!value) return;
    try {
      await reply.mutateAsync({ workspaceId, runId, text: value });
      setText("");
      toast.success(t("ai:agents.needsInput.sent"));
    } catch {
      toast.error(t("ai:agents.needsInput.error"));
    }
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3"
    >
      <h3
        id={`${id}-title`}
        className="flex items-center gap-1.5 font-medium text-xs"
      >
        <MessageCircleQuestion className="size-3.5" aria-hidden />
        {t("ai:agents.needsInput.title")}
      </h3>
      <p className="whitespace-pre-wrap break-words text-sm">{question.text}</p>
      {question.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {question.options.map((option) => (
            <Button
              key={option}
              size="xs"
              variant="outline"
              disabled={reply.isPending}
              onClick={() => void send(option)}
            >
              {option}
            </Button>
          ))}
        </div>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send(text);
        }}
      >
        <label htmlFor={`${id}-answer`} className="sr-only">
          {t("ai:agents.needsInput.answerLabel")}
        </label>
        <Textarea
          id={`${id}-answer`}
          value={text}
          rows={2}
          maxLength={MAX_TEXT}
          placeholder={t("ai:agents.needsInput.placeholder")}
          onChange={(event) => setText(event.target.value)}
        />
        <Button
          type="submit"
          size="xs"
          className="w-fit"
          loading={reply.isPending}
          disabled={!text.trim()}
        >
          <Send aria-hidden />
          {t("ai:agents.needsInput.reply")}
        </Button>
      </form>
      <p className="text-muted-foreground text-xs">
        {t("ai:agents.needsInput.hint")}
      </p>
    </section>
  );
}

/**
 * Chat with the agent after a run ended: a follow-up starts a new run of
 * the same agent with this run's summary as context.
 */
export function FollowUpBox({
  workspaceId,
  runId,
  onStarted,
}: {
  workspaceId: string;
  runId: string;
  onStarted: (runId: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const followUp = useFollowUpAgentRun();
  const [text, setText] = useState("");

  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    try {
      const run = await followUp.mutateAsync({
        workspaceId,
        runId,
        text: value,
      });
      setText("");
      onStarted(run.id);
    } catch {
      toast.error(t("ai:agents.followUp.error"));
    }
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label
        htmlFor={`${id}-text`}
        className="font-medium text-muted-foreground text-xs"
      >
        {t("ai:agents.followUp.label")}
      </label>
      <Textarea
        id={`${id}-text`}
        value={text}
        rows={2}
        maxLength={MAX_TEXT}
        placeholder={t("ai:agents.followUp.placeholder")}
        onChange={(event) => setText(event.target.value)}
      />
      <Button
        type="submit"
        size="xs"
        variant="outline"
        className="w-fit"
        loading={followUp.isPending}
        disabled={!text.trim()}
      >
        <Send aria-hidden />
        {t("ai:agents.followUp.send")}
      </Button>
    </form>
  );
}

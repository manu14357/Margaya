import { useFeedbackConfig } from "@/hooks/queries/feedback/use-feedback";
import { SendFeedbackDialog } from "./send-feedback-dialog";
import { SurveyCard } from "./survey-card";
import { useSurveyTrigger } from "./use-survey-trigger";

/**
 * Mounted once by the app shell: the Send feedback dialog and, now and then,
 * the survey card. Renders nothing while the instance has feedback off.
 */
export function FeedbackHost() {
  const { data: config } = useFeedbackConfig();
  const survey = useSurveyTrigger();
  if (!config?.enabled) return null;
  return (
    <>
      <SendFeedbackDialog />
      {survey.format && (
        <SurveyCard format={survey.format} onClose={survey.close} />
      )}
    </>
  );
}

/** Whether Send feedback should be offered (help menu, command palette). */
export function useFeedbackAvailable() {
  const { data: config } = useFeedbackConfig();
  return config?.enabled === true;
}

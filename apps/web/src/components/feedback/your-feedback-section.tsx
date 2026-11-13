import { Download, MessageSquareHeart, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSection,
} from "@/components/settings-layout";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { listOwnFeedback } from "@/fetchers/feedback/feedback";
import {
  downloadOwnFeedback,
  useDeleteOwnFeedback,
  useSetFeedbackSurveyPreference,
} from "@/hooks/mutations/feedback/use-feedback-mutations";
import { useFeedbackConfig } from "@/hooks/queries/feedback/use-feedback";
import { toast } from "@/lib/toast";
import { openFeedbackDialog } from "./feedback-dialog-store";

/**
 * Account → Preferences: the survey on or off for me, Send feedback, and a
 * copy or deletion of everything I sent (it stays on this server).
 */
export function YourFeedbackSection() {
  const { t } = useTranslation();
  const { data: config } = useFeedbackConfig();
  const preference = useSetFeedbackSurveyPreference();
  const remove = useDeleteOwnFeedback();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  if (!config?.enabled) return null;

  const download = async () => {
    setDownloading(true);
    try {
      const { items } = await listOwnFeedback();
      downloadOwnFeedback(items);
    } catch {
      toast.error(t("settings:feedback.mine.downloadError"));
    } finally {
      setDownloading(false);
    }
  };

  const deleteAll = async () => {
    try {
      const result = await remove.mutateAsync();
      toast.success(
        t("settings:feedback.mine.deleted", { count: result.deleted }),
      );
    } catch {
      toast.error(t("settings:feedback.mine.deleteError"));
    }
  };

  return (
    <SettingsSection
      title={t("settings:feedback.mine.title")}
      description={t("settings:feedback.mine.description")}
    >
      <SettingsGroup>
        {config.survey.enabled && (
          <SettingsRow
            label={t("settings:feedback.mine.survey")}
            description={t("settings:feedback.mine.surveyDescription")}
            htmlFor="preference-feedback-survey"
          >
            <Switch
              id="preference-feedback-survey"
              checked={!config.survey.optedOut}
              disabled={preference.isPending}
              onCheckedChange={(on) => preference.mutate(!on)}
            />
          </SettingsRow>
        )}
        <SettingsRow
          label={t("settings:feedback.mine.send")}
          description={t("settings:feedback.mine.sendDescription")}
        >
          <Button variant="outline" size="sm" onClick={openFeedbackDialog}>
            <MessageSquareHeart aria-hidden />
            {t("settings:feedback.send.menuItem")}
          </Button>
        </SettingsRow>
        <SettingsRow
          label={t("settings:feedback.mine.data")}
          description={t("settings:feedback.mine.dataDescription")}
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={downloading}
              onClick={() => void download()}
            >
              <Download aria-hidden />
              {t("settings:feedback.mine.download")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={remove.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 aria-hidden />
              {t("settings:feedback.mine.delete")}
            </Button>
          </div>
        </SettingsRow>
      </SettingsGroup>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:feedback.mine.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:feedback.mine.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("settings:feedback.admin.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void deleteAll()}
                />
              }
            >
              {t("settings:feedback.mine.deleteConfirm")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}

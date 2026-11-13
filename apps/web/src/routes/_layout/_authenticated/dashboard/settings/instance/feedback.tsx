import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { FeedbackResponsesSection } from "@/components/feedback/admin/feedback-responses-section";
import { FeedbackSettingsSection } from "@/components/feedback/admin/feedback-settings-section";
import { FeedbackSummarySection } from "@/components/feedback/admin/feedback-summary-section";
import { InstancePage } from "@/components/instance-admin/instance-page";
import { useInstanceSettings } from "@/hooks/queries/instance-admin/use-instance-admin";

const searchSchema = z.object({
  format: z
    .enum(["faces3", "faces5", "stars", "nps", "thumbs"])
    .optional()
    .catch(undefined),
  days: z.coerce
    .number()
    .refine((value) => [30, 90, 180, 365].includes(value))
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/instance/feedback",
)({
  validateSearch: searchSchema,
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const settings = useInstanceSettings();
  const { format, days = 180 } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <InstancePage
      title={t("settings:feedback.admin.title")}
      subtitle={t("settings:feedback.admin.subtitle")}
      locked={settings.data?.locked}
    >
      <FeedbackSettingsSection />
      <FeedbackSummarySection
        format={format}
        days={days}
        onFormatChange={(next) =>
          navigate({
            search: { format: next, days },
            replace: true,
          })
        }
        onDaysChange={(next) =>
          navigate({
            search: { format, days: next },
            replace: true,
          })
        }
      />
      <FeedbackResponsesSection />
    </InstancePage>
  );
}

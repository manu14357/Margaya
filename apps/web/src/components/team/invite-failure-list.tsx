import { CircleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { InviteFailure } from "@/lib/invite-emails";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";

/** The addresses a bulk invite could not reach, each with the reason. */
function InviteFailureList({ failures }: { failures: InviteFailure[] }) {
  const { t } = useTranslation();
  if (failures.length === 0) return null;
  return (
    <Alert variant="error">
      <CircleAlertIcon aria-hidden />
      <AlertTitle>{t("team:inviteModal.failedTitle")}</AlertTitle>
      <AlertDescription>
        <ul className="space-y-1">
          {failures.map((failure) => (
            <li key={failure.email} className="min-w-0 text-xs">
              <span className="break-all font-medium text-foreground">
                {failure.email}
              </span>
              <span className="text-muted-foreground">
                {" "}
                · {failure.message}
              </span>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

export default InviteFailureList;

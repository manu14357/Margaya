import { useTranslation } from "react-i18next";

/** The "or" rule between the provider buttons and the email form. */
export function AuthDivider() {
  const { t } = useTranslation();
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
      <div className="h-px flex-1 bg-border" />
      <span>{t("auth:forms.or")}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

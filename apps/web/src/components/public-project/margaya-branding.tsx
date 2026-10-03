import { useTranslation } from "react-i18next";
import { PUBLIC_SITE_URL } from "@/constants/urls";

export function MargayaBranding() {
  const { t } = useTranslation();

  return (
    <a
      href={PUBLIC_SITE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-foreground transition-colors"
    >
      {t("publicProject:branding.poweredBy")}{" "}
      <span className="font-medium">{t("common:appName")}</span>
    </a>
  );
}

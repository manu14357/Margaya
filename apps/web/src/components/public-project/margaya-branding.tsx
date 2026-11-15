import { useTranslation } from "react-i18next";
import { PUBLIC_SITE_URL } from "@/constants/urls";

export function MargayaBranding() {
  const { t } = useTranslation();

  return (
    <a
      href={PUBLIC_SITE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="relative transition-colors hover:text-foreground pointer-coarse:after:absolute pointer-coarse:after:-inset-y-3.5 pointer-coarse:after:inset-x-0"
    >
      {t("publicProject:branding.poweredBy")}{" "}
      <span className="font-medium">{t("common:appName")}</span>
    </a>
  );
}

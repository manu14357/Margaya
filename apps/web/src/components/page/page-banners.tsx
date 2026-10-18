import { Archive, CloudOff, FileWarning, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type PageBannerState = {
  isLocked: boolean;
  isArchived: boolean;
  canLock: boolean;
  canArchive: boolean;
  /** Public page, but no page:update. */
  readOnlyByRole: boolean;
  tooLarge: boolean;
  /** The stored copy shows because live sync is unavailable. */
  storedCopy: boolean;
};

type PageBannersProps = PageBannerState & {
  onUnlock: () => void;
  onRestore: () => void;
  onReload: () => void;
  onRetry: () => void;
};

/** The notices above the title (§1.5), most important first. */
export default function PageBanners({
  isLocked,
  isArchived,
  canLock,
  canArchive,
  readOnlyByRole,
  tooLarge,
  storedCopy,
  onUnlock,
  onRestore,
  onReload,
  onRetry,
}: PageBannersProps) {
  const { t } = useTranslation();

  return (
    <div className="my-4 space-y-2 empty:hidden print:hidden">
      {tooLarge && (
        <Alert variant="error">
          <FileWarning />
          <AlertTitle>{t("pages:banners.tooLarge")}</AlertTitle>
          <AlertAction>
            <Button size="xs" variant="outline" onClick={onReload}>
              {t("pages:banners.reload")}
            </Button>
          </AlertAction>
        </Alert>
      )}
      {isArchived && (
        <Alert variant="info">
          <Archive />
          <AlertTitle>{t("pages:banners.archived")}</AlertTitle>
          {canArchive && (
            <AlertAction>
              <Button size="xs" variant="outline" onClick={onRestore}>
                {t("pages:banners.restore")}
              </Button>
            </AlertAction>
          )}
        </Alert>
      )}
      {isLocked && !isArchived && (
        <Alert variant="warning">
          <Lock />
          <AlertTitle>{t("pages:banners.locked")}</AlertTitle>
          {canLock && (
            <AlertAction>
              <Button size="xs" variant="outline" onClick={onUnlock}>
                {t("pages:banners.unlock")}
              </Button>
            </AlertAction>
          )}
        </Alert>
      )}
      {storedCopy && !tooLarge && (
        <Alert variant="info">
          <CloudOff />
          <AlertTitle>{t("pages:banners.storedCopy")}</AlertTitle>
          <AlertAction>
            <Button size="xs" variant="outline" onClick={onRetry}>
              {t("pages:banners.retry")}
            </Button>
          </AlertAction>
        </Alert>
      )}
      {readOnlyByRole && !isLocked && !isArchived && (
        <p className="text-muted-foreground text-sm">
          {t("pages:banners.readOnly")}
        </p>
      )}
    </div>
  );
}

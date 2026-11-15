import { Archive, CloudOff, Eye, FileWarning, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type WhiteboardBannerState = {
  isLocked: boolean;
  isArchived: boolean;
  /** Lock, unlock, archive and restore this board. */
  canManage: boolean;
  /** No whiteboard:update: view only, board otherwise open. */
  readOnlyByRole: boolean;
  tooLarge: boolean;
  /** The stored copy shows because the live board can't be reached. */
  storedCopy: boolean;
  lockedByName: string | null;
};

type WhiteboardBannersProps = WhiteboardBannerState & {
  onUnlock: () => void;
  onRestore: () => void;
  onReload: () => void;
  onRetry: () => void;
};

/** Why the board is read-only (or can't save), most important first. */
export default function WhiteboardBanners({
  isLocked,
  isArchived,
  canManage,
  readOnlyByRole,
  tooLarge,
  storedCopy,
  lockedByName,
  onUnlock,
  onRestore,
  onReload,
  onRetry,
}: WhiteboardBannersProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2 px-3 pt-2 empty:hidden">
      {tooLarge && (
        <Alert variant="error">
          <FileWarning />
          <AlertTitle>{t("whiteboards:banners.tooLarge")}</AlertTitle>
          <AlertAction>
            <Button size="xs" variant="outline" onClick={onReload}>
              {t("whiteboards:banners.reload")}
            </Button>
          </AlertAction>
        </Alert>
      )}
      {isArchived && (
        <Alert variant="info">
          <Archive />
          <AlertTitle>{t("whiteboards:banners.archived")}</AlertTitle>
          {canManage && (
            <AlertAction>
              <Button size="xs" variant="outline" onClick={onRestore}>
                {t("whiteboards:banners.restore")}
              </Button>
            </AlertAction>
          )}
        </Alert>
      )}
      {isLocked && !isArchived && (
        <Alert variant="warning">
          <Lock />
          <AlertTitle>
            {lockedByName
              ? t("whiteboards:banners.lockedBy", { name: lockedByName })
              : t("whiteboards:banners.locked")}
          </AlertTitle>
          {canManage && (
            <AlertAction>
              <Button size="xs" variant="outline" onClick={onUnlock}>
                {t("whiteboards:banners.unlock")}
              </Button>
            </AlertAction>
          )}
        </Alert>
      )}
      {readOnlyByRole && !isLocked && !isArchived && (
        <Alert variant="info">
          <Eye />
          <AlertTitle>{t("whiteboards:banners.readOnly")}</AlertTitle>
        </Alert>
      )}
      {storedCopy && !tooLarge && (
        <Alert variant="warning">
          <CloudOff />
          <AlertTitle>{t("whiteboards:banners.storedCopy")}</AlertTitle>
          <AlertAction>
            <Button size="xs" variant="outline" onClick={onRetry}>
              {t("whiteboards:banners.retry")}
            </Button>
          </AlertAction>
        </Alert>
      )}
    </div>
  );
}

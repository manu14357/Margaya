import { CalendarPlus, Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { isDesktopApp } from "@/lib/desktop";
import { toast } from "@/lib/toast";

type CalendarFeedLinkDialogProps = {
  /** The feed just created or regenerated; null keeps the dialog closed. */
  link: { url: string; webcalUrl: string; name: string } | null;
  onClose: () => void;
};

/**
 * Shows a new feed URL once, with how to add it to a calendar app. The API
 * stores only a hash, so this is the one chance to copy it.
 */
export function CalendarFeedLinkDialog({
  link,
  onClose,
}: CalendarFeedLinkDialogProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  // The desktop shell opens only web, mail and phone links outside the app.
  const canOpenCalendarApp = !isDesktopApp();

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      toast.success(t("settings:calendarFeed.toast.copied"));
    } catch {
      toast.error(t("settings:calendarFeed.toast.copyError"));
    }
  };

  return (
    <Dialog
      open={link !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings:calendarFeed.link.title")}</DialogTitle>
          <DialogDescription>{link?.name}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="calendar-feed-url"
              className="font-medium text-foreground text-xs"
            >
              {t("settings:calendarFeed.link.label")}
            </label>
            <div className="flex gap-2">
              <Input
                id="calendar-feed-url"
                readOnly
                value={link?.url ?? ""}
                className="font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button variant="outline" onClick={copy}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied
                  ? t("settings:calendarFeed.actions.copied")
                  : t("settings:calendarFeed.actions.copy")}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              {t("settings:calendarFeed.link.once")}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <h3 className="font-medium text-foreground text-sm">
              {t("settings:calendarFeed.howTo.title")}
            </h3>
            <ol className="list-decimal space-y-1 ps-5 text-muted-foreground text-sm">
              <li>{t("settings:calendarFeed.howTo.step1")}</li>
              <li>{t("settings:calendarFeed.howTo.step2")}</li>
              <li>{t("settings:calendarFeed.howTo.step3")}</li>
            </ol>
          </div>

          <Alert>
            <AlertDescription>
              {t("settings:calendarFeed.privacy")}
            </AlertDescription>
          </Alert>
        </DialogPanel>
        <DialogFooter>
          {canOpenCalendarApp && link && (
            <Button variant="outline" render={<a href={link.webcalUrl} />}>
              <CalendarPlus aria-hidden />
              {t("settings:calendarFeed.actions.open")}
            </Button>
          )}
          <Button
            onClick={() => {
              setCopied(false);
              onClose();
            }}
          >
            {t("settings:calendarFeed.actions.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

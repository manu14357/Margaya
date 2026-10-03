import { Copy, ExternalLink } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";

/** The public link, read-only, with Copy and Open (new tab). */
export default function PublishLinkField({ url }: { url: string }) {
  const { t } = useTranslation();
  const inputId = useId();

  const copy = () => {
    if (!url) return;
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success(t("settings:projectPublish.link.copied")))
      .catch(() => toast.error(t("publicProject:copyUrl.errorToast")));
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={inputId} className="text-sm font-medium">
          {t("settings:projectPublish.link.label")}
        </Label>
        <p className="text-xs text-muted-foreground">
          {t("settings:projectPublish.link.hint")}
        </p>
      </div>
      <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
        <Input
          id={inputId}
          readOnly
          value={url}
          className="w-full sm:w-96"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button size="sm" onClick={copy} disabled={!url}>
          <Copy className="size-3.5" />
          {t("settings:projectPublish.link.copy")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          render={<a href={url} target="_blank" rel="noopener noreferrer" />}
        >
          <ExternalLink className="size-3.5" />
          {t("settings:projectPublish.link.open")}
        </Button>
      </div>
    </div>
  );
}

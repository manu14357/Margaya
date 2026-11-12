import { Copy, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";

/** A read-only value with Copy, and Open when it is a link. */
export default function CopyField({
  id,
  value,
  openable = false,
}: {
  id: string;
  value: string;
  openable?: boolean;
}) {
  const { t } = useTranslation();

  const copy = () => {
    navigator.clipboard
      .writeText(value)
      .then(() => toast.success(t("settings:projectIntake.copied")))
      .catch(() => toast.error(t("publicProject:copyUrl.errorToast")));
  };

  return (
    <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
      <Input
        id={id}
        readOnly
        value={value}
        className="w-full font-mono text-xs sm:w-96"
        onFocus={(event) => event.currentTarget.select()}
      />
      <Button size="sm" variant="outline" onClick={copy}>
        <Copy className="size-3.5" />
        {t("settings:projectIntake.copy")}
      </Button>
      {openable && (
        <Button
          size="sm"
          variant="outline"
          render={<a href={value} target="_blank" rel="noopener noreferrer" />}
        >
          <ExternalLink className="size-3.5" />
          {t("settings:projectIntake.open")}
        </Button>
      )}
    </div>
  );
}

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { toast } from "@/lib/toast";

type CopyFieldProps = { id: string; value: string };

/** A read-only value with a Copy button (the OAuth callback URL). */
export function CopyField({ id, value }: CopyFieldProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (await copyToClipboard(value)) {
      setCopied(true);
      toast.success(t("instanceAdmin:oauth.copied"));
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Input id={id} value={value} readOnly className="font-mono text-xs" />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void handleCopy()}
      >
        {copied ? <Check /> : <Copy />}
        {copied
          ? t("instanceAdmin:oauth.copied")
          : t("instanceAdmin:oauth.copy")}
      </Button>
    </div>
  );
}

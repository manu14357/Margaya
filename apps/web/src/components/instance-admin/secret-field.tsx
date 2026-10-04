import { KeyRound, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { secretFieldState } from "@/lib/instance-settings";
import type { InstanceSettingEntry } from "@/types/instance-admin";

type SecretFieldProps = {
  id: string;
  entry: Pick<InstanceSettingEntry, "configured" | "unreadable">;
  /** The new value being typed; the stored value never reaches the browser. */
  value: string;
  onChange: (value: string) => void;
  /** Clears the stored secret right away. */
  onClear: () => void;
  disabled?: boolean;
  clearing?: boolean;
};

/**
 * A write-only secret: shows whether one is saved, never its value. Replace
 * reveals an empty input; Clear removes the saved value.
 */
export function SecretField({
  id,
  entry,
  value,
  onChange,
  onClear,
  disabled = false,
  clearing = false,
}: SecretFieldProps) {
  const { t } = useTranslation();
  const [replacing, setReplacing] = useState(false);
  const state = secretFieldState(entry, replacing);

  const input = (
    <Input
      id={id}
      type="password"
      autoComplete="new-password"
      placeholder={t("instanceAdmin:secret.placeholder")}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );

  if (state === "saved") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span
          id={id}
          className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-sm text-muted-foreground"
        >
          <KeyRound className="size-3.5" aria-hidden />
          <span aria-hidden>••••••••</span>
          {t("instanceAdmin:secret.saved")}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => {
            onChange("");
            setReplacing(true);
          }}
        >
          {t("instanceAdmin:secret.replace")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || clearing}
          loading={clearing}
          onClick={onClear}
        >
          {t("instanceAdmin:secret.clear")}
        </Button>
      </div>
    );
  }

  if (state === "unreadable") {
    return (
      <div className="space-y-2">
        <p className="flex items-start gap-1.5 text-xs text-warning-foreground">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          {t("instanceAdmin:secret.unreadable")}
        </p>
        <div className="flex items-center gap-2">
          {input}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || clearing}
            loading={clearing}
            onClick={onClear}
          >
            {t("instanceAdmin:secret.clear")}
          </Button>
        </div>
      </div>
    );
  }

  if (state === "replacing") {
    return (
      <div className="flex items-center gap-2">
        {input}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => {
            onChange("");
            setReplacing(false);
          }}
        >
          {t("instanceAdmin:secret.cancel")}
        </Button>
      </div>
    );
  }

  return input;
}

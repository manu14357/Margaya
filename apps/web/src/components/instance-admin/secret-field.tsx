import { FileUp, KeyRound, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
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
  /**
   * A multi-line secret such as a PEM key: a text area (a password input
   * would drop the line breaks) and a button that loads a file of `accept`.
   */
  multiline?: { accept: string; placeholder?: string };
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
  multiline,
}: SecretFieldProps) {
  const { t } = useTranslation();
  const [replacing, setReplacing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const state = secretFieldState(entry, replacing);

  const loadFile = async (file: File | undefined) => {
    if (file) onChange(await file.text());
  };

  const input = multiline ? (
    <div className="w-full min-w-0 space-y-2">
      <Textarea
        id={id}
        rows={5}
        autoComplete="off"
        spellCheck={false}
        className="font-mono text-xs"
        placeholder={
          multiline.placeholder ?? t("instanceAdmin:secret.placeholder")
        }
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <input
        ref={fileInput}
        type="file"
        accept={multiline.accept}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          void loadFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => fileInput.current?.click()}
      >
        <FileUp aria-hidden />
        {t("instanceAdmin:secret.loadFile")}
      </Button>
    </div>
  ) : (
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
  // A text area stacks its buttons below instead of beside it.
  const row = cn(
    "flex gap-2",
    multiline ? "flex-col items-start" : "items-center",
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
        <div className={row}>
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
      <div className={row}>
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

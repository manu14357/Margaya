import { TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  clearSmtpPatch,
  indexSettings,
  isSettingLocked,
  isValidFromAddress,
  isValidSmtpHost,
  isValidSmtpPort,
  SMTP_KEYS,
  type SmtpFormValues,
  type SmtpSecurity,
  smtpFormValues,
  smtpPatch,
} from "@/lib/instance-settings";
import type { InstanceSettings } from "@/types/instance-admin";
import { LockedCallout } from "./locked-callout";
import { SecretField } from "./secret-field";
import { SourceBadge } from "./source-badge";
import { useSaveInstanceSettings } from "./use-save-instance-settings";

const SECURITY_LABELS: Record<SmtpSecurity, string> = {
  tls: "instanceAdmin:email.securityTls",
  starttls: "instanceAdmin:email.securityStarttls",
  none: "instanceAdmin:email.securityNone",
};

type SmtpFormProps = {
  settings: InstanceSettings;
  onSendTest: () => void;
};

/**
 * The SMTP settings. Saves only what changed; the test email uses the saved
 * settings, so it waits until the form is saved.
 */
export function SmtpForm({ settings, onSendTest }: SmtpFormProps) {
  const { t } = useTranslation();
  const index = indexSettings(settings);
  const [initial, setInitial] = useState(() => smtpFormValues(index));
  const [values, setValues] = useState<SmtpFormValues>(initial);
  const [password, setPassword] = useState("");
  const [clearing, setClearing] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const { save, isPending } = useSaveInstanceSettings();

  const passwordEntry = index.get("smtp.password");
  const envManaged = index.get("smtp.host")?.source === "environment";
  const locked = isSettingLocked(settings, index.get("smtp.host"));
  const hasSavedValues = SMTP_KEYS.some(
    (key) => index.get(key)?.source === "database",
  );

  const errors = {
    host: !isValidSmtpHost(values.host),
    port: !isValidSmtpPort(values.port),
    from: !isValidFromAddress(values.from),
  };
  const valid = !errors.host && !errors.port && !errors.from;
  const patch = smtpPatch(values, initial, password);
  const dirty = Object.keys(patch).length > 0;

  const set = <K extends keyof SmtpFormValues>(
    key: K,
    value: SmtpFormValues[K],
  ) => setValues((current) => ({ ...current, [key]: value }));

  const handleSave = async () => {
    if (!valid || !dirty) return;
    if (await save(patch)) {
      setInitial(values);
      setPassword("");
    }
  };

  const handleClearPassword = async () => {
    setClearing(true);
    await save({ "smtp.password": null }, t("instanceAdmin:secret.cleared"));
    setClearing(false);
  };

  const handleRemove = async () => {
    if (await save(clearSmtpPatch(), t("instanceAdmin:email.removed"))) {
      const cleared: SmtpFormValues = {
        host: "",
        port: "",
        security: "tls",
        user: "",
        from: "",
      };
      setInitial(cleared);
      setValues(cleared);
      setPassword("");
    }
  };

  const field = (
    key: "host" | "port" | "user" | "from",
    label: string,
    options: {
      hint?: string;
      error?: string | false;
      placeholder?: string;
      inputMode?: "numeric";
    } = {},
  ) => {
    const id = `smtp-${key}`;
    const entry = index.get(`smtp.${key}`);
    return (
      <FieldBlock
        id={id}
        label={label}
        badge={entry && !envManaged ? <SourceBadge entry={entry} /> : null}
        hint={options.error || options.hint}
        error={Boolean(options.error)}
      >
        <Input
          id={id}
          value={values[key]}
          disabled={locked}
          inputMode={options.inputMode}
          placeholder={options.placeholder}
          autoComplete="off"
          aria-invalid={Boolean(options.error) || undefined}
          onChange={(event) => set(key, event.target.value)}
        />
      </FieldBlock>
    );
  };

  const testButton = (
    <Button
      type="button"
      variant="outline"
      disabled={dirty || !settings.derived.smtpConfigured}
      onClick={onSendTest}
    >
      {t("instanceAdmin:email.sendTest")}
    </Button>
  );

  return (
    <div className="space-y-4">
      {envManaged && (
        <LockedCallout>{t("instanceAdmin:email.managedByEnv")}</LockedCallout>
      )}

      <div className="grid gap-4 rounded-md border border-border bg-card p-4 sm:grid-cols-2">
        {field("host", t("instanceAdmin:email.host"), {
          error: errors.host && t("instanceAdmin:email.hostInvalid"),
          placeholder: "smtp.example.com",
        })}
        {field("port", t("instanceAdmin:email.port"), {
          hint: t("instanceAdmin:email.portHint"),
          error: errors.port && t("instanceAdmin:email.portInvalid"),
          inputMode: "numeric",
        })}
        <FieldBlock
          id="smtp-security"
          label={t("instanceAdmin:email.security")}
          hint={
            values.security === "none"
              ? t("instanceAdmin:email.securityNoneWarning")
              : undefined
          }
          warning={values.security === "none"}
        >
          <Select
            value={values.security}
            disabled={locked}
            onValueChange={(value) => set("security", value as SmtpSecurity)}
          >
            <SelectTrigger id="smtp-security">
              <SelectValue>{t(SECURITY_LABELS[values.security])}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SECURITY_LABELS) as SmtpSecurity[]).map(
                (security) => (
                  <SelectItem key={security} value={security}>
                    {t(SECURITY_LABELS[security])}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </FieldBlock>
        {field("user", t("instanceAdmin:email.username"))}
        {passwordEntry && (
          <FieldBlock
            id="smtp-password"
            label={t("instanceAdmin:email.password")}
            badge={
              !envManaged && passwordEntry.source === "database" ? (
                <SourceBadge entry={passwordEntry} />
              ) : null
            }
          >
            <SecretField
              key={`${passwordEntry.updatedAt}-${passwordEntry.configured}`}
              id="smtp-password"
              entry={passwordEntry}
              value={password}
              onChange={setPassword}
              onClear={() => void handleClearPassword()}
              clearing={clearing}
              disabled={locked}
            />
          </FieldBlock>
        )}
        {field("from", t("instanceAdmin:email.from"), {
          hint: t("instanceAdmin:email.fromHint"),
          error: errors.from && t("instanceAdmin:email.fromInvalid"),
          placeholder: "Margaya <no-reply@example.com>",
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!locked && (
          <Button
            type="button"
            disabled={!dirty || !valid}
            loading={isPending && !clearing}
            onClick={() => void handleSave()}
          >
            {t("instanceAdmin:email.save")}
          </Button>
        )}
        {dirty ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                {testButton}
              </TooltipTrigger>
              <TooltipContent>
                {t("instanceAdmin:email.saveFirst")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          testButton
        )}
        {!locked && hasSavedValues && (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive-foreground sm:ml-auto"
            onClick={() => setRemoveOpen(true)}
          >
            {t("instanceAdmin:email.remove")}
          </Button>
        )}
      </div>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("instanceAdmin:email.removeTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("instanceAdmin:email.removeDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void handleRemove()}
                />
              }
            >
              {t("instanceAdmin:email.removeConfirm")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type FieldBlockProps = {
  id: string;
  label: string;
  badge?: ReactNode;
  hint?: string;
  error?: boolean;
  warning?: boolean;
  children: ReactNode;
};

function FieldBlock({
  id,
  label,
  badge,
  hint,
  error = false,
  warning = false,
  children,
}: FieldBlockProps) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id}>{label}</Label>
        {badge}
      </div>
      {children}
      {hint && (
        <p
          className={
            error
              ? "text-xs text-destructive-foreground"
              : warning
                ? "flex items-start gap-1 text-xs text-warning-foreground"
                : "text-xs text-muted-foreground"
          }
        >
          {warning && (
            <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          )}
          {hint}
        </p>
      )}
    </div>
  );
}

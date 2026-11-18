import { ExternalLink, WandSparkles } from "lucide-react";
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
  clearGithubAppPatch,
  GITHUB_APP_KEYS,
  type GithubAppFormValues,
  generateWebhookSecret,
  githubAppFormValues,
  githubAppPatch,
  indexSettings,
  isSettingLocked,
  isValidGithubAppId,
  isValidGithubAppName,
  looksLikePrivateKey,
} from "@/lib/instance-settings";
import type { InstanceSettings } from "@/types/instance-admin";
import { CopyField } from "./copy-field";
import { LockedCallout } from "./locked-callout";
import { SecretField } from "./secret-field";
import { SourceBadge } from "./source-badge";
import { useSaveInstanceSettings } from "./use-save-instance-settings";

const NEW_APP_URL = "https://github.com/settings/apps/new";

/**
 * The GitHub App repository sync uses: where to create it, the values GitHub
 * gives back, and the webhook URL and secret to enter on GitHub.
 */
export function GithubAppForm({ settings }: { settings: InstanceSettings }) {
  const { t } = useTranslation();
  const index = indexSettings(settings);
  const state = settings.derived.githubApp;
  const [initial, setInitial] = useState(() => githubAppFormValues(index));
  const [values, setValues] = useState<GithubAppFormValues>(initial);
  const [privateKey, setPrivateKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [clearing, setClearing] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const { save, isPending } = useSaveInstanceSettings();

  const keyEntry = index.get("githubApp.privateKey");
  const secretEntry = index.get("githubApp.webhookSecret");
  const envManaged = state.managedByEnvironment;
  const locked = isSettingLocked(settings, index.get("githubApp.appId"));
  const hasSavedValues = GITHUB_APP_KEYS.some(
    (key) => index.get(key)?.source === "database",
  );

  const errors = {
    appId: !isValidGithubAppId(values.appId),
    appName: !isValidGithubAppName(values.appName),
    privateKey: !looksLikePrivateKey(privateKey),
  };
  const valid = !errors.appId && !errors.appName && !errors.privateKey;
  const patch = githubAppPatch(values, initial, privateKey, webhookSecret);
  const dirty = Object.keys(patch).length > 0;
  const savedName = initial.appName.trim();

  const handleSave = async () => {
    if (!valid || !dirty) return;
    if (await save(patch)) {
      setInitial(values);
      setPrivateKey("");
      setWebhookSecret("");
    }
  };

  const handleClear = async (key: string) => {
    setClearing(key);
    await save({ [key]: null }, t("instanceAdmin:secret.cleared"));
    setClearing(null);
  };

  const handleRemove = async () => {
    if (
      await save(clearGithubAppPatch(), t("instanceAdmin:githubApp.removed"))
    ) {
      const cleared = { appId: "", appName: "" };
      setInitial(cleared);
      setValues(cleared);
      setPrivateKey("");
      setWebhookSecret("");
    }
  };

  const badge = (key: string) => {
    const entry = index.get(key);
    return entry && !envManaged && entry.source === "database" ? (
      <SourceBadge entry={entry} />
    ) : null;
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("instanceAdmin:githubApp.intro")}
      </p>

      {envManaged && (
        <LockedCallout>
          {t("instanceAdmin:githubApp.managedByEnv")}
        </LockedCallout>
      )}

      {!state.configured && !locked && (
        <div className="space-y-3 rounded-md border border-border bg-muted/40 p-4">
          <p className="text-sm font-medium">
            {t("instanceAdmin:githubApp.stepsTitle")}
          </p>
          <ol className="list-decimal space-y-1.5 ps-5 text-sm text-muted-foreground">
            <li>{t("instanceAdmin:githubApp.step1")}</li>
            <li>{t("instanceAdmin:githubApp.step2")}</li>
            <li>{t("instanceAdmin:githubApp.step3")}</li>
            <li>{t("instanceAdmin:githubApp.step4")}</li>
            <li>{t("instanceAdmin:githubApp.step5")}</li>
          </ol>
          <Button
            variant="outline"
            size="sm"
            render={
              <a href={NEW_APP_URL} target="_blank" rel="noopener noreferrer" />
            }
          >
            {t("instanceAdmin:githubApp.createOnGithub")}
            <ExternalLink aria-hidden />
          </Button>
        </div>
      )}

      <div className="grid gap-4 rounded-md border border-border bg-card p-4 sm:grid-cols-2">
        <FieldBlock
          id="github-app-webhook-url"
          label={t("instanceAdmin:githubApp.webhookUrl")}
          hint={t("instanceAdmin:githubApp.webhookUrlHint")}
          wide
        >
          <CopyField id="github-app-webhook-url" value={state.webhookUrl} />
        </FieldBlock>
        <FieldBlock
          id="github-app-id"
          label={t("instanceAdmin:githubApp.appId")}
          badge={badge("githubApp.appId")}
          hint={
            errors.appId
              ? t("instanceAdmin:githubApp.appIdInvalid")
              : t("instanceAdmin:githubApp.appIdHint")
          }
          error={errors.appId}
        >
          <Input
            id="github-app-id"
            value={values.appId}
            disabled={locked}
            inputMode="numeric"
            autoComplete="off"
            placeholder="123456"
            aria-invalid={errors.appId || undefined}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                appId: event.target.value,
              }))
            }
          />
        </FieldBlock>
        <FieldBlock
          id="github-app-name"
          label={t("instanceAdmin:githubApp.appName")}
          badge={badge("githubApp.appName")}
          hint={
            errors.appName
              ? t("instanceAdmin:githubApp.appNameInvalid")
              : t("instanceAdmin:githubApp.appNameHint")
          }
          error={errors.appName}
        >
          <Input
            id="github-app-name"
            value={values.appName}
            disabled={locked}
            autoComplete="off"
            placeholder="margaya-example"
            aria-invalid={errors.appName || undefined}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                appName: event.target.value,
              }))
            }
          />
        </FieldBlock>
        {keyEntry && (
          <FieldBlock
            id="github-app-private-key"
            label={t("instanceAdmin:githubApp.privateKey")}
            badge={badge("githubApp.privateKey")}
            hint={
              errors.privateKey
                ? t("instanceAdmin:githubApp.privateKeyInvalid")
                : t("instanceAdmin:githubApp.privateKeyHint")
            }
            error={errors.privateKey}
            wide
          >
            <SecretField
              key={`${keyEntry.updatedAt}-${keyEntry.configured}`}
              id="github-app-private-key"
              entry={keyEntry}
              value={privateKey}
              onChange={setPrivateKey}
              onClear={() => void handleClear("githubApp.privateKey")}
              clearing={clearing === "githubApp.privateKey"}
              disabled={locked}
              multiline={{
                accept: ".pem,application/x-pem-file,text/plain",
                placeholder: "-----BEGIN RSA PRIVATE KEY-----",
              }}
            />
          </FieldBlock>
        )}
        {secretEntry && (
          <FieldBlock
            id="github-app-webhook-secret"
            label={t("instanceAdmin:githubApp.webhookSecret")}
            badge={badge("githubApp.webhookSecret")}
            hint={t("instanceAdmin:githubApp.webhookSecretHint")}
            wide
          >
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <SecretField
                  key={`${secretEntry.updatedAt}-${secretEntry.configured}`}
                  id="github-app-webhook-secret"
                  entry={secretEntry}
                  value={webhookSecret}
                  onChange={setWebhookSecret}
                  onClear={() => void handleClear("githubApp.webhookSecret")}
                  clearing={clearing === "githubApp.webhookSecret"}
                  disabled={locked}
                />
              </div>
              {!locked && !secretEntry.configured && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setWebhookSecret(generateWebhookSecret())}
                >
                  <WandSparkles aria-hidden />
                  {t("instanceAdmin:githubApp.generateSecret")}
                </Button>
              )}
            </div>
            {webhookSecret && !secretEntry.configured && (
              <div className="pt-2">
                <CopyField
                  id="github-app-webhook-secret-copy"
                  value={webhookSecret}
                />
              </div>
            )}
          </FieldBlock>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!locked && (
          <Button
            type="button"
            disabled={!dirty || !valid}
            loading={isPending && !clearing}
            onClick={() => void handleSave()}
          >
            {t("instanceAdmin:githubApp.save")}
          </Button>
        )}
        {state.configured && savedName && (
          <Button
            variant="outline"
            render={
              <a
                href={`https://github.com/apps/${encodeURIComponent(savedName)}/installations/new`}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            {t("instanceAdmin:githubApp.install")}
            <ExternalLink aria-hidden />
          </Button>
        )}
        {!locked && hasSavedValues && (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive-foreground sm:ml-auto"
            onClick={() => setRemoveOpen(true)}
          >
            {t("instanceAdmin:githubApp.remove")}
          </Button>
        )}
      </div>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("instanceAdmin:githubApp.removeTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("instanceAdmin:githubApp.removeDescription")}
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
              {t("instanceAdmin:githubApp.removeConfirm")}
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
  /** Spans both columns. */
  wide?: boolean;
  children: ReactNode;
};

function FieldBlock({
  id,
  label,
  badge,
  hint,
  error = false,
  wide = false,
  children,
}: FieldBlockProps) {
  return (
    <div
      className={
        wide ? "min-w-0 space-y-1.5 sm:col-span-2" : "min-w-0 space-y-1.5"
      }
    >
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
              : "text-xs text-muted-foreground"
          }
        >
          {hint}
        </p>
      )}
    </div>
  );
}

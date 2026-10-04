import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  CUSTOM_OAUTH_TEXT_FIELDS,
  type CustomOAuthTextField,
  indexSettings,
  isSettingLocked,
  isValidOptionalUrl,
  type OAuthDraft,
  oauthDraftOf,
  oauthPatch,
} from "@/lib/instance-settings";
import type {
  InstanceSettingEntry,
  InstanceSettings,
  OAuthProviderId,
} from "@/types/instance-admin";
import { CopyField } from "./copy-field";
import { LockedCallout } from "./locked-callout";
import { SecretField } from "./secret-field";
import { SourceBadge } from "./source-badge";
import { useSaveInstanceSettings } from "./use-save-instance-settings";

type OAuthProviderSheetProps = {
  open: boolean;
  /** Kept while the sheet animates closed. */
  provider: OAuthProviderId | null;
  providerName: string;
  settings: InstanceSettings;
  onOpenChange: (open: boolean) => void;
};

const TEXT_LABELS: Record<CustomOAuthTextField, string> = {
  buttonLabel: "instanceAdmin:oauth.buttonLabel",
  discoveryUrl: "instanceAdmin:oauth.discoveryUrl",
  authorizationUrl: "instanceAdmin:oauth.authorizationUrl",
  tokenUrl: "instanceAdmin:oauth.tokenUrl",
  userInfoUrl: "instanceAdmin:oauth.userInfoUrl",
  scopes: "instanceAdmin:oauth.scopes",
  logoutUrl: "instanceAdmin:oauth.logoutUrl",
};

const TEXT_HINTS: Partial<Record<CustomOAuthTextField, string>> = {
  buttonLabel: "instanceAdmin:oauth.buttonLabelHint",
  discoveryUrl: "instanceAdmin:oauth.discoveryHint",
  scopes: "instanceAdmin:oauth.scopesHint",
};

const URL_FIELDS: ReadonlySet<CustomOAuthTextField> = new Set([
  "discoveryUrl",
  "authorizationUrl",
  "tokenUrl",
  "userInfoUrl",
  "logoutUrl",
]);

function FieldLabel({
  id,
  label,
  entry,
}: {
  id: string;
  label: string;
  entry: InstanceSettingEntry | undefined;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor={id}>{label}</Label>
      {entry && entry.source !== "default" && <SourceBadge entry={entry} />}
    </div>
  );
}

/** Client credentials (and custom OAuth endpoints) for one provider. */
export function OAuthProviderSheet({
  open,
  provider,
  providerName,
  settings,
  onOpenChange,
}: OAuthProviderSheetProps) {
  return (
    <Sheet open={open && provider !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg">
        {provider && (
          <ProviderForm
            key={provider}
            provider={provider}
            providerName={providerName}
            settings={settings}
            onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

type ProviderFormProps = {
  provider: OAuthProviderId;
  providerName: string;
  settings: InstanceSettings;
  onDone: () => void;
};

function ProviderForm({
  provider,
  providerName,
  settings,
  onDone,
}: ProviderFormProps) {
  const { t } = useTranslation();
  const index = indexSettings(settings);
  const state = settings.derived.providers[provider];
  const [initial] = useState(() => oauthDraftOf(index, provider));
  const [draft, setDraft] = useState<OAuthDraft>(initial);
  const [secret, setSecret] = useState("");
  const { save, isPending } = useSaveInstanceSettings();
  const [clearing, setClearing] = useState(false);

  const secretKey = `oauth.${provider}.clientSecret`;
  const secretEntry = index.get(secretKey);
  const lockedKey = (key: string) => isSettingLocked(settings, index.get(key));

  const invalidUrls = CUSTOM_OAUTH_TEXT_FIELDS.filter(
    (field) =>
      provider === "custom" &&
      URL_FIELDS.has(field) &&
      !isValidOptionalUrl(draft[field]),
  );
  const patch = oauthPatch(provider, draft, initial, secret);
  const dirty = Object.keys(patch).length > 0;

  const handleSave = async () => {
    if (invalidUrls.length > 0) return;
    if (await save(patch)) onDone();
  };

  const handleClearSecret = async () => {
    setClearing(true);
    await save({ [secretKey]: null }, t("instanceAdmin:secret.cleared"));
    setClearing(false);
  };

  const textField = (field: CustomOAuthTextField) => {
    const key = `oauth.custom.${field}`;
    const id = `oauth-custom-${field}`;
    const invalid = invalidUrls.includes(field);
    const hint = TEXT_HINTS[field];
    return (
      <div key={field} className="space-y-1.5">
        <FieldLabel
          id={id}
          label={t(TEXT_LABELS[field])}
          entry={index.get(key)}
        />
        <Input
          id={id}
          value={draft[field]}
          disabled={lockedKey(key)}
          aria-invalid={invalid || undefined}
          placeholder={field === "scopes" ? "profile, email" : undefined}
          maxLength={field === "buttonLabel" ? 40 : 2048}
          onChange={(event) =>
            setDraft((current) => ({ ...current, [field]: event.target.value }))
          }
        />
        {invalid ? (
          <p className="text-xs text-destructive-foreground">
            {t("instanceAdmin:oauth.invalidUrl")}
          </p>
        ) : (
          hint && <p className="text-xs text-muted-foreground">{t(hint)}</p>
        )}
      </div>
    );
  };

  const switchField = (
    field: "pkce" | "autoSignIn",
    label: string,
    hint?: string,
  ) => {
    const key = `oauth.custom.${field}`;
    const id = `oauth-custom-${field}`;
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <FieldLabel id={id} label={label} entry={index.get(key)} />
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <Switch
          id={id}
          checked={draft[field]}
          disabled={lockedKey(key)}
          onCheckedChange={(checked) =>
            setDraft((current) => ({ ...current, [field]: checked }))
          }
        />
      </div>
    );
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {t("instanceAdmin:oauth.sheetTitle", { provider: providerName })}
        </SheetTitle>
        <SheetDescription>
          {t("instanceAdmin:oauth.sheetDescription", {
            provider: providerName,
          })}
        </SheetDescription>
      </SheetHeader>
      <SheetPanel className="space-y-5">
        {state.managedByEnvironment && (
          <LockedCallout>
            {t("instanceAdmin:oauth.managedByEnv", {
              variables: state.envVars.join(", "),
            })}
          </LockedCallout>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="oauth-callback-url">
            {t("instanceAdmin:oauth.callbackUrl")}
          </Label>
          <CopyField id="oauth-callback-url" value={state.callbackUrl} />
          <p className="text-xs text-muted-foreground">
            {t("instanceAdmin:oauth.callbackHint")}
          </p>
        </div>

        <Separator />

        <div className="space-y-1.5">
          <FieldLabel
            id="oauth-client-id"
            label={t("instanceAdmin:oauth.clientId")}
            entry={index.get(`oauth.${provider}.clientId`)}
          />
          <Input
            id="oauth-client-id"
            value={draft.clientId}
            autoComplete="off"
            maxLength={256}
            disabled={lockedKey(`oauth.${provider}.clientId`)}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                clientId: event.target.value,
              }))
            }
          />
        </div>

        {secretEntry && (
          <div className="space-y-1.5">
            <FieldLabel
              id="oauth-client-secret"
              label={t("instanceAdmin:oauth.clientSecret")}
              entry={secretEntry}
            />
            <SecretField
              key={`${secretEntry.updatedAt}-${secretEntry.configured}`}
              id="oauth-client-secret"
              entry={secretEntry}
              value={secret}
              onChange={setSecret}
              onClear={() => void handleClearSecret()}
              clearing={clearing}
              disabled={lockedKey(secretKey)}
            />
          </div>
        )}

        {provider === "custom" && (
          <>
            <Separator />
            {CUSTOM_OAUTH_TEXT_FIELDS.slice(0, 6).map(textField)}
            {switchField("pkce", t("instanceAdmin:oauth.pkce"))}
            {switchField(
              "autoSignIn",
              t("instanceAdmin:oauth.autoSignIn"),
              t("instanceAdmin:oauth.autoSignInHint"),
            )}
            {textField("logoutUrl")}
          </>
        )}
      </SheetPanel>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("instanceAdmin:secret.cancel")}
        </Button>
        <Button
          type="button"
          disabled={!dirty || invalidUrls.length > 0 || settings.locked}
          loading={isPending && !clearing}
          onClick={() => void handleSave()}
        >
          {t("instanceAdmin:save")}
        </Button>
      </SheetFooter>
    </>
  );
}

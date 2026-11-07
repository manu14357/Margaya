import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { indexSettings, isSettingLocked } from "@/lib/instance-settings";
import type { InstanceSettings, OAuthProviderId } from "@/types/instance-admin";
import { InstanceSection } from "./instance-page";
import { SettingRow, SettingSwitchRow } from "./setting-row";
import { useSaveInstanceSettings } from "./use-save-instance-settings";

// The sign-in policy (4.11): allowed email domains for new accounts, a
// required sign-in provider, required two-factor and the session lifetime. All
// are instance settings, so environment variables lock them as usual.

const PROVIDER_KEYS: Record<OAuthProviderId, string> = {
  github: "instanceAdmin:auth.method.github",
  google: "instanceAdmin:auth.method.google",
  discord: "instanceAdmin:auth.method.discord",
  custom: "instanceAdmin:auth.method.custom",
};

const PROVIDERS: OAuthProviderId[] = ["github", "google", "discord", "custom"];
const NONE = "none";

export function SignInPolicySection({
  settings,
}: {
  settings: InstanceSettings;
}) {
  const { t } = useTranslation();
  const index = indexSettings(settings);
  const { save, isPending } = useSaveInstanceSettings();

  const domainsEntry = index.get("auth.allowedEmailDomains");
  const providerEntry = index.get("auth.requiredProvider");
  const hoursEntry = index.get("auth.sessionLifetimeHours");

  const storedDomains = String(domainsEntry?.value ?? "");
  const storedHours = Number(hoursEntry?.value ?? 168);
  const [domains, setDomains] = useState(storedDomains);
  const [hours, setHours] = useState(String(storedHours));
  useEffect(() => setDomains(storedDomains), [storedDomains]);
  useEffect(() => setHours(String(storedHours)), [storedHours]);

  const required = String(providerEntry?.value ?? "") || NONE;
  const choices = PROVIDERS.filter(
    (provider) =>
      settings.derived.providers[provider].active || provider === required,
  );
  const hoursValue = Number(hours);
  const hoursValid =
    Number.isInteger(hoursValue) && hoursValue >= 1 && hoursValue <= 8760;

  return (
    <InstanceSection
      title={t("accountSecurity:platform.policy.title")}
      description={t("accountSecurity:platform.policy.description")}
    >
      <SettingRow
        id="instance-setting-allowed-domains"
        label={t("accountSecurity:platform.policy.domains")}
        hint={t("accountSecurity:platform.policy.domainsHint")}
        entry={domainsEntry}
      >
        <form
          className="flex w-full gap-2 sm:w-80"
          onSubmit={(event) => {
            event.preventDefault();
            void save({
              "auth.allowedEmailDomains": domains.trim() ? domains : null,
            });
          }}
        >
          <Input
            id="instance-setting-allowed-domains"
            value={domains}
            placeholder="example.com, example.org"
            disabled={isSettingLocked(settings, domainsEntry)}
            onChange={(event) => setDomains(event.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={
              isPending ||
              isSettingLocked(settings, domainsEntry) ||
              domains === storedDomains
            }
          >
            {t("accountSecurity:platform.save")}
          </Button>
        </form>
      </SettingRow>
      <Separator />
      <SettingRow
        id="instance-setting-required-provider"
        label={t("accountSecurity:platform.policy.requiredProvider")}
        hint={t("accountSecurity:platform.policy.requiredProviderHint")}
        entry={providerEntry}
      >
        <Select
          value={required}
          disabled={isPending || isSettingLocked(settings, providerEntry)}
          onValueChange={(value) =>
            void save({
              "auth.requiredProvider": value === NONE ? null : String(value),
            })
          }
        >
          <SelectTrigger
            id="instance-setting-required-provider"
            className="w-full sm:w-56"
          >
            <SelectValue>
              {required === NONE
                ? t("accountSecurity:platform.policy.noRequirement")
                : t(PROVIDER_KEYS[required as OAuthProviderId])}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>
              {t("accountSecurity:platform.policy.noRequirement")}
            </SelectItem>
            {choices.map((provider) => (
              <SelectItem key={provider} value={provider}>
                {t(PROVIDER_KEYS[provider])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <Separator />
      <SettingSwitchRow
        settings={settings}
        settingKey="auth.requireTwoFactor"
        label={t("accountSecurity:platform.policy.requireTwoFactor")}
        hint={t("accountSecurity:platform.policy.requireTwoFactorHint")}
      />
      <Separator />
      <SettingRow
        id="instance-setting-session-hours"
        label={t("accountSecurity:platform.policy.sessionLifetime")}
        hint={t("accountSecurity:platform.policy.sessionLifetimeHint")}
        entry={hoursEntry}
      >
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (hoursValid) {
              void save({ "auth.sessionLifetimeHours": hoursValue });
            }
          }}
        >
          <Input
            id="instance-setting-session-hours"
            type="number"
            min={1}
            max={8760}
            inputMode="numeric"
            className="w-24"
            value={hours}
            aria-invalid={!hoursValid}
            disabled={isSettingLocked(settings, hoursEntry)}
            onChange={(event) => setHours(event.target.value)}
          />
          <span className="text-sm text-muted-foreground">
            {t("accountSecurity:platform.policy.hours")}
          </span>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={
              isPending ||
              !hoursValid ||
              isSettingLocked(settings, hoursEntry) ||
              hoursValue === storedHours
            }
          >
            {t("accountSecurity:platform.save")}
          </Button>
        </form>
      </SettingRow>
    </InstanceSection>
  );
}

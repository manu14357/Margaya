import { createFileRoute } from "@tanstack/react-router";
import { Globe, KeyRound, Mail, MailCheck, MessageCircle } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { GithubIcon } from "@/components/icons/github-icon";
import {
  InstanceLoadState,
  InstancePage,
  InstanceSection,
} from "@/components/instance-admin/instance-page";
import { OAuthProviderSheet } from "@/components/instance-admin/oauth-provider-sheet";
import { SettingSwitchRow } from "@/components/instance-admin/setting-row";
import { SignInMethodCard } from "@/components/instance-admin/sign-in-method-card";
import { SignInPolicySection } from "@/components/instance-admin/sign-in-policy-section";
import { useSaveInstanceSettings } from "@/components/instance-admin/use-save-instance-settings";
import { Separator } from "@/components/ui/separator";
import { useInstanceSettings } from "@/hooks/queries/instance-admin/use-instance-admin";
import {
  indexSettings,
  type SignInMethodId,
  settingFlag,
  signInMethods,
} from "@/lib/instance-settings";
import type { InstanceSettings, OAuthProviderId } from "@/types/instance-admin";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/instance/authentication",
)({
  component: RouteComponent,
});

const METHOD_NAMES: Record<SignInMethodId, string> = {
  emailPassword: "instanceAdmin:auth.method.emailPassword",
  emailCode: "instanceAdmin:auth.method.emailCode",
  github: "instanceAdmin:auth.method.github",
  google: "instanceAdmin:auth.method.google",
  discord: "instanceAdmin:auth.method.discord",
  custom: "instanceAdmin:auth.method.custom",
};

const METHOD_ICONS: Record<SignInMethodId, ReactNode> = {
  emailPassword: <Mail className="size-4 text-muted-foreground" />,
  emailCode: <MailCheck className="size-4 text-muted-foreground" />,
  github: <GithubIcon className="size-4 text-muted-foreground" />,
  google: <Globe className="size-4 text-muted-foreground" />,
  discord: <MessageCircle className="size-4 text-muted-foreground" />,
  custom: <KeyRound className="size-4 text-muted-foreground" />,
};

function RouteComponent() {
  const { t } = useTranslation();
  const settings = useInstanceSettings();

  return (
    <InstancePage
      title={t("instanceAdmin:auth.title")}
      subtitle={t("instanceAdmin:auth.subtitle")}
      locked={settings.data?.locked}
    >
      {settings.data ? (
        <AuthenticationSettings settings={settings.data} />
      ) : (
        <InstanceLoadState
          isLoading={settings.isLoading}
          isError={settings.isError}
          onRetry={() => void settings.refetch()}
          rows={5}
        />
      )}
    </InstancePage>
  );
}

function AuthenticationSettings({ settings }: { settings: InstanceSettings }) {
  const { t } = useTranslation();
  const index = indexSettings(settings);
  const { save } = useSaveInstanceSettings();
  const [pendingMethod, setPendingMethod] = useState<SignInMethodId | null>(
    null,
  );
  const [configuring, setConfiguring] = useState<OAuthProviderId | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const methods = signInMethods(settings);
  const guestInactive =
    settingFlag(index, "auth.guestAccess") &&
    !settings.derived.guestAccessActive;

  const toggleMethod = async (
    id: SignInMethodId,
    key: string,
    enabled: boolean,
  ) => {
    setPendingMethod(id);
    await save({ [key]: enabled });
    setPendingMethod(null);
  };

  return (
    <>
      <InstanceSection title={t("instanceAdmin:auth.signUpTitle")}>
        <SettingSwitchRow
          settings={settings}
          settingKey="auth.inviteOnly"
          inverted
          label={t("instanceAdmin:auth.anyoneCanSignUp")}
          hint={t("instanceAdmin:auth.anyoneCanSignUpHint")}
        />
        <Separator />
        <SettingSwitchRow
          settings={settings}
          settingKey="auth.emailSignUp"
          label={t("instanceAdmin:auth.emailSignUp")}
          hint={t("instanceAdmin:auth.emailSignUpHint")}
        />
        <Separator />
        <SettingSwitchRow
          settings={settings}
          settingKey="auth.emailSignUpForInvitations"
          label={t("accountSecurity:platform.policy.invitedPasswordSignUp")}
          hint={t("accountSecurity:platform.policy.invitedPasswordSignUpHint")}
        />
        <Separator />
        <SettingSwitchRow
          settings={settings}
          settingKey="auth.guestAccess"
          label={t("instanceAdmin:auth.guestAccess")}
          hint={t("instanceAdmin:auth.guestAccessHint")}
          note={
            guestInactive ? t("instanceAdmin:auth.guestAccessInactive") : null
          }
        />
      </InstanceSection>

      <InstanceSection title={t("instanceAdmin:auth.methodsTitle")}>
        <div className="space-y-2">
          {methods.map((method) => {
            const name = t(METHOD_NAMES[method.id]);
            const hint =
              method.id === "emailPassword"
                ? t("instanceAdmin:auth.methodHint.emailPassword")
                : method.id === "emailCode"
                  ? t("instanceAdmin:auth.methodHint.emailCode")
                  : t("instanceAdmin:auth.methodHint.provider");
            const provider = method.isProvider
              ? (method.id as OAuthProviderId)
              : null;
            return (
              <SignInMethodCard
                key={method.id}
                method={method}
                name={name}
                hint={hint}
                icon={METHOD_ICONS[method.id]}
                pending={pendingMethod === method.id}
                onToggle={(enabled) =>
                  void toggleMethod(method.id, method.settingKey, enabled)
                }
                onConfigure={
                  provider
                    ? () => {
                        setConfiguring(provider);
                        setSheetOpen(true);
                      }
                    : undefined
                }
              />
            );
          })}
        </div>
      </InstanceSection>

      <SignInPolicySection settings={settings} />

      <OAuthProviderSheet
        open={sheetOpen}
        provider={configuring}
        providerName={configuring ? t(METHOD_NAMES[configuring]) : ""}
        settings={settings}
        onOpenChange={setSheetOpen}
      />
    </>
  );
}

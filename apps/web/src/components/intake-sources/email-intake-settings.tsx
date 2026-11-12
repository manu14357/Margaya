import { Info, RefreshCw } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsGroup,
  SettingsGroupMessage,
  SettingsRow,
  SettingsSaveFooter,
  SettingsSection,
} from "@/components/settings-layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { IntakeEmailSettings } from "@/fetchers/intake-sources/intake-sources";
import { useIntakeEmailMutations } from "@/hooks/mutations/intake-sources/use-intake-source-mutations";
import { useIntakeEmailSettings } from "@/hooks/queries/intake-sources/use-intake-sources";
import { formatDateTime } from "@/lib/format";
import {
  formatDomains,
  megabytes,
  parseDomainInput,
  parsePort,
} from "@/lib/intake-sources";
import { toast } from "@/lib/toast";
import CopyField from "./copy-field";

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

type FiltersDraft = { allowed: string; blocked: string };
type MailboxDraft = {
  host: string;
  port: string;
  security: "tls" | "starttls";
  username: string;
  password: string;
  folder: string;
};

function filtersOf(settings: IntakeEmailSettings): FiltersDraft {
  return {
    allowed: formatDomains(settings.allowedDomains),
    blocked: formatDomains(settings.blockedDomains),
  };
}

function mailboxOf(settings: IntakeEmailSettings): MailboxDraft {
  return {
    host: settings.imap.host ?? "",
    port: settings.imap.port ? String(settings.imap.port) : "",
    security: settings.imap.security,
    username: settings.imap.username ?? "",
    password: "",
    folder: settings.imap.folder,
  };
}

/** Email intake of one project: address, sender filters and own mailbox. */
export default function EmailIntakeSettings({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } =
    useIntakeEmailSettings(projectId);

  return (
    <SettingsSection
      title={t("settings:projectIntake.email.title")}
      description={t("settings:projectIntake.email.description")}
    >
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : isError || !data ? (
        <SettingsGroup>
          <SettingsGroupMessage tone="error">
            {t("settings:projectIntake.loadError")}{" "}
            <Button variant="link" size="xs" onClick={() => refetch()}>
              {t("settings:projectIntake.retry")}
            </Button>
          </SettingsGroupMessage>
        </SettingsGroup>
      ) : (
        <EmailIntakeForm projectId={projectId} settings={data} />
      )}
    </SettingsSection>
  );
}

function EmailIntakeForm({
  projectId,
  settings,
}: {
  projectId: string;
  settings: IntakeEmailSettings;
}) {
  const { t } = useTranslation();
  const ids = {
    enabled: useId(),
    address: useId(),
    allowed: useId(),
    blocked: useId(),
    mailbox: useId(),
    host: useId(),
    port: useId(),
    security: useId(),
    username: useId(),
    password: useId(),
    folder: useId(),
  };
  const { update, rotate, test } = useIntakeEmailMutations(projectId);
  const [filters, setFilters] = useState(() => filtersOf(settings));
  const [mailbox, setMailbox] = useState(() => mailboxOf(settings));

  useEffect(() => {
    setFilters(filtersOf(settings));
    setMailbox(mailboxOf(settings));
  }, [settings]);

  const saved = filtersOf(settings);
  const filtersDirty =
    filters.allowed !== saved.allowed || filters.blocked !== saved.blocked;
  const savedMailbox = mailboxOf(settings);
  const mailboxDirty = JSON.stringify(mailbox) !== JSON.stringify(savedMailbox);
  const port = parsePort(mailbox.port);
  const noIntakeRoute = !settings.instance.address && !settings.imap.enabled;

  const save = async (
    patch: Parameters<typeof update.mutateAsync>[0],
    success: string,
  ) => {
    try {
      await update.mutateAsync(patch);
      toast.success(success);
    } catch (error) {
      toast.error(errorText(error, t("settings:projectIntake.saveError")));
    }
  };

  const saveMailbox = (enabled?: boolean) =>
    save(
      {
        imap: {
          ...(enabled === undefined ? {} : { enabled }),
          host: mailbox.host.trim() || null,
          port: port === "invalid" ? null : port,
          security: mailbox.security,
          username: mailbox.username.trim() || null,
          folder: mailbox.folder.trim() || "INBOX",
          ...(mailbox.password ? { password: mailbox.password } : {}),
        },
      },
      t("settings:projectIntake.saved"),
    );

  const runTest = async () => {
    try {
      const result = await test.mutateAsync();
      if (result.ok) {
        toast.success(
          t("settings:projectIntake.mailbox.testOk", {
            count: result.unread ?? 0,
          }),
        );
      } else {
        toast.error(result.error ?? t("settings:projectIntake.saveError"));
      }
    } catch (error) {
      toast.error(errorText(error, t("settings:projectIntake.saveError")));
    }
  };

  return (
    <div className="space-y-4">
      {noIntakeRoute && (
        <Alert variant="info">
          <Info />
          <AlertDescription>
            {t("settings:projectIntake.email.noInstanceAddress")}
          </AlertDescription>
        </Alert>
      )}
      <SettingsGroup>
        <SettingsRow
          label={t("settings:projectIntake.email.enabled")}
          description={t("settings:projectIntake.email.enabledHint")}
          htmlFor={ids.enabled}
        >
          <Switch
            id={ids.enabled}
            checked={settings.enabled}
            disabled={update.isPending}
            onCheckedChange={(enabled) =>
              void save(
                { enabled },
                enabled
                  ? t("settings:projectIntake.email.turnedOn")
                  : t("settings:projectIntake.email.turnedOff"),
              )
            }
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings:projectIntake.email.address")}
          description={
            settings.address
              ? t("settings:projectIntake.email.addressHint")
              : t("settings:projectIntake.email.addressNone")
          }
          htmlFor={ids.address}
          stacked={Boolean(settings.address)}
        >
          {settings.address && (
            <div className="flex flex-wrap items-center gap-2">
              <CopyField id={ids.address} value={settings.address} />
              <Button
                size="sm"
                variant="ghost"
                loading={rotate.isPending}
                onClick={() =>
                  rotate
                    .mutateAsync()
                    .then(() =>
                      toast.success(t("settings:projectIntake.email.rotated")),
                    )
                    .catch((error: unknown) =>
                      toast.error(
                        errorText(error, t("settings:projectIntake.saveError")),
                      ),
                    )
                }
              >
                <RefreshCw className="size-3.5" />
                {t("settings:projectIntake.email.rotate")}
              </Button>
            </div>
          )}
        </SettingsRow>
        <SettingsRow
          label={t("settings:projectIntake.email.allowed")}
          description={t("settings:projectIntake.email.allowedHint")}
          htmlFor={ids.allowed}
          stacked
        >
          <Textarea
            id={ids.allowed}
            value={filters.allowed}
            rows={3}
            placeholder="example.com"
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                allowed: event.target.value,
              }))
            }
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings:projectIntake.email.blocked")}
          description={t("settings:projectIntake.email.blockedHint")}
          htmlFor={ids.blocked}
          stacked
        >
          <Textarea
            id={ids.blocked}
            value={filters.blocked}
            rows={3}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                blocked: event.target.value,
              }))
            }
          />
        </SettingsRow>
        <SettingsSaveFooter
          dirty={filtersDirty}
          saving={update.isPending}
          onSave={() =>
            save(
              {
                allowedDomains: parseDomainInput(filters.allowed),
                blockedDomains: parseDomainInput(filters.blocked),
              },
              t("settings:projectIntake.saved"),
            )
          }
        />
      </SettingsGroup>
      <p className="text-muted-foreground text-xs">
        {t("settings:projectIntake.email.protection", {
          size: megabytes(settings.limits.maxMessageBytes),
          fileSize: megabytes(settings.limits.maxAttachmentBytes),
          files: settings.limits.maxAttachments,
        })}
      </p>

      <SettingsSection
        title={t("settings:projectIntake.mailbox.title")}
        description={t("settings:projectIntake.mailbox.description")}
      >
        <SettingsGroup>
          <SettingsRow
            label={t("settings:projectIntake.mailbox.enabled")}
            description={
              settings.imap.enabled
                ? settings.lastError
                  ? t("settings:projectIntake.mailbox.lastError", {
                      error: settings.lastError,
                    })
                  : settings.lastPolledAt
                    ? t("settings:projectIntake.mailbox.lastPolled", {
                        time: formatDateTime(settings.lastPolledAt),
                      })
                    : t("settings:projectIntake.mailbox.notPolled")
                : t("settings:projectIntake.mailbox.enabledHint")
            }
            htmlFor={ids.mailbox}
          >
            <Switch
              id={ids.mailbox}
              checked={settings.imap.enabled}
              disabled={update.isPending}
              onCheckedChange={(enabled) => void saveMailbox(enabled)}
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings:projectIntake.mailbox.host")}
            htmlFor={ids.host}
          >
            <Input
              id={ids.host}
              value={mailbox.host}
              placeholder="imap.example.com"
              autoComplete="off"
              className="w-full sm:w-72"
              onChange={(event) =>
                setMailbox((m) => ({ ...m, host: event.target.value }))
              }
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings:projectIntake.mailbox.security")}
            description={t("settings:projectIntake.mailbox.securityHint")}
            htmlFor={ids.security}
          >
            <Select
              value={mailbox.security}
              onValueChange={(value) =>
                setMailbox((m) => ({
                  ...m,
                  security: value === "starttls" ? "starttls" : "tls",
                }))
              }
            >
              <SelectTrigger id={ids.security} className="w-40">
                <SelectValue>
                  {mailbox.security === "starttls"
                    ? t("settings:projectIntake.mailbox.starttls")
                    : t("settings:projectIntake.mailbox.tls")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tls">
                  {t("settings:projectIntake.mailbox.tls")}
                </SelectItem>
                <SelectItem value="starttls">
                  {t("settings:projectIntake.mailbox.starttls")}
                </SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsRow
            label={t("settings:projectIntake.mailbox.port")}
            description={t("settings:projectIntake.mailbox.portHint")}
            htmlFor={ids.port}
            note={
              port === "invalid"
                ? t("settings:projectIntake.mailbox.portInvalid")
                : undefined
            }
          >
            <Input
              id={ids.port}
              value={mailbox.port}
              inputMode="numeric"
              placeholder={mailbox.security === "starttls" ? "143" : "993"}
              className="w-28"
              onChange={(event) =>
                setMailbox((m) => ({ ...m, port: event.target.value }))
              }
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings:projectIntake.mailbox.username")}
            htmlFor={ids.username}
          >
            <Input
              id={ids.username}
              value={mailbox.username}
              autoComplete="off"
              className="w-full sm:w-72"
              onChange={(event) =>
                setMailbox((m) => ({ ...m, username: event.target.value }))
              }
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings:projectIntake.mailbox.password")}
            description={
              settings.imap.hasPassword
                ? t("settings:projectIntake.mailbox.passwordSaved")
                : undefined
            }
            htmlFor={ids.password}
          >
            <Input
              id={ids.password}
              type="password"
              value={mailbox.password}
              autoComplete="new-password"
              placeholder={settings.imap.hasPassword ? "••••••••" : ""}
              className="w-full sm:w-72"
              onChange={(event) =>
                setMailbox((m) => ({ ...m, password: event.target.value }))
              }
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings:projectIntake.mailbox.folder")}
            htmlFor={ids.folder}
          >
            <Input
              id={ids.folder}
              value={mailbox.folder}
              className="w-full sm:w-48"
              onChange={(event) =>
                setMailbox((m) => ({ ...m, folder: event.target.value }))
              }
            />
          </SettingsRow>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-2.5">
            <Button
              size="sm"
              variant="outline"
              loading={test.isPending}
              disabled={!settings.imap.host || mailboxDirty}
              onClick={() => void runTest()}
            >
              {t("settings:projectIntake.mailbox.test")}
            </Button>
            <SettingsSaveFooter
              className="border-t-0 p-0"
              dirty={mailboxDirty}
              disabled={port === "invalid"}
              saving={update.isPending}
              onSave={() => saveMailbox()}
            />
          </div>
        </SettingsGroup>
      </SettingsSection>
    </div>
  );
}

import { Check, Copy, ExternalLink, Plug, Unplug } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsDangerZone,
  SettingsEmptyState,
  SettingsGroup,
  SettingsGroupMessage,
  SettingsPage,
  SettingsReadOnlyNotice,
  SettingsRow,
  SettingsSection,
} from "@/components/settings-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
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
import type { SlackAppTestResult } from "@/fetchers/slack-app/test-slack-app";
import {
  useConnectSlackApp,
  useDisconnectSlackApp,
  useTestSlackApp,
  useUpdateSlackApp,
} from "@/hooks/mutations/slack-app/use-slack-app-mutations";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useSlackApp from "@/hooks/queries/slack-app/use-slack-app";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";

type Mode = "socket" | "http";
const NO_PROJECT = "__none__";

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      type="button"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error(t("settings:slackApp.copyFailed"));
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? t("settings:slackApp.copied") : label}
    </Button>
  );
}

function TestResult({ result }: { result: SlackAppTestResult }) {
  const { t } = useTranslation();
  const name = {
    bot_token: t("settings:slackApp.checks.botToken"),
    app_token: t("settings:slackApp.checks.appToken"),
    signing_secret: t("settings:slackApp.checks.signingSecret"),
  };
  return (
    <ul className="space-y-1 px-4 pb-3 text-xs" aria-live="polite">
      {result.checks.map((check) => (
        <li key={check.check} className="flex items-center gap-2">
          <Badge variant={check.ok ? "success" : "error"}>
            {check.ok
              ? t("settings:slackApp.checks.passed")
              : t("settings:slackApp.checks.failed")}
          </Badge>
          <span>{name[check.check]}</span>
          {check.error && (
            <code className="text-muted-foreground">{check.error}</code>
          )}
        </li>
      ))}
    </ul>
  );
}

export function SlackAppSettings() {
  const { t } = useTranslation();
  const ids = useId();
  const { workspace, canManageWebhooks, isCheckingPermissions } =
    useWorkspacePermission();
  const workspaceId = workspace?.id ?? "";
  const canManage = canManageWebhooks();
  const { data, isLoading, isError } = useSlackApp(workspaceId, canManage);
  const { data: projects = [] } = useGetProjects({ workspaceId });
  const connect = useConnectSlackApp(workspaceId);
  const update = useUpdateSlackApp(workspaceId);
  const disconnect = useDisconnectSlackApp(workspaceId);
  const test = useTestSlackApp(workspaceId);

  const connection = data?.connection ?? null;
  const [mode, setMode] = useState<Mode>("socket");
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [testResult, setTestResult] = useState<SlackAppTestResult | null>(null);

  useEffect(() => {
    if (connection) setMode(connection.mode);
  }, [connection]);

  const title = t("settings:slackApp.title");
  const page = (children: ReactNode) => (
    <SettingsPage
      title={title}
      documentTitle={title}
      description={t("settings:slackApp.description")}
    >
      {children}
    </SettingsPage>
  );

  if (isCheckingPermissions) {
    return page(<Skeleton className="h-40 w-full" />);
  }
  if (!canManage) {
    return page(
      <SettingsReadOnlyNotice>
        {t("settings:slackApp.noPermission")}
      </SettingsReadOnlyNotice>,
    );
  }
  if (isLoading) {
    return page(
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>,
    );
  }
  if (isError || !data) {
    return page(
      <SettingsGroup>
        <SettingsGroupMessage tone="error">
          {t("settings:slackApp.loadError")}
        </SettingsGroupMessage>
      </SettingsGroup>,
    );
  }

  const busy =
    connect.isPending ||
    update.isPending ||
    disconnect.isPending ||
    test.isPending;
  const manifest =
    mode === "socket" ? data.setup.manifests.socket : data.setup.manifests.http;

  const runTest = async () => {
    try {
      const result = await test.mutateAsync();
      setTestResult(result);
      if (result.ok) toast.success(t("settings:slackApp.toast.testPassed"));
      else toast.error(t("settings:slackApp.toast.testFailed"));
    } catch (error) {
      toast.error(errorText(error, t("settings:slackApp.toast.testFailed")));
    }
  };

  const save = async () => {
    const credentials = {
      ...(botToken.trim() ? { botToken: botToken.trim() } : {}),
      ...(appToken.trim() ? { appToken: appToken.trim() } : {}),
      ...(signingSecret.trim() ? { signingSecret: signingSecret.trim() } : {}),
    };
    try {
      if (connection) {
        await update.mutateAsync({ mode, ...credentials });
      } else {
        await connect.mutateAsync({
          mode,
          botToken: botToken.trim(),
          ...(appToken.trim() ? { appToken: appToken.trim() } : {}),
          ...(signingSecret.trim()
            ? { signingSecret: signingSecret.trim() }
            : {}),
        });
      }
      setBotToken("");
      setAppToken("");
      setSigningSecret("");
      toast.success(t("settings:slackApp.toast.saved"));
      await runTest();
    } catch (error) {
      toast.error(errorText(error, t("settings:slackApp.toast.saveError")));
    }
  };

  const patch = async (json: Parameters<typeof update.mutateAsync>[0]) => {
    try {
      await update.mutateAsync(json);
      toast.success(t("settings:slackApp.toast.saved"));
    } catch (error) {
      toast.error(errorText(error, t("settings:slackApp.toast.saveError")));
    }
  };

  const remove = async () => {
    try {
      await disconnect.mutateAsync();
      setTestResult(null);
      toast.success(t("settings:slackApp.toast.disconnected"));
    } catch (error) {
      toast.error(errorText(error, t("settings:slackApp.toast.saveError")));
    }
  };

  const needsBotToken = !connection?.botTokenConfigured;
  const needsAppToken = mode === "socket" && !connection?.appTokenConfigured;
  const needsSecret = mode === "http" && !connection?.signingSecretConfigured;
  const canSave =
    (!needsBotToken || botToken.trim()) &&
    (!needsAppToken || appToken.trim()) &&
    (!needsSecret || signingSecret.trim()) &&
    (connection
      ? Boolean(
          botToken.trim() ||
            appToken.trim() ||
            signingSecret.trim() ||
            mode !== connection.mode,
        )
      : true);

  return page(
    <>
      <SettingsSection title={t("settings:slackApp.statusTitle")}>
        {connection ? (
          <SettingsGroup>
            <SettingsRow
              label={connection.teamName ?? t("settings:slackApp.unknownTeam")}
              description={
                connection.mode === "socket"
                  ? t("settings:slackApp.modeSocket")
                  : t("settings:slackApp.modeHttp")
              }
              badge={
                <Badge variant={connection.isActive ? "success" : "outline"}>
                  {connection.isActive
                    ? t("settings:slackApp.active")
                    : t("settings:slackApp.paused")}
                </Badge>
              }
              note={
                !connection.credentialsReadable
                  ? t("settings:slackApp.unreadable")
                  : connection.lastError
                    ? t("settings:slackApp.lastError", {
                        code: connection.lastError,
                      })
                    : undefined
              }
            >
              <Button
                size="sm"
                type="button"
                variant="outline"
                loading={test.isPending}
                disabled={busy}
                onClick={() => void runTest()}
              >
                {t("settings:slackApp.test")}
              </Button>
            </SettingsRow>
            {testResult && <TestResult result={testResult} />}
            <SettingsRow
              label={t("settings:slackApp.activeLabel")}
              description={t("settings:slackApp.activeHint")}
              htmlFor={`${ids}-active`}
            >
              <Switch
                id={`${ids}-active`}
                checked={connection.isActive}
                disabled={busy}
                onCheckedChange={(checked) => void patch({ isActive: checked })}
              />
            </SettingsRow>
          </SettingsGroup>
        ) : (
          <SettingsEmptyState
            icon={<Plug />}
            title={t("settings:slackApp.notConnected")}
            description={t("settings:slackApp.notConnectedHint")}
          />
        )}
      </SettingsSection>

      <SettingsSection
        title={t("settings:slackApp.setupTitle")}
        description={t("settings:slackApp.setupHint")}
      >
        <SettingsGroup>
          <SettingsRow
            stacked
            label={t("settings:slackApp.step1")}
            description={t("settings:slackApp.step1Hint")}
          >
            <RadioGroup
              className="gap-2"
              value={mode}
              onValueChange={(value) =>
                setMode(value === "http" ? "http" : "socket")
              }
            >
              <label
                className="flex items-start gap-3"
                htmlFor={`${ids}-socket`}
              >
                <Radio className="mt-0.5" id={`${ids}-socket`} value="socket" />
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium text-sm">
                    {t("settings:slackApp.modeSocket")}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t("settings:slackApp.modeSocketHint")}
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-3" htmlFor={`${ids}-http`}>
                <Radio className="mt-0.5" id={`${ids}-http`} value="http" />
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium text-sm">
                    {t("settings:slackApp.modeHttp")}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t("settings:slackApp.modeHttpHint")}
                  </p>
                </div>
              </label>
            </RadioGroup>
          </SettingsRow>

          <SettingsRow
            stacked
            label={t("settings:slackApp.step2")}
            description={t("settings:slackApp.step2Hint")}
            note={
              data.setup.unfurlDomain
                ? undefined
                : t("settings:slackApp.noUnfurlDomain")
            }
          >
            <Textarea
              aria-label={t("settings:slackApp.manifestLabel")}
              className="font-mono text-xs"
              readOnly
              rows={8}
              value={manifest}
            />
            <div className="flex flex-wrap gap-2">
              <CopyButton
                value={manifest}
                label={t("settings:slackApp.copyManifest")}
              />
              <Button
                size="sm"
                type="button"
                variant="ghost"
                render={
                  <a
                    href="https://api.slack.com/apps?new_app=1"
                    rel="noreferrer noopener"
                    target="_blank"
                  />
                }
              >
                <ExternalLink />
                {t("settings:slackApp.openSlack")}
              </Button>
            </div>
          </SettingsRow>

          {mode === "http" && (
            <SettingsRow
              stacked
              label={t("settings:slackApp.eventsUrl")}
              description={t("settings:slackApp.eventsUrlHint")}
            >
              <div className="flex w-full flex-wrap items-center gap-2">
                <Input
                  aria-label={t("settings:slackApp.eventsUrl")}
                  className="min-w-0 flex-1 font-mono text-xs"
                  readOnly
                  value={data.setup.eventsUrl}
                />
                <CopyButton
                  value={data.setup.eventsUrl}
                  label={t("settings:slackApp.copy")}
                />
              </div>
            </SettingsRow>
          )}

          <SettingsRow
            stacked
            label={t("settings:slackApp.step3")}
            description={
              mode === "socket"
                ? t("settings:slackApp.step3SocketHint")
                : t("settings:slackApp.step3HttpHint")
            }
          >
            <div className="grid w-full gap-3">
              <label className="grid gap-1 text-sm" htmlFor={`${ids}-bot`}>
                <span className="font-medium">
                  {t("settings:slackApp.botToken")}
                </span>
                <Input
                  autoComplete="off"
                  id={`${ids}-bot`}
                  placeholder={
                    connection?.maskedBotToken ||
                    t("settings:slackApp.botTokenPlaceholder")
                  }
                  type="password"
                  value={botToken}
                  onChange={(event) => setBotToken(event.target.value)}
                />
              </label>
              {mode === "socket" ? (
                <label className="grid gap-1 text-sm" htmlFor={`${ids}-app`}>
                  <span className="font-medium">
                    {t("settings:slackApp.appToken")}
                  </span>
                  <Input
                    autoComplete="off"
                    id={`${ids}-app`}
                    placeholder={
                      connection?.maskedAppToken ||
                      t("settings:slackApp.appTokenPlaceholder")
                    }
                    type="password"
                    value={appToken}
                    onChange={(event) => setAppToken(event.target.value)}
                  />
                </label>
              ) : (
                <label className="grid gap-1 text-sm" htmlFor={`${ids}-sec`}>
                  <span className="font-medium">
                    {t("settings:slackApp.signingSecret")}
                  </span>
                  <Input
                    autoComplete="off"
                    id={`${ids}-sec`}
                    placeholder={
                      connection?.maskedSigningSecret ||
                      t("settings:slackApp.signingSecretPlaceholder")
                    }
                    type="password"
                    value={signingSecret}
                    onChange={(event) => setSigningSecret(event.target.value)}
                  />
                </label>
              )}
              <p className="text-muted-foreground text-xs">
                {t("settings:slackApp.secretsHint")}
              </p>
              <div>
                <Button
                  size="sm"
                  type="button"
                  loading={connect.isPending || update.isPending}
                  disabled={busy || !canSave}
                  onClick={() => void save()}
                >
                  {connection
                    ? t("settings:slackApp.saveAndTest")
                    : t("settings:slackApp.connectAndTest")}
                </Button>
              </div>
            </div>
          </SettingsRow>

          <SettingsRow
            stacked
            label={t("settings:slackApp.step4")}
            description={t("settings:slackApp.step4Hint")}
          />
        </SettingsGroup>
      </SettingsSection>

      {connection && (
        <SettingsSection title={t("settings:slackApp.optionsTitle")}>
          <SettingsGroup>
            <SettingsRow
              label={t("settings:slackApp.defaultProject")}
              description={t("settings:slackApp.defaultProjectHint")}
            >
              <Select
                disabled={busy}
                value={connection.defaultProjectId ?? NO_PROJECT}
                onValueChange={(value) =>
                  void patch({
                    defaultProjectId:
                      value === NO_PROJECT ? null : String(value),
                  })
                }
              >
                <SelectTrigger
                  className="w-56"
                  aria-label={t("settings:slackApp.defaultProject")}
                >
                  <SelectValue>
                    {projects.find(
                      (project) => project.id === connection.defaultProjectId,
                    )?.name ?? t("settings:slackApp.noDefaultProject")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROJECT}>
                    {t("settings:slackApp.noDefaultProject")}
                  </SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
            <SettingsRow
              label={t("settings:slackApp.expandKeys")}
              description={t("settings:slackApp.expandKeysHint")}
              htmlFor={`${ids}-keys`}
            >
              <Switch
                id={`${ids}-keys`}
                checked={connection.expandTaskKeys}
                disabled={busy}
                onCheckedChange={(checked) =>
                  void patch({ expandTaskKeys: checked })
                }
              />
            </SettingsRow>
          </SettingsGroup>
        </SettingsSection>
      )}

      {connection && (
        <SettingsDangerZone title={t("settings:slackApp.dangerTitle")}>
          <SettingsRow
            label={t("settings:slackApp.disconnect")}
            description={t("settings:slackApp.disconnectHint")}
          >
            <Button
              size="sm"
              type="button"
              variant="destructive-outline"
              loading={disconnect.isPending}
              disabled={busy}
              onClick={() => void remove()}
            >
              <Unplug />
              {t("settings:slackApp.disconnect")}
            </Button>
          </SettingsRow>
        </SettingsDangerZone>
      )}
    </>,
  );
}

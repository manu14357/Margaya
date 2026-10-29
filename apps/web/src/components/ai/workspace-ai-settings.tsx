import { KeyRound, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import AiBudgetBanner from "@/components/ai/ai-budget-banner";
import {
  SettingsGroup,
  SettingsGroupMessage,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@/components/settings-layout";
import { Badge } from "@/components/ui/badge";
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
import {
  type AiSettings,
  type AiSettingsPatch,
  exportAiUsageCsv,
  testAiConnection,
} from "@/fetchers/ai/ai";
import { useUpdateAiSettings } from "@/hooks/mutations/ai/use-ai-mutations";
import { useAiSettings, useAiUsage } from "@/hooks/queries/ai/use-ai";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  aiErrorKey,
  dollarsToMicros,
  formatCostMicros,
  microsToDollarsInput,
  type UsageRange,
  usageRangeDays,
} from "@/lib/ai/format";
import {
  AI_DESTINATION_KEYS,
  AI_FEATURE_KEYS,
  AI_PROVIDER_KEYS,
} from "@/lib/ai/labels";
import { toast } from "@/lib/toast";
import { AiTestButton } from "./ai-test-button";
import {
  AiUsageDashboard,
  UsageExportButton,
  UsageRangeSelect,
} from "./ai-usage-dashboard";

type KeyProvider = "anthropic" | "openai_compatible";

/** Settings → Workspace → AI (ai:manage). */
export function WorkspaceAiSettingsPage() {
  const { t } = useTranslation();
  const { workspace, canManageAi, isCheckingPermissions } =
    useWorkspacePermission();
  const workspaceId = workspace?.id ?? "";
  const allowed = !isCheckingPermissions && canManageAi();
  const settings = useAiSettings(workspaceId, allowed);

  return (
    <SettingsPage
      title={t("ai:workspace.title")}
      description={t("ai:workspace.subtitle")}
    >
      {isCheckingPermissions || (allowed && settings.isLoading) ? (
        <Skeleton className="h-40 w-full" />
      ) : !allowed ? (
        <SettingsGroup>
          <SettingsGroupMessage>
            {t("ai:workspace.noAccess")}
          </SettingsGroupMessage>
        </SettingsGroup>
      ) : settings.isError || !settings.data ? (
        <SettingsGroup>
          <div className="flex items-center gap-3 px-4 py-4 text-muted-foreground text-xs">
            <span>{t("ai:workspace.loadError")}</span>
            <Button
              variant="outline"
              size="xs"
              onClick={() => void settings.refetch()}
            >
              {t("ai:usage.retry")}
            </Button>
          </div>
        </SettingsGroup>
      ) : (
        <WorkspaceAiForm
          key={workspaceId}
          workspaceId={workspaceId}
          settings={settings.data}
        />
      )}
    </SettingsPage>
  );
}

function WorkspaceAiForm({
  workspaceId,
  settings,
}: {
  workspaceId: string;
  settings: AiSettings;
}) {
  const { t, i18n } = useTranslation();
  const update = useUpdateAiSettings();
  const { instance, workspace } = settings;
  const [range, setRange] = useState<UsageRange>("thisMonth");
  const days = usageRangeDays(range);
  const usage = useAiUsage({ workspaceId, ...days });

  const save = async (
    patch: Omit<AiSettingsPatch, "workspaceId">,
    successKey = "ai:workspace.saved",
  ) => {
    try {
      await update.mutateAsync({ workspaceId, ...patch });
      toast.success(t(successKey));
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("ai:workspace.saveError"),
      );
      return false;
    }
  };

  const instanceOff = !instance.enabled;
  const redactForced = instance.redaction;
  const { semantic } = settings;
  const semanticSupported =
    semantic.endpointConfigured && semantic.vectorStore !== "unavailable";
  const semanticNote = !semantic.endpointConfigured
    ? t("ai:workspace.semanticNoEndpoint")
    : semantic.vectorStore === "unavailable"
      ? t("ai:workspace.semanticUnavailable")
      : !workspace.embeddingsEnabled
        ? undefined
        : semantic.paused
          ? t("ai:workspace.semanticPaused", {
              reason: t(aiErrorKey({ code: semantic.paused })),
            })
          : t("ai:workspace.semanticIndexed", {
              count: semantic.indexedItems,
            });

  const switchRow = (
    id: string,
    label: string,
    hint: string,
    checked: boolean,
    onChange: (next: boolean) => void,
    options: { disabled?: boolean; note?: string } = {},
  ) => (
    <SettingsRow
      label={label}
      htmlFor={id}
      description={hint}
      note={options.note}
    >
      <Switch
        id={id}
        checked={checked}
        disabled={options.disabled || update.isPending}
        onCheckedChange={onChange}
      />
    </SettingsRow>
  );

  return (
    <>
      <AiBudgetBanner workspaceId={workspaceId} className="mb-4" />
      <SettingsSection
        title={t("ai:workspace.statusTitle")}
        description={t("ai:workspace.statusDescription")}
      >
        <SettingsGroup>
          {switchRow(
            "ai-workspace-enabled",
            t("ai:workspace.enable"),
            t("ai:workspace.enableHint"),
            workspace.enabled,
            (next) =>
              void save(
                { enabled: next },
                next
                  ? "ai:workspace.enabledToast"
                  : "ai:workspace.disabledToast",
              ),
            {
              disabled: instanceOff && !workspace.enabled,
              note: instanceOff
                ? t("ai:workspace.offOnInstance")
                : !instance.configured
                  ? t("ai:workspace.notConfigured")
                  : undefined,
            },
          )}
          {switchRow(
            "ai-workspace-auto-translate",
            t("ai:translate.settings.autoTranslate"),
            t("ai:translate.settings.autoTranslateHint"),
            workspace.autoTranslateComments,
            (next) => void save({ autoTranslateComments: next }),
            { disabled: !workspace.enabled },
          )}
          {switchRow(
            "ai-workspace-semantic",
            t("ai:workspace.semanticSearch"),
            t("ai:workspace.semanticSearchHint"),
            workspace.embeddingsEnabled,
            (next) =>
              void save(
                { embeddingsEnabled: next },
                next
                  ? "ai:workspace.semanticEnabledToast"
                  : "ai:workspace.semanticDisabledToast",
              ),
            {
              // Turning it off always works; on needs the server's support.
              disabled:
                !workspace.embeddingsEnabled &&
                (!workspace.enabled || !semanticSupported),
              note: semanticNote,
            },
          )}
          <SettingsRow
            label={t("ai:workspace.whereDataGoes")}
            description={t("ai:workspace.whereDataGoesHint")}
          >
            <Badge variant="outline" className="gap-1">
              <Sparkles className="size-3" aria-hidden />
              {workspace.localOnly || instance.localOnly
                ? t(AI_DESTINATION_KEYS.local)
                : t(AI_PROVIDER_KEYS[workspace.provider ?? instance.provider])}
            </Badge>
            {instance.zeroRetention && (
              <Badge variant="outline">{t("ai:workspace.zeroRetention")}</Badge>
            )}
            {instance.storePrompts && (
              <Badge variant="outline">{t("ai:workspace.storesPrompts")}</Badge>
            )}
          </SettingsRow>
          <SettingsRow
            label={t("ai:test.title")}
            description={t("ai:test.workspaceHint")}
          >
            <AiTestButton
              label={t("ai:test.button")}
              disabled={instanceOff}
              run={() => testAiConnection(workspaceId)}
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>

      <LimitsSection
        settings={settings}
        onSave={save}
        pending={update.isPending}
      />

      <SettingsSection
        title={t("ai:workspace.privacyTitle")}
        description={t("ai:workspace.privacyDescription")}
      >
        <SettingsGroup>
          {switchRow(
            "ai-workspace-restricted",
            t("ai:workspace.includeRestricted"),
            t("ai:workspace.includeRestrictedHint"),
            workspace.includeRestricted,
            (next) => void save({ includeRestricted: next }),
          )}
          {switchRow(
            "ai-workspace-local-only",
            t("ai:workspace.localOnly"),
            t("ai:workspace.localOnlyHint"),
            workspace.localOnly || instance.localOnly,
            (next) => void save({ localOnly: next }),
            {
              disabled:
                instance.localOnly ||
                (!instance.localAvailable && !workspace.localOnly),
              note: instance.localOnly
                ? t("ai:workspace.localOnlyForced")
                : !instance.localAvailable
                  ? t("ai:workspace.localOnlyUnavailable")
                  : undefined,
            },
          )}
          {switchRow(
            "ai-workspace-redact",
            t("ai:workspace.redactPii"),
            t("ai:workspace.redactPiiHint"),
            workspace.redactPii || redactForced,
            (next) => void save({ redactPii: next }),
            {
              disabled: redactForced,
              note: redactForced
                ? t("ai:workspace.redactPiiForced")
                : undefined,
            },
          )}
          {switchRow(
            "ai-workspace-approval",
            t("ai:workspace.approval"),
            t("ai:workspace.approvalHint"),
            workspace.requireApprovalForWrites,
            (next) => void save({ requireApprovalForWrites: next }),
          )}
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title={t("ai:workspace.chatTitle")}
        description={t("ai:workspace.chatDescription")}
      >
        <SettingsGroup>
          {switchRow(
            "ai-workspace-web-search",
            t("ai:workspace.webSearch"),
            t("ai:workspace.webSearchHint"),
            workspace.webSearchEnabled,
            (next) => void save({ webSearchEnabled: next }),
            {
              // Turning it off always works; on needs the instance's search.
              disabled:
                !workspace.webSearchEnabled &&
                (!workspace.enabled || !instance.webSearchAvailable),
              note: !instance.webSearchAvailable
                ? t("ai:workspace.webSearchUnavailable")
                : workspace.localOnly || instance.localOnly
                  ? t("ai:workspace.webSearchLocalOnly")
                  : undefined,
            },
          )}
          {switchRow(
            "ai-workspace-store-conversations",
            t("ai:workspace.storeConversations"),
            t("ai:workspace.storeConversationsHint"),
            workspace.storeConversations,
            (next) => void save({ storeConversations: next }),
          )}
          {switchRow(
            "ai-workspace-autopilot",
            t("ai:workspace.allowAutopilot"),
            t("ai:workspace.allowAutopilotHint"),
            workspace.allowAutopilot,
            (next) => void save({ allowAutopilot: next }),
          )}
        </SettingsGroup>
      </SettingsSection>

      {instance.allowWorkspaceKeys && (
        <KeySection
          settings={settings}
          onSave={save}
          pending={update.isPending}
        />
      )}

      <SettingsSection
        title={t("ai:usage.title")}
        description={t("ai:usage.subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <UsageRangeSelect value={range} onChange={setRange} />
            <UsageExportButton
              fileName={`ai-usage-${days.from}-${days.to}.csv`}
              load={() => exportAiUsageCsv({ workspaceId, ...days })}
            />
          </div>
        }
      >
        <AiUsageDashboard
          feedback={
            usage.data?.feedback
              ? {
                  up: usage.data.feedback.up,
                  down: usage.data.feedback.down,
                  byFeature: usage.data.feedback.byFeature.map((row) => ({
                    ...row,
                    id: row.feature,
                    label: AI_FEATURE_KEYS[row.feature]
                      ? t(AI_FEATURE_KEYS[row.feature] as string)
                      : row.feature,
                  })),
                }
              : undefined
          }
          totals={usage.data?.totals}
          byDay={usage.data?.byDay ?? []}
          isLoading={usage.isLoading}
          isError={usage.isError}
          onRetry={() => void usage.refetch()}
          tables={[
            {
              title: t("ai:usage.byFeature"),
              rows: (usage.data?.byFeature ?? []).map((row) => ({
                ...row,
                id: row.feature,
                label: AI_FEATURE_KEYS[row.feature]
                  ? t(AI_FEATURE_KEYS[row.feature] as string)
                  : row.feature,
              })),
            },
            {
              title: t("ai:usage.byUser"),
              rows: (usage.data?.byUser ?? []).map((row) => ({
                ...row,
                id: row.userId ?? "removed",
                label: row.name ?? t("ai:usage.unknownUser"),
              })),
            },
            {
              title: t("ai:usage.byModel"),
              rows: (usage.data?.byModel ?? []).map((row) => ({
                ...row,
                id: `${row.provider}:${row.model}`,
                label: row.model,
              })),
            },
          ]}
        />
        {settings.workspace.monthlyCapMicros !== null && (
          <p className="text-muted-foreground text-xs">
            {t("ai:workspace.monthSpendOfCap", {
              spent: formatCostMicros(settings.monthSpendMicros, i18n.language),
              cap: formatCostMicros(
                settings.workspace.monthlyCapMicros,
                i18n.language,
              ),
            })}
          </p>
        )}
      </SettingsSection>
    </>
  );
}

type SectionProps = {
  settings: AiSettings;
  onSave: (
    patch: Omit<AiSettingsPatch, "workspaceId">,
    successKey?: string,
  ) => Promise<boolean>;
  pending: boolean;
};

function LimitsSection({ settings, onSave, pending }: SectionProps) {
  const { t, i18n } = useTranslation();
  const initialCap = microsToDollarsInput(settings.workspace.monthlyCapMicros);
  const initialDaily =
    settings.workspace.userDailyCapTokens === null
      ? ""
      : String(settings.workspace.userDailyCapTokens);
  const [cap, setCap] = useState(initialCap);
  const [daily, setDaily] = useState(initialDaily);

  const capMicros = dollarsToMicros(cap);
  const dailyTrimmed = daily.trim();
  const dailyTokens = dailyTrimmed ? Number(dailyTrimmed) : null;
  const capInvalid = capMicros !== null && Number.isNaN(capMicros);
  const dailyInvalid =
    dailyTokens !== null && (!Number.isInteger(dailyTokens) || dailyTokens < 0);
  const dirty = cap !== initialCap || daily !== initialDaily;

  const handleSave = async () => {
    if (capInvalid || dailyInvalid) return;
    await onSave({
      monthlyCapMicros: capMicros,
      userDailyCapTokens: dailyTokens,
    });
  };

  return (
    <SettingsSection
      title={t("ai:workspace.limitsTitle")}
      description={t("ai:workspace.limitsDescription", {
        spent: formatCostMicros(settings.monthSpendMicros, i18n.language),
      })}
    >
      <SettingsGroup>
        <SettingsRow
          label={t("ai:workspace.monthlyCap")}
          htmlFor="ai-monthly-cap"
          description={t("ai:workspace.monthlyCapHint")}
          note={capInvalid ? t("ai:workspace.invalidNumber") : undefined}
        >
          <Input
            id="ai-monthly-cap"
            inputMode="decimal"
            className="w-32"
            placeholder={t("ai:workspace.noLimit")}
            value={cap}
            aria-invalid={capInvalid || undefined}
            onChange={(event) => setCap(event.target.value)}
          />
        </SettingsRow>
        <SettingsRow
          label={t("ai:workspace.dailyTokens")}
          htmlFor="ai-daily-tokens"
          description={t("ai:workspace.dailyTokensHint")}
          note={dailyInvalid ? t("ai:workspace.invalidNumber") : undefined}
        >
          <Input
            id="ai-daily-tokens"
            inputMode="numeric"
            className="w-32"
            placeholder={t("ai:workspace.noLimit")}
            value={daily}
            aria-invalid={dailyInvalid || undefined}
            onChange={(event) => setDaily(event.target.value)}
          />
        </SettingsRow>
        <div className="flex justify-end px-4 py-3">
          <Button
            type="button"
            size="sm"
            disabled={!dirty || capInvalid || dailyInvalid}
            loading={pending}
            onClick={() => void handleSave()}
          >
            {t("ai:workspace.saveLimits")}
          </Button>
        </div>
      </SettingsGroup>
    </SettingsSection>
  );
}

function KeySection({ settings, onSave, pending }: SectionProps) {
  const { t } = useTranslation();
  const { workspace, instance } = settings;
  const [provider, setProvider] = useState<KeyProvider>(
    workspace.provider ??
      (instance.provider === "openai_compatible"
        ? "openai_compatible"
        : "anthropic"),
  );
  const [apiKey, setApiKey] = useState("");
  const tooShort = apiKey.trim().length > 0 && apiKey.trim().length < 8;

  const handleSave = async () => {
    if (apiKey.trim().length < 8) return;
    if (
      await onSave(
        { key: { provider, apiKey: apiKey.trim() } },
        "ai:workspace.keySavedToast",
      )
    ) {
      setApiKey("");
    }
  };

  return (
    <SettingsSection
      title={t("ai:workspace.keyTitle")}
      description={t("ai:workspace.keyDescription")}
    >
      <SettingsGroup>
        {workspace.hasKey && (
          <SettingsRow
            label={t("ai:workspace.keyCurrent")}
            description={
              workspace.keyUnreadable
                ? t("ai:workspace.keyUnreadable")
                : t(AI_PROVIDER_KEYS[workspace.provider ?? "anthropic"])
            }
          >
            <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
              <KeyRound className="size-3.5" aria-hidden />
              {t("ai:workspace.keyEnding", { last4: workspace.keyLast4 ?? "" })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                void onSave({ key: null }, "ai:workspace.keyRemovedToast")
              }
            >
              {t("ai:workspace.keyRemove")}
            </Button>
          </SettingsRow>
        )}
        <SettingsRow
          label={t("ai:workspace.keyProvider")}
          htmlFor="ai-key-provider"
        >
          <Select
            value={provider}
            onValueChange={(value) => setProvider(value as KeyProvider)}
          >
            <SelectTrigger id="ai-key-provider" className="w-56">
              <SelectValue>{t(AI_PROVIDER_KEYS[provider])}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(["anthropic", "openai_compatible"] as const).map((option) => (
                <SelectItem key={option} value={option}>
                  {t(AI_PROVIDER_KEYS[option])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow
          label={
            workspace.hasKey
              ? t("ai:workspace.keyReplace")
              : t("ai:workspace.keyValue")
          }
          htmlFor="ai-key-value"
          description={
            provider === "openai_compatible"
              ? t("ai:workspace.keyOpenAiHint")
              : t("ai:workspace.keyHint")
          }
          note={tooShort ? t("ai:workspace.keyTooShort") : undefined}
        >
          <Input
            id="ai-key-value"
            type="password"
            autoComplete="new-password"
            className="w-56"
            value={apiKey}
            placeholder={t("ai:workspace.keyPlaceholder")}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            disabled={apiKey.trim().length < 8}
            loading={pending}
            onClick={() => void handleSave()}
          >
            {t("ai:workspace.keySave")}
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}

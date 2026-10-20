import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  InstanceLoadState,
  InstancePage,
  InstanceSection,
} from "@/components/instance-admin/instance-page";
import { SecretField } from "@/components/instance-admin/secret-field";
import {
  SettingRow,
  SettingSwitchRow,
} from "@/components/instance-admin/setting-row";
import { SourceBadge } from "@/components/instance-admin/source-badge";
import { useSaveInstanceSettings } from "@/components/instance-admin/use-save-instance-settings";
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
import { Separator } from "@/components/ui/separator";
import { testInstanceAiConnection } from "@/fetchers/ai/ai";
import {
  useInstanceAiStatus,
  useInstanceAiUsage,
} from "@/hooks/queries/ai/use-ai";
import { useInstanceSettings } from "@/hooks/queries/instance-admin/use-instance-admin";
import { type UsageRange, usageRangeDays } from "@/lib/ai/format";
import {
  AI_PROVIDER_KEYS,
  AI_ROUTE_KEYS,
  AI_TIER_HINT_KEYS,
  AI_TIER_KEYS,
  type AiProviderId,
} from "@/lib/ai/labels";
import {
  indexSettings,
  isSettingLocked,
  settingText,
} from "@/lib/instance-settings";
import type { InstanceSettings } from "@/types/instance-admin";
import { AiTestButton } from "./ai-test-button";
import { AiUsageDashboard, UsageRangeSelect } from "./ai-usage-dashboard";

/** Settings → Instance → AI. */
export function InstanceAiSettingsPage() {
  const { t } = useTranslation();
  const settings = useInstanceSettings();
  const status = useInstanceAiStatus();
  const [range, setRange] = useState<UsageRange>("thisMonth");
  const days = usageRangeDays(range);
  const usage = useInstanceAiUsage(days.from, days.to);

  const statusBadge = status.data ? (
    !status.data.enabled ? (
      <Badge variant="outline" className="text-muted-foreground">
        {t("ai:instance.statusOff")}
      </Badge>
    ) : status.data.configured ? (
      <Badge variant="success">{t("ai:instance.statusReady")}</Badge>
    ) : (
      <Badge variant="outline" className="text-warning-foreground">
        {t("ai:instance.statusNotConfigured")}
      </Badge>
    )
  ) : null;

  // pgvector on the database: semantic search needs it (D1).
  const vectorStore = status.data?.vectorStore;
  const vectorBadge =
    vectorStore === "ready" ? (
      <Badge variant="success">{t("ai:instance.vectorReady")}</Badge>
    ) : vectorStore === "available" ? (
      <Badge variant="outline">{t("ai:instance.vectorAvailable")}</Badge>
    ) : vectorStore === "unavailable" ? (
      <Badge variant="outline" className="text-muted-foreground">
        {t("ai:instance.vectorUnavailable")}
      </Badge>
    ) : null;

  return (
    <InstancePage
      title={t("ai:instance.title")}
      subtitle={t("ai:instance.subtitle")}
      locked={settings.data?.locked}
    >
      {!settings.data ? (
        <InstanceSection title={t("ai:instance.statusTitle")}>
          <InstanceLoadState
            isLoading={settings.isLoading}
            isError={settings.isError}
            onRetry={() => void settings.refetch()}
            rows={4}
          />
        </InstanceSection>
      ) : (
        <>
          <InstanceSection
            title={t("ai:instance.statusTitle")}
            actions={statusBadge}
          >
            <SettingSwitchRow
              settings={settings.data}
              settingKey="ai.enabled"
              label={t("ai:instance.enable")}
              hint={t("ai:instance.enableHint")}
            />
          </InstanceSection>

          <InstanceSection
            title={t("ai:instance.providerTitle")}
            description={t("ai:instance.providerDescription")}
          >
            <ProviderSelect
              settings={settings.data}
              fakeAllowed={status.data?.fakeAllowed === true}
            />
            <Separator />
            <ProviderFields
              settings={settings.data}
              defaults={status.data?.models}
            />
          </InstanceSection>

          <InstanceSection
            title={t("ai:instance.localTitle")}
            description={t("ai:instance.localDescription")}
          >
            <FieldsForm
              settings={settings.data}
              fields={[
                {
                  key: "ai.local.baseUrl",
                  label: t("ai:instance.localBaseUrl"),
                  hint: t("ai:instance.localBaseUrlHint"),
                  placeholder: "http://ollama:11434/v1",
                  url: true,
                },
                {
                  key: "ai.local.model",
                  label: t("ai:instance.localModel"),
                  placeholder: "llama3.3",
                },
                {
                  key: "ai.local.apiKey",
                  label: t("ai:instance.localKey"),
                  hint: t("ai:instance.localKeyHint"),
                  secret: true,
                },
              ]}
              extra={
                <AiTestButton
                  label={t("ai:instance.testLocal")}
                  disabled={!status.data?.localAvailable}
                  run={() => testInstanceAiConnection("local")}
                />
              }
            />
            <Separator />
            <SettingSwitchRow
              settings={settings.data}
              settingKey="ai.localOnly"
              label={t("ai:instance.localOnly")}
              hint={t("ai:instance.localOnlyHint")}
            />
          </InstanceSection>

          <InstanceSection
            title={t("ai:instance.privacyTitle")}
            description={t("ai:instance.privacyDescription")}
          >
            <RouteSelect
              settings={settings.data}
              settingKey="ai.route.restricted"
              label={t("ai:instance.restrictedRoute")}
              hint={t("ai:instance.restrictedRouteHint")}
              options={["blocked", "local", "cloud"]}
            />
            <Separator />
            <RouteSelect
              settings={settings.data}
              settingKey="ai.route.private"
              label={t("ai:instance.privateRoute")}
              hint={t("ai:instance.privateRouteHint")}
              options={["local", "cloud"]}
            />
            <Separator />
            <SettingSwitchRow
              settings={settings.data}
              settingKey="ai.redaction.enabled"
              label={t("ai:instance.redaction")}
              hint={t("ai:instance.redactionHint")}
            />
            <Separator />
            <SettingSwitchRow
              settings={settings.data}
              settingKey="ai.zeroRetention"
              label={t("ai:instance.zeroRetention")}
              hint={t("ai:instance.zeroRetentionHint")}
            />
            <Separator />
            <SettingSwitchRow
              settings={settings.data}
              settingKey="ai.allowWorkspaceKeys"
              label={t("ai:instance.allowWorkspaceKeys")}
              hint={t("ai:instance.allowWorkspaceKeysHint")}
            />
          </InstanceSection>

          <InstanceSection
            title={t("ai:instance.embeddingsTitle")}
            description={t("ai:instance.embeddingsDescription")}
            actions={vectorBadge}
          >
            <FieldsForm
              settings={settings.data}
              fields={[
                {
                  key: "ai.embeddings.baseUrl",
                  label: t("ai:instance.embeddingsBaseUrl"),
                  placeholder: "https://api.openai.com/v1",
                  url: true,
                },
                {
                  key: "ai.embeddings.model",
                  label: t("ai:instance.embeddingsModel"),
                  placeholder: "text-embedding-3-small",
                },
                {
                  key: "ai.embeddings.apiKey",
                  label: t("ai:instance.embeddingsKey"),
                  secret: true,
                },
              ]}
            />
          </InstanceSection>

          <InstanceSection
            title={t("ai:instance.chatTitle")}
            description={t("ai:instance.chatDescription")}
          >
            <SettingSwitchRow
              settings={settings.data}
              settingKey="ai.showReasoning"
              label={t("ai:instance.showReasoning")}
              hint={t("ai:instance.showReasoningHint")}
            />
            <Separator />
            <ChoiceSelect
              settings={settings.data}
              settingKey="ai.local.thinking"
              label={t("ai:instance.localThinking")}
              hint={t("ai:instance.localThinkingHint")}
              options={[
                { value: "off", label: t("ai:instance.localThinkingOff") },
                { value: "on", label: t("ai:instance.localThinkingOn") },
              ]}
            />
          </InstanceSection>

          <InstanceSection
            title={t("ai:instance.webSearchTitle")}
            description={t("ai:instance.webSearchDescription")}
          >
            <ChoiceSelect
              settings={settings.data}
              settingKey="ai.webSearch.provider"
              label={t("ai:instance.webSearchProvider")}
              hint={t("ai:instance.webSearchProviderHint")}
              options={[
                { value: "off", label: t("ai:instance.webSearchOff") },
                { value: "searxng", label: "SearXNG" },
                { value: "brave", label: "Brave Search" },
                { value: "tavily", label: "Tavily" },
              ]}
            />
            <Separator />
            <FieldsForm
              settings={settings.data}
              fields={[
                {
                  key: "ai.webSearch.url",
                  label: t("ai:instance.webSearchUrl"),
                  hint: t("ai:instance.webSearchUrlHint"),
                  placeholder: "http://searxng:8080",
                  url: true,
                },
                {
                  key: "ai.webSearch.apiKey",
                  label: t("ai:instance.webSearchKey"),
                  hint: t("ai:instance.webSearchKeyHint"),
                  secret: true,
                },
              ]}
            />
          </InstanceSection>

          <InstanceSection
            title={t("ai:instance.speechTitle")}
            description={t("ai:instance.speechDescription")}
          >
            <FieldsForm
              settings={settings.data}
              fields={[
                {
                  key: "ai.speech.baseUrl",
                  label: t("ai:instance.speechBaseUrl"),
                  hint: t("ai:instance.speechBaseUrlHint"),
                  placeholder: "http://whisper:8000/v1",
                  url: true,
                },
                {
                  key: "ai.speech.model",
                  label: t("ai:instance.speechModel"),
                  placeholder: "whisper-1",
                },
                {
                  key: "ai.speech.apiKey",
                  label: t("ai:instance.speechKey"),
                  secret: true,
                },
              ]}
            />
          </InstanceSection>
        </>
      )}

      <InstanceSection
        title={t("ai:instance.usageTitle")}
        description={t("ai:instance.usageDescription")}
        boxed={false}
        actions={<UsageRangeSelect value={range} onChange={setRange} />}
      >
        <AiUsageDashboard
          totals={usage.data?.totals}
          byDay={usage.data?.byDay ?? []}
          isLoading={usage.isLoading}
          isError={usage.isError}
          onRetry={() => void usage.refetch()}
          tables={[
            {
              title: t("ai:usage.byWorkspace"),
              rows: (usage.data?.byWorkspace ?? []).map((row) => ({
                ...row,
                id: row.workspaceId,
                label: row.name,
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
      </InstanceSection>
    </InstancePage>
  );
}

/** Saves through the instance settings route, then refreshes AI state. */
function useSaveAi() {
  const queryClient = useQueryClient();
  const { save, isPending } = useSaveInstanceSettings();
  return {
    isPending,
    save: async (...args: Parameters<typeof save>) => {
      const ok = await save(...args);
      if (ok) void queryClient.invalidateQueries({ queryKey: ["ai"] });
      return ok;
    },
  };
}

function ProviderSelect({
  settings,
  fakeAllowed,
}: {
  settings: InstanceSettings;
  fakeAllowed: boolean;
}) {
  const { t } = useTranslation();
  const { save, isPending } = useSaveAi();
  const index = indexSettings(settings);
  const entry = index.get("ai.provider");
  const current = (settingText(index, "ai.provider") ||
    "anthropic") as AiProviderId;
  const options: AiProviderId[] = [
    "anthropic",
    "openai_compatible",
    ...(fakeAllowed || current === "fake" ? (["fake"] as const) : []),
  ];
  return (
    <SettingRow
      id="ai-provider"
      label={t("ai:instance.provider")}
      hint={t("ai:instance.providerHint")}
      entry={entry}
    >
      <Select
        value={current}
        disabled={isSettingLocked(settings, entry) || isPending}
        onValueChange={(value) => void save({ "ai.provider": value as string })}
      >
        <SelectTrigger id="ai-provider" className="w-56">
          <SelectValue>{t(AI_PROVIDER_KEYS[current])}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {t(AI_PROVIDER_KEYS[option])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

/** A setting with a fixed list of values, saved as soon as it is picked. */
function ChoiceSelect({
  settings,
  settingKey,
  label,
  hint,
  options,
}: {
  settings: InstanceSettings;
  settingKey: string;
  label: string;
  hint: string;
  options: { value: string; label: string }[];
}) {
  const { save, isPending } = useSaveAi();
  const index = indexSettings(settings);
  const entry = index.get(settingKey);
  if (!entry) return null;
  const current = settingText(index, settingKey) || options[0]?.value || "";
  const id = `ai-${settingKey.replace(/\./g, "-")}`;
  return (
    <SettingRow id={id} label={label} hint={hint} entry={entry}>
      <Select
        value={current}
        disabled={isSettingLocked(settings, entry) || isPending}
        onValueChange={(value) => void save({ [settingKey]: value as string })}
      >
        <SelectTrigger id={id} className="w-56">
          <SelectValue>
            {options.find((option) => option.value === current)?.label ??
              current}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

function RouteSelect({
  settings,
  settingKey,
  label,
  hint,
  options,
}: {
  settings: InstanceSettings;
  settingKey: string;
  label: string;
  hint: string;
  options: (keyof typeof AI_ROUTE_KEYS)[];
}) {
  const { t } = useTranslation();
  const { save, isPending } = useSaveAi();
  const index = indexSettings(settings);
  const entry = index.get(settingKey);
  const current = settingText(index, settingKey) as keyof typeof AI_ROUTE_KEYS;
  const id = `ai-${settingKey.replace(/\./g, "-")}`;
  return (
    <SettingRow id={id} label={label} hint={hint} entry={entry}>
      <Select
        value={current}
        disabled={isSettingLocked(settings, entry) || isPending}
        onValueChange={(value) => void save({ [settingKey]: value as string })}
      >
        <SelectTrigger id={id} className="w-56">
          <SelectValue>
            {current in AI_ROUTE_KEYS ? t(AI_ROUTE_KEYS[current]) : current}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {t(AI_ROUTE_KEYS[option])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

function ProviderFields({
  settings,
  defaults,
}: {
  settings: InstanceSettings;
  defaults?: { fast: string; balanced: string; deep: string };
}) {
  const { t } = useTranslation();
  const index = indexSettings(settings);
  const provider = (settingText(index, "ai.provider") ||
    "anthropic") as AiProviderId;
  const modelField = (tier: "fast" | "balanced" | "deep") => ({
    key: `ai.models.${tier}`,
    label: t(AI_TIER_KEYS[tier]),
    hint: t(AI_TIER_HINT_KEYS[tier]),
    placeholder:
      defaults?.[tier] && !settingText(index, `ai.models.${tier}`)
        ? defaults[tier]
        : undefined,
  });
  const providerFields =
    provider === "anthropic"
      ? [
          {
            key: "ai.anthropic.apiKey",
            label: t("ai:instance.anthropicKey"),
            hint: t("ai:instance.anthropicKeyHint"),
            secret: true,
          },
        ]
      : provider === "openai_compatible"
        ? [
            {
              key: "ai.openai.baseUrl",
              label: t("ai:instance.openaiBaseUrl"),
              hint: t("ai:instance.openaiBaseUrlHint"),
              placeholder: "https://api.openai.com/v1",
              url: true,
            },
            {
              key: "ai.openai.apiKey",
              label: t("ai:instance.openaiKey"),
              secret: true,
            },
          ]
        : [];
  return (
    <FieldsForm
      key={provider}
      settings={settings}
      fields={[
        ...providerFields,
        modelField("fast"),
        modelField("balanced"),
        modelField("deep"),
      ]}
      extra={
        <AiTestButton
          label={t("ai:instance.testCloud")}
          run={() => testInstanceAiConnection("cloud")}
        />
      }
    />
  );
}

type Field = {
  key: string;
  label: string;
  hint?: string;
  placeholder?: string;
  secret?: boolean;
  url?: boolean;
};

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Text and secret settings saved together; blank text clears to default. */
function FieldsForm({
  settings,
  fields,
  extra,
}: {
  settings: InstanceSettings;
  fields: Field[];
  extra?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const index = indexSettings(settings);
  const { save, isPending } = useSaveAi();
  const initial = Object.fromEntries(
    fields
      .filter((field) => !field.secret)
      .map((field) => [field.key, settingText(index, field.key)]),
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [clearing, setClearing] = useState<string | null>(null);

  const invalid = fields.filter(
    (field) =>
      field.url &&
      values[field.key]?.trim() &&
      !isHttpUrl(values[field.key]?.trim() ?? ""),
  );
  const patch: Record<string, string | null> = {};
  for (const field of fields) {
    const entry = index.get(field.key);
    if (!entry || isSettingLocked(settings, entry)) continue;
    if (field.secret) {
      const typed = secrets[field.key]?.trim();
      if (typed) patch[field.key] = typed;
      continue;
    }
    const next = (values[field.key] ?? "").trim();
    if (next !== (initial[field.key] ?? "")) patch[field.key] = next || null;
  }
  const dirty = Object.keys(patch).length > 0;
  const allLocked = fields.every((field) =>
    isSettingLocked(settings, index.get(field.key)),
  );

  const handleSave = async () => {
    if (!dirty || invalid.length > 0) return;
    if (await save(patch)) setSecrets({});
  };

  return (
    <div className="space-y-3">
      {fields.map((field) => {
        const entry = index.get(field.key);
        if (!entry) return null;
        const id = `ai-field-${field.key.replace(/\./g, "-")}`;
        const locked = isSettingLocked(settings, entry);
        const isInvalid = invalid.includes(field);
        return (
          <div key={field.key} className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={id} className="font-medium text-sm">
                {field.label}
              </label>
              <SourceBadge entry={entry} />
            </div>
            {field.secret ? (
              <SecretField
                key={`${entry.updatedAt}-${entry.configured}`}
                id={id}
                entry={entry}
                value={secrets[field.key] ?? ""}
                onChange={(value) =>
                  setSecrets((current) => ({ ...current, [field.key]: value }))
                }
                onClear={async () => {
                  setClearing(field.key);
                  await save(
                    { [field.key]: null },
                    t("instanceAdmin:secret.cleared"),
                  );
                  setClearing(null);
                }}
                clearing={clearing === field.key}
                disabled={locked}
              />
            ) : (
              <Input
                id={id}
                value={values[field.key] ?? ""}
                placeholder={field.placeholder}
                disabled={locked}
                autoComplete="off"
                aria-invalid={isInvalid || undefined}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
              />
            )}
            {(isInvalid || field.hint) && (
              <p
                className={
                  isInvalid
                    ? "text-destructive-foreground text-xs"
                    : "text-muted-foreground text-xs"
                }
              >
                {isInvalid ? t("ai:instance.invalidUrl") : field.hint}
              </p>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        {!allLocked && (
          <Button
            type="button"
            size="sm"
            disabled={!dirty || invalid.length > 0}
            loading={isPending && clearing === null}
            onClick={() => void handleSave()}
          >
            {t("ai:instance.save")}
          </Button>
        )}
        {extra}
      </div>
    </div>
  );
}

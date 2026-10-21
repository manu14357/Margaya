import { FlaskConical, Sparkles } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAiLocale } from "@/components/editor/ai/use-editor-ai";
import { SettingsSection } from "@/components/settings-layout";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type {
  CompiledRule,
  CompiledRules,
  RuleDryRun,
} from "@/fetchers/ai/rules";
import {
  useCompileRule,
  useRuleDryRun,
} from "@/hooks/mutations/ai/use-ai-rules";
import { useCreateAutomationRule } from "@/hooks/mutations/automation-rule/use-automation-rule-mutations";
import { useUpdateProjectAutomations } from "@/hooks/mutations/project-automation/use-update-project-automations";
import { useUpsertWorkflowRule } from "@/hooks/mutations/workflow-rule/use-upsert-workflow-rule";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import { useProjectAutomations } from "@/hooks/queries/project-automation/use-project-automations";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { aiErrorKey } from "@/lib/ai/format";
import { cancelledColumns } from "@/lib/automation";
import { toast } from "@/lib/toast";
import RuleDraftEditor from "./rule-draft-editor";
import RuleDryRunResults from "./rule-dry-run";

// Rule compiler (C5) in Settings → Projects → Workflow: describe a rule,
// get a normal rule in the usual controls, edit it, replay it over recent
// history, then save it through the engine's own route. Hidden while AI is
// unavailable; saved rules never need AI.

const DAY_OPTIONS = [7, 30, 90] as const;
const DAY_KEYS = {
  7: "ai:rules.days7",
  30: "ai:rules.days30",
  90: "ai:rules.days90",
} as const;
type Days = (typeof DAY_OPTIONS)[number];

type Draft = {
  key: number;
  rule: CompiledRule;
  days: Days;
  dryRun: RuleDryRun | null;
  dryRunFailed: boolean;
};

export default function RuleCompiler({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { available } = useAiAvailability(projectId);
  const { canUpdateProjects, isCheckingPermissions } = useWorkspacePermission();
  const canEdit = !isCheckingPermissions && canUpdateProjects();

  if (!available || !canEdit) return null;
  return (
    <SettingsSection
      title={t("ai:rules.title")}
      description={t("ai:rules.description")}
    >
      <RuleCompilerPanel projectId={projectId} />
    </SettingsSection>
  );
}

function RuleCompilerPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const inputId = useId();
  const locale = useAiLocale();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const { data: columns = [] } = useGetColumns(projectId);
  const { data: automations } = useProjectAutomations(workspaceId, projectId);
  const cancelled = useMemo(() => cancelledColumns(columns), [columns]);
  const compile = useCompileRule();
  const dryRun = useRuleDryRun();
  const { mutateAsync: upsertRule } = useUpsertWorkflowRule();
  const { mutateAsync: updateAutomations } = useUpdateProjectAutomations();
  const { mutateAsync: createTaskRule } = useCreateAutomationRule(projectId);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<CompiledRules | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState<number | null>(null);

  const patchDraft = (key: number, patch: Partial<Draft>) =>
    setDrafts((current) =>
      current.map((draft) =>
        draft.key === key ? { ...draft, ...patch } : draft,
      ),
    );
  const removeDraft = (key: number) =>
    setDrafts((current) => current.filter((draft) => draft.key !== key));

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const text = prompt.trim();
    if (text.length < 3 || compile.isPending) return;
    setResult(null);
    setDrafts([]);
    try {
      const compiled = await compile.mutateAsync({
        projectId,
        prompt: text,
        ...(locale ? { locale } : {}),
      });
      setResult(compiled);
      setDrafts(
        compiled.rules.map((rule, index) => ({
          key: Date.now() + index,
          rule,
          days: 30,
          dryRun: null,
          dryRunFailed: false,
        })),
      );
    } catch {
      // The error is shown from the mutation state.
    }
  };

  const runDryRun = async (draft: Draft) => {
    setBusy(draft.key);
    try {
      const answer = await dryRun.mutateAsync({
        projectId,
        rule: draft.rule,
        days: draft.days,
      });
      patchDraft(draft.key, { dryRun: answer, dryRunFailed: false });
    } catch {
      patchDraft(draft.key, { dryRun: null, dryRunFailed: true });
    } finally {
      setBusy(null);
    }
  };

  const save = async (draft: Draft) => {
    setBusy(draft.key);
    try {
      if (draft.rule.engine === "workflow_rule") {
        await upsertRule({ projectId, data: draft.rule.rule });
      } else if (draft.rule.engine === "automation_rule") {
        // Starts on, like a rule made in the Automations builder.
        await createTaskRule(draft.rule.rule);
      } else {
        await updateAutomations({
          workspaceId,
          projectId,
          patch: draft.rule.patch,
        });
      }
      toast.success(t("ai:rules.saved"));
      removeDraft(draft.key);
    } catch {
      toast.error(t("ai:rules.saveError"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
      <form onSubmit={submit} className="space-y-2">
        <label
          htmlFor={inputId}
          className="flex items-center gap-1.5 font-medium text-sm"
        >
          <Sparkles aria-hidden className="size-3.5 text-muted-foreground" />
          {t("ai:rules.label")}
        </label>
        <Textarea
          id={inputId}
          value={prompt}
          maxLength={1000}
          placeholder={t("ai:rules.placeholder")}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              void submit(event);
            }
          }}
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={prompt.trim().length < 3 || compile.isPending}
          >
            {compile.isPending ? (
              <Spinner className="size-3.5" />
            ) : (
              <Sparkles aria-hidden className="size-3.5" />
            )}
            {t("ai:rules.compile")}
          </Button>
        </div>
      </form>

      <div aria-live="polite" className="space-y-3">
        {compile.isPending && (
          <p className="flex items-center gap-2 text-muted-foreground text-xs">
            <Spinner className="size-3.5" />
            {t("ai:rules.compiling")}
          </p>
        )}
        {compile.isError && (
          <p className="text-destructive-foreground text-xs">
            {t(aiErrorKey(compile.error))}
          </p>
        )}
        {result && result.unsupported.length > 0 && (
          <div className="space-y-1 text-xs">
            <p className="font-medium text-sm">
              {t("ai:rules.unsupportedTitle")}
            </p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {result.unsupported.map((part) => (
                <li key={`${part.request}-${part.reason}`}>
                  <span className="text-foreground">{part.request}</span>
                  {" — "}
                  {part.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        {result && result.rejected > 0 && (
          <p className="text-muted-foreground text-xs">
            {t("ai:rules.rejected", { rejected: result.rejected })}
          </p>
        )}
        {result && result.rules.length === 0 && (
          <p className="text-muted-foreground text-xs">
            {t("ai:rules.noRules")}
          </p>
        )}

        {drafts.map((draft) => {
          const pending = busy === draft.key;
          return (
            <div key={draft.key} className="space-y-3">
              <RuleDraftEditor
                projectId={projectId}
                draft={draft.rule}
                columns={columns}
                cancelledColumns={cancelled}
                current={automations}
                disabled={pending}
                onChange={(rule) =>
                  patchDraft(draft.key, {
                    rule,
                    dryRun: null,
                    dryRunFailed: false,
                  })
                }
              />
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Select
                  value={String(draft.days)}
                  onValueChange={(value) => {
                    const days = DAY_OPTIONS.find(
                      (option) => String(option) === value,
                    );
                    if (days) patchDraft(draft.key, { days });
                  }}
                >
                  <SelectTrigger
                    className="h-8 w-36 text-sm"
                    aria-label={t("ai:rules.historyWindow")}
                  >
                    <SelectValue>{t(DAY_KEYS[draft.days])}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {DAY_OPTIONS.map((days) => (
                      <SelectItem key={days} value={String(days)}>
                        {t(DAY_KEYS[days])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => void runDryRun(draft)}
                >
                  <FlaskConical aria-hidden className="size-3.5" />
                  {t("ai:rules.dryRun")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => removeDraft(draft.key)}
                >
                  {t("ai:rules.discard")}
                </Button>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => void save(draft)}
                >
                  {t("ai:rules.save")}
                </Button>
              </div>
              {draft.dryRunFailed && (
                <p className="text-destructive-foreground text-xs">
                  {t("ai:rules.dryRunError")}
                </p>
              )}
              {draft.dryRun && <RuleDryRunResults result={draft.dryRun} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

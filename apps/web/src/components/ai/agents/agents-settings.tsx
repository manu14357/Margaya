import type { TFunction } from "i18next";
import { Bot, CalendarClock, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsGroup,
  SettingsGroupMessage,
  SettingsPage,
  SettingsSection,
} from "@/components/settings-layout";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { Agent, AgentTemplate } from "@/fetchers/ai/agents";
import {
  useCreateAgent,
  useDeleteAgent,
  useUpdateAgent,
} from "@/hooks/mutations/ai/use-agent-mutations";
import { useAgents, useAgentTemplates } from "@/hooks/queries/ai/use-agents";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import useGrantableRoles from "@/hooks/queries/workspace/use-grantable-roles";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  dollarsToMicros,
  formatCostMicros,
  microsToDollarsInput,
} from "@/lib/ai/format";
import { getInitials } from "@/lib/get-initials";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import { AgentAccessFields } from "./agent-access-fields";
import { AgentBadge } from "./agent-badge";
import { AgentSchedulesDialog, type ScheduleSeed } from "./agent-schedules";
import {
  AgentTemplatePicker,
  BLANK_TEMPLATE,
  draftFromTemplate,
} from "./agent-template-picker";
import { ConnectorsSection } from "./connectors-settings";

type Tier = "fast" | "balanced" | "deep";
const TIERS: Tier[] = ["fast", "balanced", "deep"];
const TIER_KEYS: Record<Tier, string> = {
  fast: "ai:agents.fields.tierFast",
  balanced: "ai:agents.fields.tierBalanced",
  deep: "ai:agents.fields.tierDeep",
};
const DEFAULT_PROVIDER = "default";

/** The API refuses a name another agent or member already has. */
export function isAgentNameTaken(error: unknown): boolean {
  if (!(error instanceof HttpError) || error.status !== 409) return false;
  try {
    return (
      (JSON.parse(error.message) as { code?: unknown }).code ===
      "AGENT_NAME_TAKEN"
    );
  } catch {
    return false;
  }
}

function roleLabel(t: TFunction, role: string) {
  return t(`team:roles.${role}`, { defaultValue: role });
}

/** Settings → Workspace → Agents (ai:manage). */
export function AgentsSettingsPage() {
  const { t } = useTranslation();
  const { workspace, canManageAi, isCheckingPermissions } =
    useWorkspacePermission();
  const workspaceId = workspace?.id ?? "";
  const allowed = !isCheckingPermissions && canManageAi();
  const agents = useAgents(allowed ? workspaceId : undefined);
  const [editing, setEditing] = useState<Agent | "new" | null>(null);
  const [scheduling, setScheduling] = useState<{
    agent: Agent;
    seed: ScheduleSeed | null;
  } | null>(null);
  const [deleting, setDeleting] = useState<Agent | null>(null);

  return (
    <SettingsPage
      title={t("ai:agents.title")}
      description={t("ai:agents.subtitle")}
      actions={
        allowed ? (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus aria-hidden />
            {t("ai:agents.create")}
          </Button>
        ) : undefined
      }
    >
      {isCheckingPermissions || (allowed && agents.isLoading) ? (
        <Skeleton className="h-40 w-full" />
      ) : !allowed ? (
        <SettingsGroup>
          <SettingsGroupMessage>{t("ai:agents.noAccess")}</SettingsGroupMessage>
        </SettingsGroup>
      ) : agents.isError ? (
        <SettingsGroup>
          <div className="flex items-center gap-3 px-4 py-4 text-muted-foreground text-xs">
            <span>{t("ai:agents.loadError")}</span>
            <Button
              variant="outline"
              size="xs"
              onClick={() => void agents.refetch()}
            >
              {t("ai:agents.retry")}
            </Button>
          </div>
        </SettingsGroup>
      ) : (
        <SettingsSection title={t("ai:agents.listTitle")}>
          <SettingsGroup>
            {(agents.data ?? []).length === 0 ? (
              <SettingsGroupMessage>
                {t("ai:agents.empty")}
              </SettingsGroupMessage>
            ) : (
              <ul className="divide-y divide-border">
                {(agents.data ?? []).map((agent) => (
                  <AgentRow
                    key={agent.id}
                    workspaceId={workspaceId}
                    agent={agent}
                    onEdit={() => setEditing(agent)}
                    onSchedules={() => setScheduling({ agent, seed: null })}
                    onDelete={() => setDeleting(agent)}
                  />
                ))}
              </ul>
            )}
          </SettingsGroup>
        </SettingsSection>
      )}
      {editing && (
        <AgentDialog
          workspaceId={workspaceId}
          agent={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onCreated={(agent, template) => {
            // A template with a suggested schedule offers it right away.
            if (template?.suggestedSchedule) {
              setScheduling({ agent, seed: template.suggestedSchedule });
            }
          }}
        />
      )}
      {scheduling && (
        <AgentSchedulesDialog
          workspaceId={workspaceId}
          agent={scheduling.agent}
          seed={scheduling.seed}
          onClose={() => setScheduling(null)}
        />
      )}
      {allowed && !agents.isLoading && !agents.isError && (
        <ConnectorsSection workspaceId={workspaceId} canManage={allowed} />
      )}
      <DeleteAgentDialog
        workspaceId={workspaceId}
        agent={deleting}
        onClose={() => setDeleting(null)}
      />
    </SettingsPage>
  );
}

function AgentRow({
  workspaceId,
  agent,
  onEdit,
  onSchedules,
  onDelete,
}: {
  workspaceId: string;
  agent: Agent;
  onEdit: () => void;
  onSchedules: () => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const update = useUpdateAgent();
  const spent = formatCostMicros(agent.monthSpendMicros ?? 0, i18n.language);

  const toggle = async (enabled: boolean) => {
    try {
      await update.mutateAsync({
        agentId: agent.id,
        patch: { workspaceId, enabled },
      });
    } catch {
      toast.error(t("ai:agents.saveError"));
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Avatar className="size-8">
        {agent.image && <AvatarImage src={agent.image} alt="" />}
        <AvatarFallback className="text-[11px]">
          <Bot className="size-4" aria-hidden />
          <span className="sr-only">{getInitials(agent.name)}</span>
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-sm">{agent.name}</span>
          <AgentBadge />
          {!agent.enabled && (
            <Badge variant="outline" className="text-muted-foreground">
              {t("ai:agents.off")}
            </Badge>
          )}
        </div>
        <p className="truncate text-muted-foreground text-xs">
          {[
            agent.role ? roleLabel(t, agent.role) : null,
            t(TIER_KEYS[agent.modelTier]),
            agent.monthlyBudgetMicros !== null
              ? t("ai:agents.spendOfBudget", {
                  spent,
                  budget: formatCostMicros(
                    agent.monthlyBudgetMicros,
                    i18n.language,
                  ),
                })
              : t("ai:agents.spend", { spent }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {agent.description && (
          <p className="line-clamp-2 text-muted-foreground text-xs">
            {agent.description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Switch
          checked={agent.enabled}
          disabled={update.isPending}
          onCheckedChange={(next) => void toggle(next)}
          aria-label={t(
            agent.enabled ? "ai:agents.disable" : "ai:agents.enable",
          )}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("ai:agents.schedules.open", { name: agent.name })}
          onClick={onSchedules}
        >
          <CalendarClock aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("ai:agents.edit")}
          onClick={onEdit}
        >
          <Pencil aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("ai:agents.delete")}
          onClick={onDelete}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </li>
  );
}

export function AgentDialog({
  workspaceId,
  agent,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  agent: Agent | null;
  onClose: () => void;
  onCreated?: (agent: Agent, template: AgentTemplate | null) => void;
}) {
  const { t } = useTranslation();
  const { role: myRole } = useWorkspacePermission();
  const { roles } = useGrantableRoles(workspaceId, myRole);
  const ai = useAiAvailability();
  const create = useCreateAgent();
  const update = useUpdateAgent();
  const [name, setName] = useState(agent?.name ?? "");
  const [nameTaken, setNameTaken] = useState(false);
  const [description, setDescription] = useState(agent?.description ?? "");
  const [instructions, setInstructions] = useState(agent?.instructions ?? "");
  const [role, setRole] = useState(agent?.role ?? "member");
  const [tier, setTier] = useState<Tier>(agent?.modelTier ?? "balanced");
  const [provider, setProvider] = useState(
    agent?.providerOverride ?? DEFAULT_PROVIDER,
  );
  const [budget, setBudget] = useState(
    agent?.monthlyBudgetMicros != null
      ? microsToDollarsInput(agent.monthlyBudgetMicros)
      : "",
  );
  const [projectIds, setProjectIds] = useState<string[] | null>(
    agent?.projectIds ?? null,
  );
  const [skillIds, setSkillIds] = useState<string[]>(agent?.skillIds ?? []);
  const [webAccess, setWebAccess] = useState(agent?.webAccess ?? false);
  const templates = useAgentTemplates(workspaceId, !agent);
  const [template, setTemplate] = useState<AgentTemplate | null>(null);
  const pickTemplate = (next: AgentTemplate | null) => {
    setTemplate(next);
    if (!next) return;
    const draft = draftFromTemplate(t, next);
    setName(draft.name);
    setNameTaken(false);
    setInstructions(draft.instructions);
    setRole(draft.role);
    setTier(draft.modelTier);
  };
  const pending = create.isPending || update.isPending;
  // Agents never hold owner or admin.
  const roleOptions = [
    ...new Set([...roles.filter((r) => r !== "admin" && r !== "owner"), role]),
  ];
  const budgetMicros = budget.trim() ? dollarsToMicros(budget) : null;
  const budgetInvalid =
    budget.trim() !== "" &&
    (budgetMicros === null || Number.isNaN(budgetMicros));
  const scopeInvalid = projectIds !== null && projectIds.length === 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || budgetInvalid || scopeInvalid) return;
    const fields = {
      workspaceId,
      name: name.trim(),
      description: description.trim() || null,
      instructions,
      role,
      modelTier: tier,
      providerOverride: provider === "local" ? ("local" as const) : null,
      monthlyBudgetMicros: budgetMicros,
      projectIds,
      skillIds,
      webAccess,
    };
    try {
      if (agent) {
        await update.mutateAsync({ agentId: agent.id, patch: fields });
        toast.success(t("ai:agents.saved"));
      } else {
        const created = await create.mutateAsync(fields);
        toast.success(t("ai:agents.created"));
        onCreated?.(created, template);
      }
      onClose();
    } catch (error) {
      if (isAgentNameTaken(error)) {
        setNameTaken(true);
        return;
      }
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("ai:agents.saveError"),
      );
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader className="border-border border-b px-6 py-5">
            <DialogTitle>
              {t(agent ? "ai:agents.edit" : "ai:agents.create")}
            </DialogTitle>
            <DialogDescription>{t("ai:agents.dialogHint")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 px-6 py-5">
            {!agent && (templates.data ?? []).length > 0 && (
              <AgentTemplatePicker
                templates={templates.data ?? []}
                selected={template?.id ?? BLANK_TEMPLATE}
                onPick={pickTemplate}
              />
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-name">{t("ai:agents.fields.name")}</Label>
              <Input
                id="agent-name"
                value={name}
                maxLength={80}
                required
                aria-invalid={nameTaken || undefined}
                aria-describedby={nameTaken ? "agent-name-error" : undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameTaken(false);
                }}
              />
              {nameTaken && (
                <p
                  id="agent-name-error"
                  role="alert"
                  className="text-destructive text-xs"
                >
                  {t("ai:agents.fields.nameTaken")}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-description">
                {t("ai:agents.fields.description")}
              </Label>
              <Input
                id="agent-description"
                value={description}
                maxLength={500}
                placeholder={t("ai:agents.fields.descriptionPlaceholder")}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-instructions">
                {t("ai:agents.fields.instructions")}
              </Label>
              <Textarea
                id="agent-instructions"
                value={instructions}
                maxLength={8000}
                rows={5}
                aria-describedby="agent-instructions-hint"
                onChange={(event) => setInstructions(event.target.value)}
              />
              <p
                id="agent-instructions-hint"
                className="text-muted-foreground text-xs"
              >
                {t("ai:agents.fields.instructionsHint")}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="agent-role">{t("ai:agents.fields.role")}</Label>
                <Select value={role} onValueChange={(v) => v && setRole(v)}>
                  <SelectTrigger id="agent-role">
                    <SelectValue>{roleLabel(t, role)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {roleLabel(t, option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="agent-tier">{t("ai:agents.fields.tier")}</Label>
                <Select
                  value={tier}
                  onValueChange={(v) => v && setTier(v as Tier)}
                >
                  <SelectTrigger id="agent-tier">
                    <SelectValue>{t(TIER_KEYS[tier])}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {TIERS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {t(TIER_KEYS[option])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="-mt-2 text-muted-foreground text-xs">
              {t("ai:agents.fields.roleHint")}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="agent-provider">
                  {t("ai:agents.fields.provider")}
                </Label>
                <Select
                  value={provider}
                  onValueChange={(v) => v && setProvider(v)}
                >
                  <SelectTrigger id="agent-provider">
                    <SelectValue>
                      {t(
                        provider === "local"
                          ? "ai:agents.fields.providerLocal"
                          : "ai:agents.fields.providerDefault",
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_PROVIDER}>
                      {t("ai:agents.fields.providerDefault")}
                    </SelectItem>
                    {(ai.data?.destination === "local" ||
                      provider === "local") && (
                      <SelectItem value="local">
                        {t("ai:agents.fields.providerLocal")}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="agent-budget">
                  {t("ai:agents.fields.budget")}
                </Label>
                <Input
                  id="agent-budget"
                  inputMode="decimal"
                  value={budget}
                  aria-invalid={budgetInvalid || undefined}
                  onChange={(event) => setBudget(event.target.value)}
                />
              </div>
            </div>
            <p className="-mt-2 text-muted-foreground text-xs">
              {t("ai:agents.fields.budgetHint")}
            </p>
            <AgentAccessFields
              workspaceId={workspaceId}
              projectIds={projectIds}
              onProjectIds={setProjectIds}
              skillIds={skillIds}
              onSkillIds={setSkillIds}
              webAccess={webAccess}
              onWebAccess={setWebAccess}
            />
          </div>
          <DialogFooter className="gap-2 border-border border-t px-6 py-4 sm:gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("ai:agents.cancel")}
            </Button>
            <Button
              type="submit"
              loading={pending}
              disabled={!name.trim() || budgetInvalid || scopeInvalid}
            >
              {t(agent ? "ai:agents.save" : "ai:agents.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteAgentDialog({
  workspaceId,
  agent,
  onClose,
}: {
  workspaceId: string;
  agent: Agent | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const remove = useDeleteAgent();
  const confirm = async () => {
    if (!agent) return;
    try {
      await remove.mutateAsync({ workspaceId, agentId: agent.id });
      toast.success(t("ai:agents.deleted"));
      onClose();
    } catch {
      toast.error(t("ai:agents.saveError"));
    }
  };
  return (
    <AlertDialog
      open={Boolean(agent)}
      onOpenChange={(open) => !open && onClose()}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("ai:agents.deleteTitle", { name: agent?.name ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("ai:agents.deleteBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            {t("ai:agents.cancel")}
          </AlertDialogClose>
          <Button
            variant="destructive"
            loading={remove.isPending}
            onClick={() => void confirm()}
          >
            {t("ai:agents.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

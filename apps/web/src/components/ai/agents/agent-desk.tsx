import { Link, useNavigate } from "@tanstack/react-router";
import { Bot, Check, CircleStop, Sparkles, Undo2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import AiMarkdown from "@/components/ai/ai-markdown";
import Layout from "@/components/common/layout";
import { MyWorkTabs } from "@/components/my-work/my-work-tabs";
import PageTitle from "@/components/page-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  AgentRun,
  AgentRunStatus,
  AgentRunStep,
} from "@/fetchers/ai/agents";
import {
  useCancelAgentRun,
  useDecideAgentApproval,
  useUndoAgentChange,
} from "@/hooks/mutations/ai/use-agent-mutations";
import {
  useAgentApprovals,
  useAgentRun,
  useAgentRuns,
  useAgents,
} from "@/hooks/queries/ai/use-agents";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import {
  canFollowUp,
  RUN_STATUS_KEYS,
  RUN_STATUSES,
  runErrorKey,
  STEP_STATUS_KEYS,
  TRIGGER_KEYS,
  toolLabel,
  workedFor,
} from "@/lib/ai/agents";
import { formatCostMicros, formatCount } from "@/lib/ai/format";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import { AgentBadge } from "./agent-badge";
import { ApprovalCard } from "./approval-card";
import { ChangePreview } from "./change-preview";
import { FollowUpBox, NeedsInputPanel } from "./run-reply";

const ALL = "all";

type DeskProps = {
  workspaceId: string;
  runId?: string;
  agentId?: string;
  status?: AgentRunStatus;
};

/** Agent Desk: runs, their steps, cost and change sets, with undo. */
export default function AgentDesk({
  workspaceId,
  runId,
  agentId,
  status,
}: DeskProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ai = useAiAvailability();
  const agents = useAgents(workspaceId);
  const runs = useAgentRuns(workspaceId, { agentId, status }, ai.canUse);
  const approvals = useAgentApprovals(workspaceId, ai.canUse);

  const setSearch = (patch: Partial<DeskProps>) =>
    navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        ...patch,
      }),
    });

  const agentLabel =
    agentId && agents.data
      ? (agents.data.find((agent) => agent.id === agentId)?.name ??
        t("ai:agents.desk.allAgents"))
      : t("ai:agents.desk.allAgents");

  let list: React.ReactNode;
  if (runs.isPending) {
    list = (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  } else if (runs.isError) {
    list = (
      <div className="flex items-center gap-3 px-4 py-6 text-muted-foreground text-sm">
        <span>{t("ai:agents.loadError")}</span>
        <Button variant="outline" size="xs" onClick={() => void runs.refetch()}>
          {t("ai:agents.retry")}
        </Button>
      </div>
    );
  } else if ((runs.data ?? []).length === 0) {
    list = (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Bot aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{t("ai:agents.desk.emptyTitle")}</EmptyTitle>
          <EmptyDescription>{t("ai:agents.desk.empty")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else {
    list = (
      <ul className="divide-y divide-border/60">
        {(runs.data ?? []).map((run) => (
          <RunRow
            key={run.id}
            run={run}
            selected={run.id === runId}
            onSelect={() => void setSearch({ runId: run.id })}
          />
        ))}
      </ul>
    );
  }

  return (
    <>
      <PageTitle title={t("ai:agents.desk.title")} />
      <Layout>
        <Layout.TopBar title={t("myWork:title")} />
        <MyWorkTabs workspaceId={workspaceId} value="agents" />
        <Layout.Content>
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-border/80 border-b bg-card px-4 py-2">
              <p className="text-muted-foreground text-xs">
                {t("ai:agents.desk.subtitle")}
              </p>
              <div className="flex items-center gap-1.5">
                <Select
                  value={agentId ?? ALL}
                  onValueChange={(value) =>
                    void setSearch({
                      agentId:
                        !value || value === ALL ? undefined : String(value),
                    })
                  }
                >
                  <SelectTrigger
                    size="sm"
                    className="w-40"
                    aria-label={t("ai:agents.desk.filterAgent")}
                  >
                    <SelectValue>{agentLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>
                      {t("ai:agents.desk.allAgents")}
                    </SelectItem>
                    {(agents.data ?? []).map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={status ?? ALL}
                  onValueChange={(value) =>
                    void setSearch({
                      status:
                        !value || value === ALL
                          ? undefined
                          : (String(value) as AgentRunStatus),
                    })
                  }
                >
                  <SelectTrigger
                    size="sm"
                    className="w-44"
                    aria-label={t("ai:agents.desk.filterStatus")}
                  >
                    <SelectValue>
                      {status
                        ? t(RUN_STATUS_KEYS[status])
                        : t("ai:agents.desk.allStatuses")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>
                      {t("ai:agents.desk.allStatuses")}
                    </SelectItem>
                    {RUN_STATUSES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(RUN_STATUS_KEYS[value])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* The columns are positioned so their sr-only labels stay inside
                their scroll areas instead of stretching the whole page. */}
            <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:overflow-hidden">
              <div className="relative min-h-0 border-border/80 lg:overflow-y-auto lg:border-r">
                {(approvals.data ?? []).length > 0 && (
                  <section
                    aria-label={t("ai:agents.desk.approvalsTitle")}
                    className="flex flex-col gap-2 border-border/80 border-b p-3"
                  >
                    <h2 className="font-medium text-muted-foreground text-xs">
                      {t("ai:agents.desk.approvalsTitle")}
                    </h2>
                    {(approvals.data ?? []).map((approval) => (
                      <ApprovalCard
                        key={approval.id}
                        workspaceId={workspaceId}
                        runId={approval.runId}
                        approvalId={approval.id}
                        showDeskLink={false}
                      />
                    ))}
                  </section>
                )}
                {list}
              </div>
              <div className="relative min-h-0 border-border/80 border-t lg:overflow-y-auto lg:border-t-0">
                {runId ? (
                  <RunDetail workspaceId={workspaceId} runId={runId} />
                ) : (
                  <p className="p-6 text-muted-foreground text-sm">
                    {t("ai:agents.desk.selectRun")}
                  </p>
                )}
              </div>
            </div>
          </div>
        </Layout.Content>
      </Layout>
    </>
  );
}

function StatusBadge({ status }: { status: AgentRunStatus }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 font-normal",
        status === "failed" && "text-destructive-foreground",
        (status === "awaiting_approval" || status === "needs_input") &&
          "text-foreground",
        (status === "succeeded" || status === "cancelled") &&
          "text-muted-foreground",
      )}
    >
      {(status === "running" || status === "queued") && (
        <span
          className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none"
          aria-hidden
        />
      )}
      {t(RUN_STATUS_KEYS[status])}
    </Badge>
  );
}

function RunRow({
  run,
  selected,
  onSelect,
}: {
  run: AgentRun;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t, i18n } = useTranslation();
  const worked = workedFor(run.startedAt, run.finishedAt);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full flex-col gap-1 px-4 py-3 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/50",
          selected && "bg-accent/60",
        )}
      >
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <Bot
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="truncate font-medium">
            {run.agent?.name ?? t("ai:agents.desk.deletedAgent")}
          </span>
          <span className="ms-auto">
            <StatusBadge status={run.status} />
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
          {run.task ? (
            <span className="truncate">
              <span className="font-mono">{run.task.key}</span> {run.task.title}
            </span>
          ) : (
            run.project && <span className="truncate">{run.project.name}</span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 text-muted-foreground/80 text-xs">
          <span>{t(TRIGGER_KEYS[run.trigger] ?? run.trigger)}</span>
          {run.principal && (
            <span>
              {t("ai:agents.desk.onBehalfOf", { name: run.principal.name })}
            </span>
          )}
          <span>{formatCostMicros(run.costMicros, i18n.language)}</span>
          {worked && <span>{t(worked.key, worked.values)}</span>}
          <span>{formatRelativeTime(run.createdAt)}</span>
        </span>
      </button>
    </li>
  );
}

function RunDetail({
  workspaceId,
  runId,
}: {
  workspaceId: string;
  runId: string;
}) {
  const { t, i18n } = useTranslation();
  const run = useAgentRun(workspaceId, runId);
  const cancel = useCancelAgentRun();
  const navigate = useNavigate();

  if (run.isLoading) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!run.data) {
    return (
      <p className="p-6 text-muted-foreground text-sm">
        {t("ai:agents.desk.runMissing")}
      </p>
    );
  }
  const data = run.data;
  const changes = data.steps.filter((step) => step.change);
  const errorKey = runErrorKey(data.error);
  const worked = workedFor(data.startedAt, data.finishedAt);

  const onCancel = async () => {
    try {
      await cancel.mutateAsync({ workspaceId, runId });
      toast.success(t("ai:agents.desk.cancelled"));
    } catch {
      toast.error(t("ai:agents.desk.cancelError"));
    }
  };

  return (
    <article className="flex flex-col gap-5 p-4 md:p-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-medium text-base">
            {data.agent?.name ?? t("ai:agents.desk.deletedAgent")}
          </h2>
          <AgentBadge />
          <StatusBadge status={data.status} />
          {(data.status === "queued" ||
            data.status === "running" ||
            data.status === "needs_input") && (
            <Button
              size="xs"
              variant="outline"
              className="ms-auto"
              loading={cancel.isPending}
              onClick={() => void onCancel()}
            >
              <CircleStop aria-hidden />
              {t("ai:agents.desk.cancelRun")}
            </Button>
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          {[
            t(TRIGGER_KEYS[data.trigger] ?? data.trigger),
            data.principal
              ? t("ai:agents.desk.onBehalfOf", { name: data.principal.name })
              : null,
            formatDateTime(data.createdAt),
            worked ? t(worked.key, worked.values) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {data.task && (
          <Link
            to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
            params={{
              workspaceId,
              projectId: data.task.projectId,
              taskId: data.task.id,
            }}
            className="w-fit text-sm underline-offset-2 hover:underline"
          >
            <span className="font-mono text-muted-foreground">
              {data.task.key}
            </span>{" "}
            {data.task.title}
          </Link>
        )}
        {!data.task && data.project && (
          <p className="text-sm">
            <span className="text-muted-foreground">
              {t("ai:agents.desk.project")}
            </span>{" "}
            {data.project.name}
          </p>
        )}
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
          <div className="flex gap-1">
            <dt className="text-muted-foreground">
              {t("ai:agents.desk.cost")}
            </dt>
            <dd>{formatCostMicros(data.costMicros, i18n.language)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-muted-foreground">
              {t("ai:agents.desk.tokensLabel")}
            </dt>
            <dd>{formatCount(data.tokenIn + data.tokenOut, i18n.language)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-muted-foreground">
              {t("ai:agents.desk.toolCallsLabel")}
            </dt>
            <dd>{data.toolCalls}</dd>
          </div>
        </dl>
        {errorKey && (
          <p role="status" className="text-destructive-foreground text-xs">
            {t(errorKey)}
          </p>
        )}
      </header>

      {data.status === "needs_input" && data.question && (
        <NeedsInputPanel
          workspaceId={workspaceId}
          runId={data.id}
          question={data.question}
        />
      )}
      {data.status === "needs_input" && !data.question && (
        <p className="text-muted-foreground text-sm">
          {t("ai:agents.needsInput.waiting")}
        </p>
      )}

      {data.outputSummary && (
        <section className="flex flex-col gap-1.5">
          <h3 className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
            <Sparkles className="size-3" aria-hidden />
            {t("ai:agents.desk.summary")}
          </h3>
          <AiMarkdown
            text={data.outputSummary}
            className="rounded-lg bg-muted/40 p-3"
          />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-medium text-muted-foreground text-xs">
          {t("ai:agents.desk.changes")}
        </h3>
        {changes.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("ai:agents.desk.noChanges")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {changes.map((step) => (
              <ChangeItem key={step.id} workspaceId={workspaceId} step={step} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-medium text-muted-foreground text-xs">
          {t("ai:agents.desk.steps")}
        </h3>
        <ol className="flex flex-col gap-1 border-border border-l ps-3 text-xs">
          {data.steps.map((step) => (
            <li key={step.id} className="flex flex-wrap items-center gap-x-2">
              <span className="font-mono text-muted-foreground/70">
                {step.seq}
              </span>
              <span className="font-medium">
                {step.kind === "model"
                  ? t("ai:agents.step.model")
                  : toolLabel(t, step.toolName)}
              </span>
              <span className="text-muted-foreground">
                {t(STEP_STATUS_KEYS[step.status] ?? step.status)}
              </span>
              {step.kind === "model" && (
                <span className="text-muted-foreground/80">
                  {t("ai:agents.desk.tokens", {
                    value: formatCount(
                      step.tokenIn + step.tokenOut,
                      i18n.language,
                    ),
                  })}
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>
      {canFollowUp(data.status) && data.agent && (
        <section className="border-border/80 border-t pt-4">
          <FollowUpBox
            workspaceId={workspaceId}
            runId={data.id}
            onStarted={(next) =>
              void navigate({
                to: ".",
                search: (previous: Record<string, unknown>) => ({
                  ...previous,
                  runId: next,
                }),
              })
            }
          />
        </section>
      )}
    </article>
  );
}

function ChangeItem({
  workspaceId,
  step,
}: {
  workspaceId: string;
  step: AgentRunStep;
}) {
  const { t } = useTranslation();
  const undo = useUndoAgentChange();
  const decide = useDecideAgentApproval();

  const onUndo = async () => {
    try {
      await undo.mutateAsync({ workspaceId, stepId: step.id });
      toast.success(t("ai:agents.change.undone"));
    } catch {
      toast.error(t("ai:agents.change.undoError"));
    }
  };
  const onDecide = async (decision: "approve" | "reject") => {
    if (!step.approval) return;
    try {
      await decide.mutateAsync({
        workspaceId,
        approvalId: step.approval.id,
        decision,
      });
      toast.success(
        t(
          decision === "approve"
            ? "ai:agents.change.approved"
            : "ai:agents.change.rejected",
        ),
      );
    } catch {
      toast.error(t("ai:agents.change.decideError"));
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{toolLabel(t, step.toolName)}</span>
        <span className="text-muted-foreground">
          {t(STEP_STATUS_KEYS[step.status] ?? step.status)}
        </span>
        <span className="ms-auto flex items-center gap-1">
          {step.approval?.canDecide && (
            <>
              <Button
                size="xs"
                disabled={decide.isPending}
                onClick={() => void onDecide("approve")}
              >
                <Check aria-hidden />
                {t("ai:agents.change.approve")}
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={decide.isPending}
                onClick={() => void onDecide("reject")}
              >
                <X aria-hidden />
                {t("ai:agents.change.reject")}
              </Button>
            </>
          )}
          {step.canUndo && (
            <Button
              size="xs"
              variant="outline"
              loading={undo.isPending}
              onClick={() => void onUndo()}
            >
              <Undo2 aria-hidden />
              {t("ai:agents.change.undo")}
            </Button>
          )}
        </span>
      </div>
      <ChangePreview change={step.change} links={step.links} />
    </li>
  );
}

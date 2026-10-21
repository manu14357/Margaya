import { CalendarClock, Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import type { AgentSchedule } from "@/fetchers/ai/agent-schedules";
import type { Agent } from "@/fetchers/ai/agents";
import {
  useCreateAgentSchedule,
  useDeleteAgentSchedule,
  useUpdateAgentSchedule,
} from "@/hooks/mutations/ai/use-agent-schedule-mutations";
import { useAgentSchedules } from "@/hooks/queries/ai/use-agent-schedules";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import {
  CUSTOM_PRESET,
  cronLabel,
  defaultTimeZone,
  looksLikeCron,
  presetOf,
  SCHEDULE_PRESETS,
  scheduleErrorKey,
  timeZones,
} from "@/lib/ai/schedules";
import { formatDateTime } from "@/lib/format";
import { toast } from "@/lib/toast";

/** Values a new schedule starts from (a template's suggestion). */
export type ScheduleSeed = { cron: string; prompt: string };

type ProjectOption = { id: string; name: string; slug: string };

const NO_TASK = "none";

function useProjectOptions(workspaceId: string, agent: Agent) {
  const projects = useGetProjects({ workspaceId });
  return useMemo(() => {
    const rows = (Array.isArray(projects.data) ? projects.data : []) as {
      id: string;
      name: string;
      slug: string;
    }[];
    const allowed = agent.projectIds ? new Set(agent.projectIds) : null;
    return rows
      .filter((project) => !allowed || allowed.has(project.id))
      .map((project) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
      })) as ProjectOption[];
  }, [projects.data, agent.projectIds]);
}

/** Settings → Agents → an agent's schedules, with the editor. */
export function AgentSchedulesDialog({
  workspaceId,
  agent,
  seed,
  onClose,
}: {
  workspaceId: string;
  agent: Agent;
  /** Opens the editor for a new schedule with these values. */
  seed?: ScheduleSeed | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const schedules = useAgentSchedules(workspaceId, agent.id);
  const [editing, setEditing] = useState<AgentSchedule | "new" | null>(
    seed ? "new" : null,
  );
  const [deleting, setDeleting] = useState<AgentSchedule | null>(null);
  const remove = useDeleteAgentSchedule();
  const update = useUpdateAgentSchedule();

  const toggle = async (schedule: AgentSchedule, enabled: boolean) => {
    try {
      await update.mutateAsync({
        agentId: agent.id,
        scheduleId: schedule.id,
        patch: { workspaceId, enabled },
      });
    } catch (error) {
      toast.error(t(scheduleErrorKey(error)));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync({
        workspaceId,
        agentId: agent.id,
        scheduleId: deleting.id,
      });
      toast.success(t("ai:agents.schedules.deleted"));
      setDeleting(null);
    } catch {
      toast.error(t("ai:agents.schedules.saveError"));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <DialogHeader className="border-border border-b px-6 py-5">
          <DialogTitle>
            {t("ai:agents.schedules.title", { name: agent.name })}
          </DialogTitle>
          <DialogDescription>{t("ai:agents.schedules.hint")}</DialogDescription>
        </DialogHeader>
        {editing ? (
          <ScheduleEditor
            workspaceId={workspaceId}
            agent={agent}
            schedule={editing === "new" ? null : editing}
            seed={editing === "new" ? seed : null}
            onDone={() => setEditing(null)}
          />
        ) : deleting ? (
          <div className="flex flex-col gap-4 px-6 py-5">
            <p className="text-sm">{t("ai:agents.schedules.deleteBody")}</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleting(null)}>
                {t("ai:agents.cancel")}
              </Button>
              <Button
                variant="destructive"
                loading={remove.isPending}
                onClick={() => void confirmDelete()}
              >
                {t("ai:agents.delete")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-6 py-5">
            {schedules.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (schedules.data ?? []).length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("ai:agents.schedules.empty")}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {(schedules.data ?? []).map((schedule) => (
                  <ScheduleRow
                    key={schedule.id}
                    schedule={schedule}
                    pending={update.isPending}
                    onToggle={(enabled) => void toggle(schedule, enabled)}
                    onEdit={() => setEditing(schedule)}
                    onDelete={() => setDeleting(schedule)}
                  />
                ))}
              </ul>
            )}
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => setEditing("new")}
            >
              <Plus aria-hidden />
              {t("ai:agents.schedules.create")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ScheduleRow({
  schedule,
  pending,
  onToggle,
  onEdit,
  onDelete,
}: {
  schedule: AgentSchedule;
  pending: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const timing = cronLabel(schedule.cron);
  return (
    <li className="flex flex-wrap items-start gap-3 px-3 py-3">
      <CalendarClock
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex flex-wrap items-center gap-2 font-medium text-sm">
          {t(timing.key, timing.values)}
          <span className="font-normal text-muted-foreground text-xs">
            {schedule.timezone}
          </span>
          {!schedule.enabled && (
            <Badge variant="outline" className="text-muted-foreground">
              {t("ai:agents.off")}
            </Badge>
          )}
        </p>
        <p className="truncate text-muted-foreground text-xs">
          {[
            schedule.project?.name,
            schedule.task
              ? `${schedule.task.key} ${schedule.task.title}`
              : t("ai:agents.schedules.projectLevel"),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="line-clamp-2 text-xs">{schedule.prompt}</p>
        <p className="text-muted-foreground text-xs">
          {[
            schedule.enabled && schedule.nextRunAt
              ? t("ai:agents.schedules.nextRun", {
                  time: formatDateTime(schedule.nextRunAt),
                })
              : null,
            schedule.runsAs
              ? t("ai:agents.schedules.runsAs", { name: schedule.runsAs.name })
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Switch
          checked={schedule.enabled}
          disabled={pending}
          onCheckedChange={onToggle}
          aria-label={t(
            schedule.enabled
              ? "ai:agents.schedules.disable"
              : "ai:agents.schedules.enable",
          )}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("ai:agents.schedules.edit")}
          onClick={onEdit}
        >
          <Pencil aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("ai:agents.schedules.delete")}
          onClick={onDelete}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </li>
  );
}

/** Create or edit one schedule. */
export function ScheduleEditor({
  workspaceId,
  agent,
  schedule,
  seed,
  onDone,
}: {
  workspaceId: string;
  agent: Agent;
  schedule: AgentSchedule | null;
  seed?: ScheduleSeed | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const projects = useProjectOptions(workspaceId, agent);
  const create = useCreateAgentSchedule();
  const update = useUpdateAgentSchedule();
  const initialCron = schedule?.cron ?? seed?.cron ?? SCHEDULE_PRESETS[0].cron;
  const [preset, setPreset] = useState<string>(presetOf(initialCron));
  const [cron, setCron] = useState(initialCron);
  const [timezone, setTimezone] = useState(
    schedule?.timezone ?? defaultTimeZone(),
  );
  const [projectId, setProjectId] = useState(
    schedule?.project?.id ?? projects[0]?.id ?? "",
  );
  const [taskId, setTaskId] = useState(schedule?.task?.id ?? NO_TASK);
  const [prompt, setPrompt] = useState(schedule?.prompt ?? seed?.prompt ?? "");
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const zones = useMemo(() => timeZones(timezone), [timezone]);
  const effectiveProject = projectId || projects[0]?.id || "";
  const board = useGetTasks(effectiveProject);
  const project = projects.find((entry) => entry.id === effectiveProject);
  const tasks = useMemo(() => {
    const data = board.data as
      | {
          columns?: {
            tasks: { id: string; number: number | null; title: string }[];
          }[];
          plannedTasks?: { id: string; number: number | null; title: string }[];
        }
      | undefined;
    return [
      ...(data?.columns?.flatMap((column) => column.tasks) ?? []),
      ...(data?.plannedTasks ?? []),
    ].slice(0, 300);
  }, [board.data]);
  const taskLabel = (task: { number: number | null; title: string }) =>
    `${(project?.slug ?? "").toUpperCase()}-${task.number ?? 0} ${task.title}`;
  const selectedTask =
    taskId === NO_TASK ? null : tasks.find((task) => task.id === taskId);
  const cronValid = looksLikeCron(cron);
  const pending = create.isPending || update.isPending;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!cronValid || !prompt.trim() || !effectiveProject) return;
    setError(null);
    const fields = {
      workspaceId,
      projectId: effectiveProject,
      taskId: taskId === NO_TASK ? null : taskId,
      cron: cron.trim(),
      timezone,
      prompt: prompt.trim(),
      enabled,
    };
    try {
      if (schedule) {
        await update.mutateAsync({
          agentId: agent.id,
          scheduleId: schedule.id,
          patch: fields,
        });
      } else {
        await create.mutateAsync({ agentId: agent.id, schedule: fields });
      }
      toast.success(t("ai:agents.schedules.saved"));
      onDone();
    } catch (failure) {
      setError(scheduleErrorKey(failure));
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)}>
      <div className="flex flex-col gap-4 px-6 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-preset`}>
              {t("ai:agents.schedules.when")}
            </Label>
            <Select
              value={preset}
              onValueChange={(value) => {
                if (!value) return;
                setPreset(String(value));
                const match = SCHEDULE_PRESETS.find(
                  (entry) => entry.id === value,
                );
                if (match) setCron(match.cron);
              }}
            >
              <SelectTrigger id={`${id}-preset`}>
                <SelectValue>
                  {preset === CUSTOM_PRESET
                    ? t("ai:agents.schedules.presets.custom")
                    : t(
                        SCHEDULE_PRESETS.find((entry) => entry.id === preset)
                          ?.labelKey ?? "ai:agents.schedules.presets.custom",
                      )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SCHEDULE_PRESETS.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {t(entry.labelKey)}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_PRESET}>
                  {t("ai:agents.schedules.presets.custom")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-timezone`}>
              {t("ai:agents.schedules.timezone")}
            </Label>
            <Select
              value={timezone}
              onValueChange={(value) => value && setTimezone(String(value))}
            >
              <SelectTrigger id={`${id}-timezone`}>
                <SelectValue>{timezone}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {zones.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {preset === CUSTOM_PRESET && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-cron`}>
              {t("ai:agents.schedules.cron")}
            </Label>
            <Input
              id={`${id}-cron`}
              value={cron}
              maxLength={100}
              className="font-mono"
              aria-invalid={!cronValid || undefined}
              aria-describedby={`${id}-cron-hint`}
              onChange={(event) => setCron(event.target.value)}
            />
            <p id={`${id}-cron-hint`} className="text-muted-foreground text-xs">
              {t("ai:agents.schedules.cronHint")}
            </p>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-project`}>
              {t("ai:agents.schedules.project")}
            </Label>
            <Select
              value={effectiveProject}
              onValueChange={(value) => {
                if (!value) return;
                setProjectId(String(value));
                setTaskId(NO_TASK);
              }}
            >
              <SelectTrigger id={`${id}-project`}>
                <SelectValue>
                  {project?.name ?? t("ai:agents.schedules.chooseProject")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {projects.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-task`}>
              {t("ai:agents.schedules.task")}
            </Label>
            <Select
              value={taskId}
              onValueChange={(value) => value && setTaskId(String(value))}
            >
              <SelectTrigger id={`${id}-task`}>
                <SelectValue>
                  {selectedTask
                    ? taskLabel(selectedTask)
                    : taskId !== NO_TASK && schedule?.task
                      ? `${schedule.task.key} ${schedule.task.title}`
                      : t("ai:agents.schedules.noTask")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TASK}>
                  {t("ai:agents.schedules.noTask")}
                </SelectItem>
                {tasks.map((task) => (
                  <SelectItem key={task.id} value={task.id}>
                    {taskLabel(task)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="-mt-2 text-muted-foreground text-xs">
          {t("ai:agents.schedules.taskHint")}
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-prompt`}>
            {t("ai:agents.schedules.prompt")}
          </Label>
          <Textarea
            id={`${id}-prompt`}
            value={prompt}
            rows={4}
            maxLength={4000}
            required
            placeholder={t("ai:agents.schedules.promptPlaceholder")}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id={`${id}-enabled`}
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          <Label htmlFor={`${id}-enabled`}>
            {t("ai:agents.schedules.enabled")}
          </Label>
        </div>
        <p className="text-muted-foreground text-xs">
          {t("ai:agents.schedules.runsAsHint")}
        </p>
        {error && (
          <p role="alert" className="text-destructive text-xs">
            {t(error)}
          </p>
        )}
      </div>
      <DialogFooter className="gap-2 border-border border-t px-6 py-4 sm:gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          {t("ai:agents.cancel")}
        </Button>
        <Button
          type="submit"
          loading={pending}
          disabled={!cronValid || !prompt.trim() || !effectiveProject}
        >
          {t("ai:agents.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

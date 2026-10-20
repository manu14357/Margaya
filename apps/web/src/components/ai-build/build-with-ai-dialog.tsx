import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  applyBuild,
  type BuildProgress,
  type BuildReport,
  proposeBuild,
} from "@/fetchers/ai/build";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { aiErrorKey } from "@/lib/ai/format";
import {
  canCreate,
  countItems,
  type ReviewDraft,
  toProposal,
  toReview,
} from "@/lib/ai-build/review";
import { cn } from "@/lib/cn";
import useBuildWithAiStore from "@/store/build-with-ai";
import ProposalReview from "./proposal-review";

type Step = "prompt" | "drafting" | "review" | "creating" | "done";

const FAILURE_KINDS = [
  "project",
  "column",
  "cycle",
  "module",
  "task",
  "subtask",
  "label",
  "estimate",
  "cycle_tasks",
  "module_tasks",
] as const;

function failureKindKey(kind: string) {
  const known = (FAILURE_KINDS as readonly string[]).includes(kind)
    ? (kind as (typeof FAILURE_KINDS)[number])
    : "task";
  return `ai:build.kinds.${known}` as const;
}

/**
 * "Build with AI": a prompt becomes a proposed plan (project, cycles,
 * modules, tasks and sub-tasks) shown as editable cards; nothing exists
 * until the person presses Create. Hidden whenever AI is unavailable.
 */
export default function BuildWithAiDialog() {
  const { t } = useTranslation();
  const open = useBuildWithAiStore((state) => state.open);
  const projectId = useBuildWithAiStore((state) => state.projectId);
  const close = useBuildWithAiStore((state) => state.close);
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const { available } = useAiAvailability(open ? projectId : null);
  const { canCreateProjects, canCreateTasks, canUpdateProjects } =
    useWorkspacePermission();
  const { data: projects } = useGetProjects({
    workspaceId: open ? workspaceId : "",
  });
  const project = projects?.find((item) => item.id === projectId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const promptId = useId();

  const canBuildHere = Boolean(project) && canCreateTasks();
  const canBuildNew = canCreateProjects();
  const [target, setTarget] = useState<"current" | "new">("new");
  const [step, setStep] = useState<Step>("prompt");
  const [prompt, setPrompt] = useState("");
  const [deep, setDeep] = useState(false);
  const [draft, setDraft] = useState<ReviewDraft | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  const [report, setReport] = useState<BuildReport | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Each opening starts fresh, aimed at the project it was opened from.
  useEffect(() => {
    if (!open) return;
    setTarget(projectId ? "current" : "new");
    setStep("prompt");
    setDraft(null);
    setErrorKey(null);
    setProgress(null);
    setReport(null);
  }, [open, projectId]);

  if (!available) return null;

  const buildingHere = target === "current" && canBuildHere;
  const reviewed = draft ? toProposal(draft) : null;

  const handleClose = () => {
    if (step === "creating") return;
    abortRef.current?.abort();
    close();
  };

  const draftPlan = async () => {
    if (prompt.trim().length < 3) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setErrorKey(null);
    setStep("drafting");
    try {
      const result = await proposeBuild(
        {
          workspaceId,
          ...(buildingHere && projectId ? { projectId } : {}),
          prompt: prompt.trim(),
          depth: deep ? "deep" : "balanced",
        },
        controller.signal,
      );
      const next = toReview(result.proposal);
      // Columns and the description need project:update; leave them out
      // rather than fail them.
      if (!canUpdateProjects()) {
        next.columns = next.columns.map((column) => ({
          ...column,
          include: false,
        }));
        if (next.project) next.project = { ...next.project, description: "" };
      }
      setDraft(next);
      setStep("review");
    } catch (error) {
      if (controller.signal.aborted) {
        setStep("prompt");
        return;
      }
      setErrorKey(aiErrorKey(error));
      setStep("prompt");
    }
  };

  const create = async () => {
    if (!draft || !reviewed) return;
    setStep("creating");
    setProgress({
      done: 0,
      total: countItems(reviewed),
      kind: "task",
      name: "",
      ok: true,
    });
    try {
      const result = await applyBuild(
        {
          workspaceId,
          ...(buildingHere && projectId ? { projectId } : {}),
          proposal: reviewed,
        },
        setProgress,
      );
      setReport(result);
      setStep("done");
      const builtId = result.projectId;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] }),
        ...(builtId
          ? [
              queryClient.invalidateQueries({ queryKey: ["tasks", builtId] }),
              queryClient.invalidateQueries({ queryKey: ["columns", builtId] }),
              queryClient.invalidateQueries({ queryKey: ["cycles", builtId] }),
              queryClient.invalidateQueries({ queryKey: ["modules", builtId] }),
            ]
          : []),
        queryClient.invalidateQueries({ queryKey: ["labels", workspaceId] }),
      ]);
    } catch (error) {
      setErrorKey(aiErrorKey(error));
      setStep("review");
    }
  };

  const openProject = () => {
    if (!report?.projectId) return;
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: { workspaceId, projectId: report.projectId },
    });
    close();
  };

  const percent =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent
        className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden"
        showCloseButton={step !== "creating"}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-4 text-muted-foreground" />
            {t("ai:build.title")}
          </DialogTitle>
          <DialogDescription>
            {step === "review"
              ? t("ai:build.review.description")
              : t("ai:build.description")}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="min-h-0">
          {(step === "prompt" || step === "drafting") && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor={promptId} className="font-medium text-sm">
                  {t("ai:build.promptLabel")}
                </label>
                <Textarea
                  id={promptId}
                  value={prompt}
                  maxLength={4000}
                  placeholder={t("ai:build.promptPlaceholder")}
                  disabled={step === "drafting"}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      (event.metaKey || event.ctrlKey) &&
                      event.key === "Enter"
                    ) {
                      event.preventDefault();
                      void draftPlan();
                    }
                  }}
                />
              </div>
              {canBuildHere && canBuildNew && project && (
                <fieldset className="space-y-1.5">
                  <legend className="font-medium text-sm">
                    {t("ai:build.target")}
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {(["current", "new"] as const).map((value) => (
                      <label
                        key={value}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm",
                          target === value && "border-ring bg-muted/50",
                        )}
                      >
                        <input
                          type="radio"
                          name="build-target"
                          className="accent-primary"
                          checked={target === value}
                          disabled={step === "drafting"}
                          onChange={() => setTarget(value)}
                        />
                        {value === "current"
                          ? t("ai:build.targetCurrent", { name: project.name })
                          : t("ai:build.targetNew")}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {/* biome-ignore lint/a11y/noLabelWithoutControl: the checkbox is inside. */}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={deep}
                  disabled={step === "drafting"}
                  onCheckedChange={(value) => setDeep(Boolean(value))}
                />
                {t("ai:build.deep")}
              </label>
              {step === "drafting" && (
                <p
                  role="status"
                  aria-live="polite"
                  className="text-muted-foreground text-sm"
                >
                  {t("ai:build.drafting")}
                </p>
              )}
            </div>
          )}

          {step === "review" && draft && (
            <ProposalReview
              draft={draft}
              onChange={setDraft}
              canAddColumns={canUpdateProjects()}
            />
          )}

          {step === "creating" && progress && (
            <div className="space-y-3" aria-live="polite">
              <Progress value={percent} aria-label={t("ai:build.creating")} />
              <p role="status" className="text-sm">
                {t("ai:build.progress", {
                  done: progress.done,
                  total: progress.total,
                })}
              </p>
              {progress.name && (
                <p className="truncate text-muted-foreground text-xs">
                  {progress.name}
                </p>
              )}
            </div>
          )}

          {step === "done" && report && (
            <div className="space-y-4" aria-live="polite">
              <p className="text-sm">
                {report.failures.length === 0
                  ? t("ai:build.done.success", {
                      count: report.created.tasks + report.created.subtasks,
                    })
                  : t("ai:build.done.partial", {
                      count: report.failures.length,
                    })}
              </p>
              <ul className="grid grid-cols-2 gap-1 text-muted-foreground text-xs sm:grid-cols-3">
                {(
                  [
                    "tasks",
                    "subtasks",
                    "cycles",
                    "modules",
                    "columns",
                    "labels",
                  ] as const
                ).map((kind) => (
                  <li key={kind}>
                    {t(`ai:build.done.created.${kind}`, {
                      count: report.created[kind],
                    })}
                  </li>
                ))}
              </ul>
              {report.estimatesSkipped && (
                <p className="text-muted-foreground text-xs">
                  {t("ai:build.done.estimatesSkipped")}
                </p>
              )}
              {report.failures.length > 0 && (
                <ul className="space-y-1 rounded-lg border p-3 text-xs">
                  {report.failures.map((failure, index) => (
                    <li
                      // biome-ignore lint/suspicious/noArrayIndexKey: failures have no id.
                      key={index}
                      className="flex flex-wrap gap-x-2"
                    >
                      <span className="font-medium">
                        {t(failureKindKey(failure.kind))}
                      </span>
                      <span className="min-w-0 truncate">{failure.name}</span>
                      <span className="text-muted-foreground">
                        {failure.message}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {errorKey && (
            <p role="alert" className="mt-3 text-destructive text-sm">
              {t(errorKey)}
            </p>
          )}
        </DialogPanel>

        <DialogFooter className="shrink-0 items-center">
          {step === "prompt" && (
            <Button
              type="button"
              disabled={
                prompt.trim().length < 3 || (!canBuildNew && !buildingHere)
              }
              onClick={() => void draftPlan()}
            >
              <Sparkles aria-hidden className="size-4" />
              {t("ai:build.draft")}
            </Button>
          )}
          {step === "drafting" && (
            <Button
              type="button"
              variant="outline"
              onClick={() => abortRef.current?.abort()}
            >
              {t("ai:build.cancel")}
            </Button>
          )}
          {step === "review" && reviewed && draft && (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep("prompt")}
              >
                {t("ai:build.back")}
              </Button>
              <Button
                type="button"
                disabled={!canCreate(draft)}
                onClick={() => void create()}
              >
                {t("ai:build.create", { count: countItems(reviewed) })}
              </Button>
            </>
          )}
          {step === "done" && (
            <>
              <Button type="button" variant="ghost" onClick={handleClose}>
                {t("ai:build.close")}
              </Button>
              {report?.projectId && (
                <Button type="button" onClick={openProject}>
                  {t("ai:build.openProject")}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

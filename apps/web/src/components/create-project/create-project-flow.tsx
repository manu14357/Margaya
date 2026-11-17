import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, CircleAlert } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import {
  useProjectTemplate,
  useProjectTemplates,
} from "@/hooks/queries/project-template/use-project-templates";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useLocale } from "@/hooks/use-locale";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import {
  clearProjectDraft,
  readLastChoice,
  readProjectDraft,
  readWorkspaceIntent,
  writeProjectDraft,
} from "@/lib/create-flow-storage";
import {
  ALL_CATEGORY,
  BLANK_TEMPLATE_ID,
  RECOMMENDED_CATEGORY,
} from "@/lib/project-template-gallery";
import { toast } from "@/lib/toast";
import {
  buildCreateRequest,
  type CreateSource,
  EMPTY_FORM,
  effectiveForm,
  type FlowState,
  flowReducer,
  initialFlowState,
  type SetupErrors,
  suggestionFor,
  validateSetup,
} from "./create-flow-model";
import { featuresOfProject } from "./project-features";
import { ProjectSetupFields } from "./project-setup-fields";
import { StepTransition } from "./step-transition";
import { type GalleryProject, TemplateGallery } from "./template-gallery";
import {
  BlankPreviewPanel,
  PreviewRegion,
  ProjectSourcePreviewPanel,
  TemplatePreviewPanel,
  TemplatePreviewSkeleton,
} from "./template-preview";
import type { CreateFailure } from "./use-submit-project";
import { useSubmitProject } from "./use-submit-project";

export type CreateProjectEntry = "default" | "newBlank" | "fromTemplate";

export type CreateProjectFlowProps = {
  open: boolean;
  onClose: () => void;
  entry?: CreateProjectEntry;
  /** Defaults to the active workspace. */
  workspaceId?: string;
  /** A gallery category that orders "Recommended" (the workspace intent). */
  intent?: string | null;
};

type Draft = Pick<
  FlowState,
  "step" | "categoryId" | "source" | "form" | "afterCreate"
>;

function isEdited(state: FlowState) {
  const { form } = state;
  return (
    state.step === "setup" ||
    form.nameEdited ||
    form.keyEdited ||
    form.iconEdited ||
    form.visibility !== null ||
    form.sampleData !== null ||
    Object.keys(form.features).length > 0
  );
}

/**
 * The guided project create: Choose (gallery and preview), then Set up, then
 * one atomic request and the board. A large dialog on desktop, a full-height
 * sheet on phones. Escape keeps a draft for 30 minutes.
 */
export default function CreateProjectFlow({
  open,
  onClose,
  entry = "default",
  workspaceId: workspaceIdProp,
  intent,
}: CreateProjectFlowProps) {
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspaceIdProp ?? workspace?.id ?? "";
  // A fresh flow per opening: the reducer starts from the draft or the last
  // choice each time.
  const [session, setSession] = useState(0);
  const wasOpen = useRef(open);
  if (open && !wasOpen.current) setSession((value) => value + 1);
  wasOpen.current = open;
  const closeRef = useRef<() => void>(onClose);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeRef.current();
      }}
    >
      <DialogPopup
        className="h-[min(680px,88vh)] max-w-5xl max-sm:h-[calc(100dvh-3rem)]"
        aria-describedby={undefined}
      >
        {open && workspaceId && (
          <FlowContent
            key={session}
            entry={entry}
            workspaceId={workspaceId}
            workspaceName={workspace?.name}
            intentProp={intent}
            onClose={onClose}
            closeRef={closeRef}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function FlowContent({
  entry,
  workspaceId,
  intentProp,
  onClose,
  closeRef,
}: {
  entry: CreateProjectEntry;
  workspaceId: string;
  workspaceName?: string;
  intentProp?: string | null;
  onClose: () => void;
  closeRef: React.MutableRefObject<() => void>;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const { locale } = useLocale();
  const isPhone = useMediaQuery("(max-width: 639px)");
  const intent = intentProp ?? readWorkspaceIntent(workspaceId);
  const lastChoice = useMemo(
    () => (userId ? readLastChoice(userId, workspaceId) : null),
    [userId, workspaceId],
  );

  const [restored, setRestored] = useState(false);
  const [state, dispatch] = useReducer(flowReducer, undefined, () => {
    if (entry === "newBlank") {
      return initialFlowState({ step: "setup", source: { kind: "blank" } });
    }
    if (entry === "fromTemplate") {
      return initialFlowState({ categoryId: ALL_CATEGORY });
    }
    const draft = userId ? readProjectDraft<Draft>(userId, workspaceId) : null;
    if (draft?.source && draft.form) {
      return initialFlowState({
        step: draft.step === "setup" ? "setup" : "choose",
        categoryId: draft.categoryId ?? RECOMMENDED_CATEGORY,
        source: draft.source,
        form: { ...EMPTY_FORM, ...draft.form },
        afterCreate: draft.afterCreate ?? null,
      });
    }
    return initialFlowState({
      categoryId: lastChoice?.categoryId ?? RECOMMENDED_CATEGORY,
      source: lastChoice?.templateId
        ? { kind: "template", id: lastChoice.templateId }
        : { kind: "blank" },
    });
  });
  // The restored line shows only when a draft actually came back.
  useEffect(() => {
    if (entry !== "default" || !userId) return;
    if (readProjectDraft<Draft>(userId, workspaceId)) setRestored(true);
  }, [entry, userId, workspaceId]);

  const catalog = useProjectTemplates();
  const templates = catalog.data?.templates ?? [];
  const categories = catalog.data?.categories ?? [];
  const hasBlankTemplate = templates.some(
    (template) => template.id === BLANK_TEMPLATE_ID,
  );
  const { data: projectList = [] } = useGetProjects({ workspaceId });
  const projects = useMemo(
    () => projectList.filter((project) => !project.archivedAt),
    [projectList],
  );
  const galleryProjects: GalleryProject[] = projects.map((project) => ({
    id: project.id,
    name: project.name,
    slug: project.slug,
    icon: project.icon,
  }));

  // A remembered template the server no longer has falls back to Blank.
  useEffect(() => {
    if (!catalog.data) return;
    const { source } = state;
    if (
      source.kind === "template" &&
      !catalog.data.templates.some((template) => template.id === source.id)
    ) {
      dispatch({ type: "select", source: { kind: "blank" } });
    }
  }, [catalog.data, state]);

  const previewId =
    state.source.kind === "template"
      ? state.source.id
      : state.source.kind === "blank" && hasBlankTemplate
        ? BLANK_TEMPLATE_ID
        : null;
  const preview = useProjectTemplate(previewId);

  const { canCreateTasks, canCreateLabels, isCheckingPermissions } =
    useWorkspacePermission();
  const ai = useAiAvailability();
  const capabilities = {
    canCreateTasks: !isCheckingPermissions && canCreateTasks(),
    canCreateLabels: isCheckingPermissions || canCreateLabels(),
    aiAvailable: Boolean(ai.data?.instanceEnabled && ai.data?.workspaceEnabled),
  };

  const suggestion = suggestionFor({
    source: state.source,
    templates,
    preview: preview.data,
    projects,
  });
  const sampleData =
    capabilities.canCreateTasks && (state.form.sampleData ?? false);

  // ---- Announcements and focus --------------------------------------------
  const [liveMessage, setLiveMessage] = useState("");
  const announce = useCallback((message: string) => {
    setLiveMessage("");
    window.setTimeout(() => setLiveMessage(message), 30);
  }, []);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const stepNumber = state.step === "choose" ? 1 : 2;
  const stepTitle =
    state.step === "choose"
      ? t("common:modals.createProject.choose.title")
      : t("common:modals.createProject.setup.title");

  const focusStep = useCallback(() => {
    if (state.step === "setup" && state.focusName) {
      // Called again when the animation ends: never re-select what the
      // person has already started typing.
      if (document.activeElement === nameRef.current) return;
      nameRef.current?.focus();
      nameRef.current?.select();
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
  }, [state.step, state.focusName]);

  const firstRender = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per step change
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      const id = window.setTimeout(() => {
        if (entry === "fromTemplate" && state.step === "choose") {
          searchRef.current?.focus();
        } else {
          focusStep();
        }
      }, 60);
      return () => window.clearTimeout(id);
    }
    announce(
      t("common:modals.createProject.stepAnnouncement", {
        current: stepNumber,
        total: 2,
        title: stepTitle,
      }),
    );
    // The fast path (Enter on a tile, then typing) must not lose keystrokes
    // to the step animation: the name field takes focus on the next frame.
    if (state.step === "setup" && state.focusName) {
      const frame = window.requestAnimationFrame(focusStep);
      return () => window.cancelAnimationFrame(frame);
    }
    // Fallback when the transition never reports its end (no animation).
    const id = window.setTimeout(focusStep, 260);
    return () => window.clearTimeout(id);
  }, [state.step]);

  // ---- Closing keeps a draft ----------------------------------------------
  const created = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  closeRef.current = () => {
    const current = stateRef.current;
    if (!created.current && userId && isEdited(current)) {
      writeProjectDraft<Draft>(userId, workspaceId, {
        step: current.step,
        categoryId: current.categoryId,
        source: current.source,
        form: current.form,
        afterCreate: current.afterCreate,
      });
    }
    onClose();
  };

  const startOver = () => {
    if (userId) clearProjectDraft(userId, workspaceId);
    setRestored(false);
    dispatch({
      type: "restore",
      state: initialFlowState({ categoryId: RECOMMENDED_CATEGORY }),
    });
  };

  // ---- Submit ---------------------------------------------------------------
  const { submit, isPending } = useSubmitProject(workspaceId);
  const [attempted, setAttempted] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyConflict, setKeyConflict] = useState<string | null>(null);
  const [failure, setFailure] = useState<CreateFailure | null>(null);
  const values = effectiveForm(state.form, suggestion);
  const errors: SetupErrors = attempted
    ? validateSetup(values.name, values.key)
    : {};

  const handleSubmit = async () => {
    if (isPending) return;
    setAttempted(true);
    const invalid = validateSetup(values.name, values.key);
    if (invalid.name) {
      nameRef.current?.focus();
      return;
    }
    if (invalid.key) {
      setKeyOpen(true);
      window.setTimeout(() => keyRef.current?.focus(), 0);
      return;
    }
    setFailure(null);
    setKeyConflict(null);
    announce(
      t("common:modals.createProject.status.creating", {
        name: values.name.trim(),
      }),
    );
    const outcome = await submit(
      buildCreateRequest({
        workspaceId,
        source: state.source,
        form: state.form,
        suggestion,
        sampleData,
        locale,
        canCopyOpenTasks: capabilities.canCreateTasks,
      }),
      {
        categoryId: state.categoryId,
        templateId: state.source.kind === "template" ? state.source.id : null,
      },
    );
    if (!outcome.ok) {
      if (outcome.failure.kind === "conflict") {
        setKeyConflict(outcome.failure.key);
        setKeyOpen(true);
        window.setTimeout(() => keyRef.current?.focus(), 0);
      } else {
        setFailure(outcome.failure);
      }
      return;
    }
    created.current = true;
    const name = outcome.project.name;
    toast.success(
      outcome.firstSteps
        ? t("common:modals.createProject.status.created", { name })
        : t("common:modals.createProject.status.createdShort", { name }),
    );
    onClose();
    if (state.afterCreate === "import") {
      navigate({
        to: "/dashboard/settings/projects/$projectId/general",
        params: { projectId: outcome.project.id },
      });
      return;
    }
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: { workspaceId, projectId: outcome.project.id },
    });
  };

  // ---- Keyboard ---------------------------------------------------------------
  const continueWith = (source?: CreateSource, viaKeyboard = false) => {
    setAttempted(false);
    setFailure(null);
    dispatch({ type: "continue", source, viaKeyboard });
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (state.step === "setup") void handleSubmit();
      else continueWith(undefined, true);
      return;
    }
    if (
      event.key === "/" &&
      state.step === "choose" &&
      !(event.target instanceof HTMLInputElement) &&
      !(event.target instanceof HTMLTextAreaElement)
    ) {
      event.preventDefault();
      searchRef.current?.focus();
    }
  };

  const selectedName =
    state.source.kind === "project"
      ? projects.find(
          (project) => project.id === (state.source as { id: string }).id,
        )?.name
      : state.source.kind === "template"
        ? templates.find(
            (template) => template.id === (state.source as { id: string }).id,
          )?.name
        : t("common:modals.createProject.choose.blankName");

  const primaryLabel =
    state.source.kind === "blank"
      ? t("common:modals.createProject.choose.startBlank")
      : state.source.kind === "project"
        ? t("common:modals.createProject.choose.useProject")
        : t("common:modals.createProject.choose.useTemplate");

  const previewContent = (() => {
    if (state.source.kind === "project") {
      const project = projects.find(
        (item) => item.id === (state.source as { id: string }).id,
      );
      if (!project) return null;
      return (
        <ProjectSourcePreviewPanel
          name={project.name}
          slug={project.slug}
          features={featuresOfProject(project)}
        />
      );
    }
    if (!previewId) return <BlankPreviewPanel />;
    if (preview.data && preview.data.id === previewId) {
      return (
        <TemplatePreviewPanel
          preview={preview.data}
          categories={categories}
          projectKey={values.key}
          labelNote={
            capabilities.canCreateLabels
              ? undefined
              : t("common:modals.createProject.setup.labelsSkipped")
          }
        />
      );
    }
    if (preview.isError) {
      return (
        <p className="text-muted-foreground text-sm">
          {t("common:modals.createProject.preview.loadError")}
        </p>
      );
    }
    return <TemplatePreviewSkeleton />;
  })();
  const previewRegion = (
    <PreviewRegion
      label={t("common:modals.createProject.preview.region", {
        template: selectedName ?? "",
      })}
    >
      {previewContent}
    </PreviewRegion>
  );

  const onSelect = (source: CreateSource) => {
    dispatch({ type: "select", source });
    if (isPhone) dispatch({ type: "details", open: true });
  };

  const showDetails = isPhone && state.step === "choose" && state.details;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dialog-wide shortcuts (Ctrl/Cmd+Enter, /)
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={onKeyDown}
      inert={isPending ? true : undefined}
    >
      <div className="flex shrink-0 items-start gap-4 px-6 pt-5 pb-3 pe-14">
        <div className="min-w-0 flex-1 space-y-1">
          <DialogTitle
            ref={headingRef}
            tabIndex={-1}
            className="rounded-sm outline-none"
          >
            <span className="sr-only">
              {t("common:modals.createProject.stepPrefix", {
                current: stepNumber,
                total: 2,
              })}{" "}
            </span>
            {showDetails ? selectedName : stepTitle}
          </DialogTitle>
          <DialogDescription>
            {state.step === "choose"
              ? t("common:modals.createProject.choose.subtitle")
              : t("common:modals.createProject.setup.subtitle")}
          </DialogDescription>
        </div>
        <span
          aria-hidden
          className="mt-1 hidden shrink-0 text-muted-foreground text-xs tabular-nums sm:block"
        >
          {t("common:modals.createProject.stepLabel", {
            current: stepNumber,
            total: 2,
            name:
              state.step === "choose"
                ? t("common:modals.createProject.choose.stepName")
                : t("common:modals.createProject.setup.stepName"),
          })}
        </span>
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <StepTransition
          stepKey={showDetails ? "details" : state.step}
          direction={state.direction}
          onEntered={focusStep}
          className="h-full min-h-0"
        >
          {state.step === "choose" ? (
            showDetails ? (
              <div className="h-full overflow-y-auto px-6 pb-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mb-2 min-h-11 -ms-2"
                  onClick={() => dispatch({ type: "details", open: false })}
                >
                  <ArrowLeft className="size-4" aria-hidden />
                  {t("common:modals.createProject.back")}
                </Button>
                {previewRegion}
              </div>
            ) : (
              <div className="h-full min-h-0 px-6 pb-4">
                <TemplateGallery
                  templates={templates}
                  categories={categories}
                  isLoading={catalog.isLoading}
                  isError={catalog.isError}
                  onRetry={() => void catalog.refetch()}
                  projects={galleryProjects}
                  categoryId={state.categoryId}
                  onCategory={(categoryId) =>
                    dispatch({ type: "category", categoryId })
                  }
                  query={state.query}
                  onQuery={(query) => dispatch({ type: "query", query })}
                  source={state.source}
                  onSelect={onSelect}
                  onActivate={(source) => continueWith(source, true)}
                  onStartBlank={() => continueWith({ kind: "blank" })}
                  onImport={() => dispatch({ type: "import" })}
                  intent={intent}
                  lastTemplateId={lastChoice?.templateId}
                  searchRef={searchRef}
                  announce={announce}
                  preview={previewRegion}
                />
              </div>
            )
          ) : (
            <div className="grid h-full min-h-0 grid-cols-1 gap-6 overflow-y-auto px-6 pb-4 md:grid-cols-[minmax(0,1fr)_17rem]">
              <form
                noValidate
                className="min-w-0 space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSubmit();
                }}
              >
                {failure && (
                  <FailureAlert
                    failure={failure}
                    onRetry={() => void handleSubmit()}
                    onBackToTemplates={() => {
                      setFailure(null);
                      dispatch({ type: "back" });
                    }}
                    onClose={() => closeRef.current()}
                  />
                )}
                <ProjectSetupFields
                  form={state.form}
                  suggestion={suggestion}
                  source={state.source}
                  sampleData={sampleData}
                  onChange={(change) => {
                    if ("key" in change) setKeyConflict(null);
                    dispatch({ type: "edit", change });
                  }}
                  onFeature={(key, value) =>
                    dispatch({ type: "feature", key, value })
                  }
                  capabilities={capabilities}
                  errors={errors}
                  keyConflict={keyConflict}
                  nameRef={nameRef}
                  keyRef={keyRef}
                  keyOpen={keyOpen}
                  onKeyOpen={(next) => {
                    setKeyOpen(next);
                    if (next)
                      window.setTimeout(() => keyRef.current?.focus(), 0);
                  }}
                  disabled={isPending}
                />
                {/* Enter in a field submits. */}
                <button type="submit" hidden tabIndex={-1} aria-hidden />
              </form>
              <aside
                aria-label={t("common:modals.createProject.setup.summary")}
                className="order-first space-y-2 rounded-xl border border-border bg-muted/40 p-3 md:order-none md:self-start"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {t("common:modals.createProject.setup.yourChoice")}
                  </p>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto min-h-11 px-0 sm:min-h-0"
                    onClick={() => dispatch({ type: "back" })}
                  >
                    {t("common:modals.createProject.setup.change")}
                  </Button>
                </div>
                <p className="font-medium text-foreground text-sm">
                  {selectedName}
                </p>
                <ChoiceSummary
                  statuses={
                    preview.data && preview.data.id === previewId
                      ? preview.data.statuses.length
                      : null
                  }
                  sampleTaskCount={sampleData ? suggestion.sampleTaskCount : 0}
                />
              </aside>
            </div>
          )}
        </StepTransition>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-muted/72 px-6 py-3 sm:rounded-b-[calc(var(--radius-2xl)-1px)]">
        {state.step === "setup" ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => dispatch({ type: "back" })}
            className="min-h-11 sm:min-h-0"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t("common:modals.createProject.back")}
          </Button>
        ) : restored ? (
          <p className="text-muted-foreground text-xs">
            {t("common:modals.createProject.restored")}{" "}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={startOver}
            >
              {t("common:modals.createProject.startOver")}
            </Button>
          </p>
        ) : null}
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => closeRef.current()}
            className="min-h-11 sm:min-h-0"
          >
            {t("common:actions.cancel")}
          </Button>
          {state.step === "choose" ? (
            <Button
              type="button"
              onClick={() => continueWith()}
              disabled={catalog.isLoading && state.source.kind === "template"}
              className="min-h-11 sm:min-h-0"
            >
              {primaryLabel}
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          ) : (
            <>
              <Button
                type="button"
                onClick={() => void handleSubmit()}
                loading={isPending}
                className="min-h-11 sm:min-h-0"
              >
                {t("common:modals.createProject.setup.create")}
              </Button>
              <span
                aria-hidden
                className={cn("hidden items-center gap-0.5 sm:flex")}
              >
                <Kbd>{isMac() ? "⌘" : "Ctrl"}</Kbd>
                <Kbd>↵</Kbd>
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function isMac() {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  );
}

function ChoiceSummary({
  statuses,
  sampleTaskCount,
}: {
  statuses: number | null;
  sampleTaskCount: number;
}) {
  const { t } = useTranslation();
  return (
    <ul className="space-y-0.5 text-muted-foreground text-xs">
      {statuses !== null && (
        <li>
          {t("common:modals.createProject.setup.statusCount", {
            count: statuses,
          })}
        </li>
      )}
      {sampleTaskCount > 0 && (
        <li>
          {t("common:modals.createProject.setup.exampleCount", {
            count: sampleTaskCount,
          })}
        </li>
      )}
    </ul>
  );
}

function FailureAlert({
  failure,
  onRetry,
  onBackToTemplates,
  onClose,
}: {
  failure: CreateFailure;
  onRetry: () => void;
  onBackToTemplates: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const message =
    failure.kind === "template"
      ? t("common:modals.createProject.error.template")
      : failure.kind === "forbidden"
        ? t("common:modals.createProject.error.forbidden")
        : t("common:modals.createProject.error.generic");
  return (
    <Alert variant="error">
      <CircleAlert aria-hidden />
      <AlertDescription className="text-foreground">{message}</AlertDescription>
      <AlertAction>
        {failure.kind === "template" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onBackToTemplates}
          >
            {t("common:modals.createProject.error.backToTemplates")}
          </Button>
        ) : failure.kind === "forbidden" ? (
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            {t("common:actions.close")}
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            {t("common:modals.createProject.tryAgain")}
          </Button>
        )}
      </AlertAction>
    </Alert>
  );
}

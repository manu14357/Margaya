import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  CircleCheck,
  Lock,
  Mail,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ProjectTile } from "@/components/context-panel/panel-primitives";
import {
  buildCreateRequest,
  type CreateSource,
  effectiveForm,
  flowReducer,
  initialFlowState,
  type SetupErrors,
  suggestionFor,
  validateSetup,
} from "@/components/create-project/create-flow-model";
import { ProjectSetupFields } from "@/components/create-project/project-setup-fields";
import {
  type StepDirection,
  StepTransition,
} from "@/components/create-project/step-transition";
import {
  CompactTemplatePicker,
  TemplateGallery,
} from "@/components/create-project/template-gallery";
import {
  type CreateFailure,
  useSubmitProject,
} from "@/components/create-project/use-submit-project";
import { IntentChips } from "@/components/create-workspace/intent-chips";
import { PendingInvitationList } from "@/components/invitation/pending-invitation-list";
import PageTitle from "@/components/page-title";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import InvitationLinkField from "@/components/team/invitation-link-field";
import InviteFailureList from "@/components/team/invite-failure-list";
import InviteRoleSelect from "@/components/team/invite-role-select";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useApplyWorkspaceStarter } from "@/hooks/mutations/project-template/use-apply-workspace-starter";
import useInviteWorkspaceUser from "@/hooks/mutations/workspace-user/use-invite-workspace-user";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import { usePendingInvitations } from "@/hooks/queries/invitation/use-pending-invitations";
import {
  useProjectTemplate,
  useProjectTemplates,
  useWorkspaceStarters,
} from "@/hooks/queries/project-template/use-project-templates";
import useCreateWorkspace from "@/hooks/queries/workspace/use-create-workspace";
import useGrantableRoles from "@/hooks/queries/workspace/use-grantable-roles";
import { useLocale } from "@/hooks/use-locale";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import {
  writeFirstSteps,
  writeWorkspaceIntent,
} from "@/lib/create-flow-storage";
import { defaultInviteRole } from "@/lib/grantable-roles";
import {
  type InviteFailure,
  MAX_INVITES_PER_SUBMIT,
  parseEmailList,
  sendInvitesInSequence,
} from "@/lib/invite-emails";
import {
  BLANK_TEMPLATE_ID,
  GUIDED_TOUR_TEMPLATE_ID,
} from "@/lib/project-template-gallery";
import { AuthDivider } from "../auth/divider";
import { SetupHeading, SetupLayout } from "./setup-layout";

type OnboardingStep = "workspace" | "project" | "invite" | "done";

const NUMBERED_STEPS: OnboardingStep[] = ["workspace", "project", "invite"];
const MAX_WORKSPACE_NAME = 80;

type CreatedWorkspace = { id: string; name: string };
type CreatedProject = {
  id: string;
  name: string;
  exampleCount: number;
  /** More than one when a starter set created several. */
  projectCount: number;
  blank: boolean;
};

const STEP_NAME_KEYS = {
  workspace: "auth:onboarding.stepNames.workspace",
  project: "auth:onboarding.stepNames.project",
  invite: "auth:onboarding.stepNames.invite",
  done: "auth:onboarding.stepNames.done",
} as const;

/** Focus the step's heading once it has settled. */
function useStepHeading() {
  const ref = useRef<HTMLHeadingElement>(null);
  const focus = useCallback(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return { ref, focus };
}

/**
 * First run: name the workspace (or join one), start the first project from
 * the template gallery, invite people, then "You're all set" and the board.
 * Only the workspace name is required; Back shows what was already created
 * instead of creating it twice.
 */
export function OnboardingFlow() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState<OnboardingStep>("workspace");
  const [direction, setDirection] = useState<StepDirection>("forward");
  const [workspace, setWorkspace] = useState<CreatedWorkspace | null>(null);
  const [intent, setIntent] = useState<string | null>(null);
  const [project, setProject] = useState<CreatedProject | null>(null);
  const [invitedCount, setInvitedCount] = useState(0);
  const [liveMessage, setLiveMessage] = useState("");
  const heading = useStepHeading();
  const announce = useCallback((message: string) => {
    setLiveMessage("");
    window.setTimeout(() => setLiveMessage(message), 30);
  }, []);

  const go = (next: OnboardingStep, way: StepDirection = "forward") => {
    setDirection(way);
    setStep(next);
  };

  // Fallback focus when the transition never reports its end.
  const firstStep = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per step change
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    const id = window.setTimeout(heading.focus, 260);
    return () => window.clearTimeout(id);
  }, [step, heading.focus]);

  const finish = () => {
    if (!workspace) return;
    if (project) {
      navigate({
        to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
        params: { workspaceId: workspace.id, projectId: project.id },
        replace: true,
      });
      return;
    }
    navigate({
      to: "/dashboard/workspace/$workspaceId",
      params: { workspaceId: workspace.id },
      replace: true,
    });
  };

  const index = NUMBERED_STEPS.indexOf(step);
  const stepPrefix =
    index === -1
      ? undefined
      : t("auth:onboarding.stepPrefix", {
          current: index + 1,
          total: NUMBERED_STEPS.length,
        });

  return (
    <>
      <PageTitle title={t("auth:onboarding.workspacePageTitle")} />
      <SetupLayout
        progress={
          index === -1
            ? undefined
            : { current: index + 1, total: NUMBERED_STEPS.length }
        }
        stepName={t(STEP_NAME_KEYS[step])}
        width={step === "project" && !project ? "lg" : "md"}
      >
        <div role="status" aria-live="polite" className="sr-only">
          {liveMessage}
        </div>
        <StepTransition
          stepKey={step}
          direction={direction}
          onEntered={heading.focus}
        >
          {step === "workspace" && (
            <WorkspaceStep
              workspace={workspace}
              intent={intent}
              onIntent={setIntent}
              headingRef={heading.ref}
              stepPrefix={stepPrefix}
              announce={announce}
              onCreated={(created) => {
                setWorkspace(created);
                announce(
                  t("auth:onboarding.status.workspaceCreated", {
                    name: created.name,
                  }),
                );
                go("project");
              }}
              onContinue={() => go("project")}
            />
          )}
          {step === "project" && workspace && (
            <FirstProjectStep
              workspaceId={workspace.id}
              intent={intent}
              project={project}
              headingRef={heading.ref}
              stepPrefix={stepPrefix}
              announce={announce}
              onBack={() => go("workspace", "back")}
              onCreated={(created) => {
                setProject(created);
                announce(
                  t("auth:onboarding.status.projectCreated", {
                    name: created.name,
                  }),
                );
                go("invite");
              }}
              onContinue={() => go("invite")}
            />
          )}
          {step === "invite" && workspace && (
            <InviteStep
              workspaceId={workspace.id}
              personal={intent === "personal"}
              headingRef={heading.ref}
              stepPrefix={stepPrefix}
              onInvited={(count) => setInvitedCount((value) => value + count)}
              invitedCount={invitedCount}
              onBack={() => go("project", "back")}
              onContinue={() => go("done")}
            />
          )}
          {step === "done" && workspace && (
            <DoneStep
              workspace={workspace}
              project={project}
              invitedCount={invitedCount}
              headingRef={heading.ref}
              onOpen={finish}
            />
          )}
        </StepTransition>
      </SetupLayout>
    </>
  );
}

function StepFooter({
  onBack,
  children,
}: {
  onBack?: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 pt-2">
      {onBack ? (
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          aria-label={t("auth:onboarding.back")}
          className="min-h-11 shrink-0 sm:min-h-0"
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">{t("auth:onboarding.back")}</span>
        </Button>
      ) : (
        <span />
      )}
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {children}
      </div>
    </div>
  );
}

/** What an earlier step already created, shown when the user goes back. */
export function CreatedSummary({
  label,
  name,
}: {
  label: string;
  name: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 font-heading text-sm font-semibold text-foreground"
      >
        {name.trim().charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <CircleCheck className="size-3.5 text-success-foreground" />
          {label}
        </p>
      </div>
    </div>
  );
}

function WorkspaceStep({
  workspace,
  intent,
  onIntent,
  headingRef,
  stepPrefix,
  announce,
  onCreated,
  onContinue,
}: {
  workspace: CreatedWorkspace | null;
  intent: string | null;
  onIntent: (intent: string | null) => void;
  headingRef: React.Ref<HTMLHeadingElement>;
  stepPrefix?: string;
  announce: (message: string) => void;
  onCreated: (workspace: CreatedWorkspace) => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: session } = authClient.useSession();
  const { data: config } = useGetConfig();
  const { mutateAsync: createWorkspace, isPending } = useCreateWorkspace();
  const invitations = usePendingInvitations();
  const pending = invitations.data ?? [];
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showDescription, setShowDescription] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [failed, setFailed] = useState(false);
  const id = useId();
  const creationAllowed =
    session?.user?.role === "admin" || !config?.disableWorkspaceCreation;

  const trimmed = name.trim();
  const nameError = !attempted
    ? null
    : !trimmed
      ? t("auth:onboarding.validation.workspaceNameRequired")
      : trimmed.length > MAX_WORKSPACE_NAME
        ? t("auth:onboarding.validation.workspaceNameTooLong")
        : null;

  if (workspace) {
    return (
      <div className="space-y-6">
        <SetupHeading
          title={t("auth:onboarding.createWorkspaceTitle")}
          description={t("auth:onboarding.createWorkspaceSubtitle")}
          headingRef={headingRef}
          stepPrefix={stepPrefix}
        />
        <CreatedSummary
          name={workspace.name}
          label={t("auth:onboarding.workspaceCreatedTitle")}
        />
        <StepFooter>
          <Button type="button" onClick={onContinue}>
            {t("auth:onboarding.continue")}
            <ArrowRight className="size-4" />
          </Button>
        </StepFooter>
      </div>
    );
  }

  if (!creationAllowed && pending.length === 0 && config) {
    return (
      <div className="space-y-6">
        <EmptyState
          icon={<Mail />}
          title={t("auth:onboarding.waiting.title")}
          description={t("auth:onboarding.waiting.body")}
          action={
            <Button
              type="button"
              loading={invitations.isFetching}
              onClick={() => void invitations.refetch()}
            >
              {t("auth:onboarding.waiting.checkAgain")}
            </Button>
          }
        />
      </div>
    );
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!trimmed || trimmed.length > MAX_WORKSPACE_NAME) return;
    setFailed(false);
    announce(t("auth:onboarding.status.creatingWorkspace"));
    try {
      const created = await createWorkspace({
        name: trimmed,
        description: description.trim() || "",
        userId: user?.id,
      });
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      await authClient.organization.setActive({ organizationId: created.id });
      // Only orders the gallery's recommendations; never sent to the server.
      writeWorkspaceIntent(created.id, intent);
      onCreated({ id: created.id, name: trimmed });
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="space-y-6">
      {pending.length > 0 ? (
        <section className="space-y-3">
          <SetupHeading
            title={t("auth:onboarding.joinTitle")}
            description={t("auth:onboarding.joinDescription")}
          />
          <PendingInvitationList invitations={pending} />
          {creationAllowed && <AuthDivider />}
        </section>
      ) : null}

      {creationAllowed && (
        <>
          <SetupHeading
            title={t("auth:onboarding.nameWorkspaceTitle")}
            description={t("auth:onboarding.nameWorkspaceSubtitle")}
            headingRef={pending.length === 0 ? headingRef : undefined}
            stepPrefix={stepPrefix}
          />
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-name`}>
                {t("auth:onboarding.workspaceName")}
              </Label>
              <Input
                id={`${id}-name`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("auth:onboarding.workspaceNamePlaceholder")}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? `${id}-name-error` : undefined}
                autoFocus={pending.length === 0}
                disabled={isPending}
                autoComplete="organization"
                className="text-base sm:text-sm"
              />
              {nameError && (
                <p
                  id={`${id}-name-error`}
                  className="text-destructive-foreground text-xs"
                >
                  {nameError}
                </p>
              )}
              {showDescription ? (
                <div className="space-y-1.5 pt-2">
                  <Label
                    htmlFor={`${id}-description`}
                    className="text-muted-foreground"
                  >
                    {t("auth:onboarding.descriptionOptional")}
                  </Label>
                  <Input
                    id={`${id}-description`}
                    value={description}
                    maxLength={280}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder={t("auth:onboarding.descriptionPlaceholder")}
                    disabled={isPending}
                    className="text-base sm:text-sm"
                  />
                </div>
              ) : (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto min-h-11 px-0 sm:min-h-0"
                  onClick={() => setShowDescription(true)}
                >
                  {t("auth:onboarding.addDescription")}
                </Button>
              )}
            </div>

            <IntentChips
              value={intent}
              onChange={onIntent}
              disabled={isPending}
            />

            {failed && (
              <Alert variant="error">
                <CircleAlert aria-hidden />
                <AlertDescription className="text-foreground">
                  {t("auth:onboarding.errors.workspace")}
                </AlertDescription>
                <AlertAction>
                  <Button type="submit" size="sm" variant="outline">
                    {t("auth:onboarding.tryAgain")}
                  </Button>
                </AlertAction>
              </Alert>
            )}

            <StepFooter>
              <Button type="submit" loading={isPending}>
                {isPending
                  ? t("auth:onboarding.creating")
                  : t("auth:onboarding.createWorkspace")}
                <ArrowRight className="size-4" />
              </Button>
            </StepFooter>
          </form>
        </>
      )}
    </div>
  );
}

function FirstProjectStep({
  workspaceId,
  intent,
  project,
  headingRef,
  stepPrefix,
  announce,
  onBack,
  onCreated,
  onContinue,
}: {
  workspaceId: string;
  intent: string | null;
  project: CreatedProject | null;
  headingRef: React.Ref<HTMLHeadingElement>;
  stepPrefix?: string;
  announce: (message: string) => void;
  onBack: () => void;
  onCreated: (project: CreatedProject) => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const id = useId();
  const catalog = useProjectTemplates();
  const templates = catalog.data?.templates ?? [];
  const categories = catalog.data?.categories ?? [];
  const [state, dispatch] = useReducer(flowReducer, undefined, () =>
    initialFlowState({ step: "setup" }),
  );
  const [browsing, setBrowsing] = useState(false);
  const [browseCategory, setBrowseCategory] = useState("recommended");
  const [browseQuery, setBrowseQuery] = useState("");
  const [starterId, setStarterId] = useState<string | null>(null);
  const [starterExamples, setStarterExamples] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyConflict, setKeyConflict] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<CreateFailure | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const { submit, isPending } = useSubmitProject(workspaceId);
  const applyStarter = useApplyWorkspaceStarter();
  const starters = useWorkspaceStarters();

  const previewId =
    state.source.kind === "template"
      ? state.source.id
      : templates.some((template) => template.id === BLANK_TEMPLATE_ID)
        ? BLANK_TEMPLATE_ID
        : null;
  const preview = useProjectTemplate(previewId);
  const suggestion = suggestionFor({
    source: state.source,
    templates,
    preview: preview.data,
    projects: [],
  });
  // The onboarding creator owns the workspace and can remove examples later.
  const sampleData = state.form.sampleData ?? true;
  const values = effectiveForm(state.form, suggestion);
  const errors: SetupErrors = attempted
    ? validateSetup(values.name, values.key)
    : {};
  const guidedTour = templates.some(
    (template) => template.id === GUIDED_TOUR_TEMPLATE_ID,
  );
  const selectedStarter = starters.data?.find(
    (starter) => starter.id === starterId,
  );

  if (project) {
    return (
      <div className="space-y-6">
        <SetupHeading
          title={t("auth:onboarding.projectTitle")}
          description={t("auth:onboarding.firstProjectSubtitle")}
          headingRef={headingRef}
          stepPrefix={stepPrefix}
        />
        <CreatedSummary
          name={project.name}
          label={
            project.exampleCount > 0
              ? t("auth:onboarding.projectCreatedWithExamples", {
                  count: project.exampleCount,
                })
              : t("auth:onboarding.projectCreated")
          }
        />
        <StepFooter onBack={onBack}>
          <Button type="button" onClick={onContinue}>
            {t("auth:onboarding.continue")}
            <ArrowRight className="size-4" />
          </Button>
        </StepFooter>
      </div>
    );
  }

  const select = (source: CreateSource) => {
    setStarterId(null);
    setFailure(null);
    dispatch({ type: "select", source });
  };

  const createProject = async () => {
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
        canCopyOpenTasks: false,
      }),
      {
        categoryId: intent,
        templateId: state.source.kind === "template" ? state.source.id : null,
      },
    );
    if (!outcome.ok) {
      if (outcome.failure.kind === "conflict") {
        setKeyConflict(outcome.failure.key);
        setKeyOpen(true);
        window.setTimeout(() => keyRef.current?.focus(), 0);
      } else {
        if (outcome.failure.kind === "template") select({ kind: "blank" });
        setFailure(outcome.failure);
      }
      return;
    }
    onCreated({
      id: outcome.project.id,
      name: outcome.project.name,
      exampleCount: outcome.sampleTaskCount,
      projectCount: 1,
      blank: state.source.kind === "blank",
    });
  };

  const createStarter = async () => {
    if (!selectedStarter) return;
    setFailure(null);
    announce(t("auth:onboarding.status.creatingStarter"));
    try {
      const result = await applyStarter.mutateAsync({
        workspaceId,
        starterId: selectedStarter.id,
        sampleData: starterExamples,
        locale,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      for (const created of result.projects) {
        const count = created.template?.sampleTaskCount ?? 0;
        writeFirstSteps(created.id, {
          projectName: created.name,
          sampleTaskCount: count,
          appliedByMe: count > 0,
        });
      }
      const first = result.projects[0];
      if (!first) return;
      onCreated({
        id: first.id,
        name: first.name,
        exampleCount: result.projects.reduce(
          (total, created) => total + (created.template?.sampleTaskCount ?? 0),
          0,
        ),
        projectCount: result.projects.length,
        blank: false,
      });
    } catch {
      setFailure({ kind: "generic" });
    }
  };

  const creating = isPending || applyStarter.isPending;

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void (selectedStarter ? createStarter() : createProject());
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          void (selectedStarter ? createStarter() : createProject());
        }
      }}
      inert={creating ? true : undefined}
    >
      <SetupHeading
        title={t("auth:onboarding.projectTitle")}
        description={t("auth:onboarding.firstProjectSubtitle")}
        headingRef={headingRef}
        stepPrefix={stepPrefix}
      />

      <section className="space-y-3">
        <h2
          id={`${id}-picks`}
          className="font-medium text-muted-foreground text-xs uppercase tracking-wide"
        >
          {t("auth:onboarding.recommended")}
        </h2>
        {browsing ? (
          <div className="h-[34rem] max-h-[70vh]">
            <TemplateGallery
              templates={templates}
              categories={categories}
              isLoading={catalog.isLoading}
              isError={catalog.isError}
              onRetry={() => void catalog.refetch()}
              projects={[]}
              categoryId={browseCategory}
              onCategory={setBrowseCategory}
              query={browseQuery}
              onQuery={setBrowseQuery}
              source={starterId ? { kind: "project", id: "" } : state.source}
              onSelect={select}
              onActivate={(source) => {
                select(source);
                window.setTimeout(() => nameRef.current?.focus(), 0);
              }}
              onStartBlank={() => select({ kind: "blank" })}
              intent={intent}
            />
          </div>
        ) : (
          <CompactTemplatePicker
            templates={templates}
            categories={categories}
            isLoading={catalog.isLoading}
            intent={intent}
            source={starterId ? { kind: "project", id: "" } : state.source}
            onSelect={select}
            onActivate={(source) => {
              select(source);
              window.setTimeout(() => nameRef.current?.focus(), 0);
            }}
            labelledBy={`${id}-picks`}
          />
        )}
        <div className="flex flex-wrap items-center gap-x-4">
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto min-h-11 px-0 sm:min-h-0"
            onClick={() => setBrowsing((value) => !value)}
            aria-expanded={browsing}
          >
            {browsing
              ? t("auth:onboarding.showRecommended")
              : t("auth:onboarding.browseAll")}
          </Button>
          {guidedTour && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto min-h-11 px-0 text-muted-foreground sm:min-h-0"
              onClick={() =>
                select({ kind: "template", id: GUIDED_TOUR_TEMPLATE_ID })
              }
            >
              {t("auth:onboarding.guidedTour")}
            </Button>
          )}
        </div>
      </section>

      {(starters.data?.length ?? 0) > 0 && (
        <StarterRow
          starters={starters.data ?? []}
          starterId={starterId}
          onChoose={(next) => {
            setStarterId(next);
            setFailure(null);
          }}
          examples={starterExamples}
          onExamples={setStarterExamples}
        />
      )}

      {!selectedStarter && (
        <section
          aria-label={t("auth:onboarding.setUpPanel")}
          className="space-y-4 rounded-xl border border-border bg-card p-4"
        >
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
            capabilities={{
              canCreateTasks: true,
              canCreateLabels: true,
              aiAvailable: false,
            }}
            errors={errors}
            keyConflict={keyConflict}
            nameRef={nameRef}
            keyRef={keyRef}
            keyOpen={keyOpen}
            onKeyOpen={(next) => {
              setKeyOpen(next);
              if (next) window.setTimeout(() => keyRef.current?.focus(), 0);
            }}
            compact
            disabled={creating}
          />
        </section>
      )}

      {failure && (
        <Alert variant="error">
          <CircleAlert aria-hidden />
          <AlertDescription className="text-foreground">
            {failure.kind === "template"
              ? t("auth:onboarding.errors.template")
              : t("common:modals.createProject.error.generic")}
          </AlertDescription>
          <AlertAction>
            <Button type="submit" size="sm" variant="outline">
              {t("auth:onboarding.tryAgain")}
            </Button>
          </AlertAction>
        </Alert>
      )}

      <StepFooter onBack={onBack}>
        <Button type="button" variant="ghost" onClick={onContinue}>
          {t("auth:onboarding.skip")}
        </Button>
        <Button type="submit" loading={creating}>
          {creating
            ? t("auth:onboarding.creatingProject")
            : selectedStarter
              ? t("auth:onboarding.createProjects", {
                  count: selectedStarter.projects.length,
                })
              : t("auth:onboarding.createProject")}
          <ArrowRight className="size-4" />
        </Button>
      </StepFooter>
    </form>
  );
}

type Starter = NonNullable<
  ReturnType<typeof useWorkspaceStarters>["data"]
>[number];

/** "Start with a set": starters create several projects in one step. */
function StarterRow({
  starters,
  starterId,
  onChoose,
  examples,
  onExamples,
}: {
  starters: Starter[];
  starterId: string | null;
  onChoose: (id: string | null) => void;
  examples: boolean;
  onExamples: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const chosen = starters.find((starter) => starter.id === starterId);
  return (
    <section className="space-y-3">
      <div>
        <h2
          id={`${id}-title`}
          className="font-medium text-muted-foreground text-xs uppercase tracking-wide"
        >
          {t("auth:onboarding.starters.title")}
        </h2>
        <p className="text-muted-foreground text-xs">
          {t("auth:onboarding.starters.hint")}
        </p>
      </div>
      <fieldset
        aria-labelledby={`${id}-title`}
        className="m-0 flex min-w-0 gap-2 overflow-x-auto border-0 p-0 pb-1"
      >
        {starters.map((starter) => {
          const pressed = starter.id === starterId;
          return (
            <button
              key={starter.id}
              type="button"
              aria-pressed={pressed}
              onClick={() => onChoose(pressed ? null : starter.id)}
              className={cn(
                "flex min-h-11 w-52 shrink-0 flex-col items-start gap-0.5 rounded-lg border border-border bg-card p-3 text-start outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
                pressed && "border-primary ring-1 ring-primary",
              )}
            >
              <span className="font-medium text-foreground text-sm">
                {starter.name}
              </span>
              <span className="text-muted-foreground text-xs">
                {t("auth:onboarding.starters.projectCount", {
                  count: starter.projects.length,
                })}
              </span>
            </button>
          );
        })}
      </fieldset>
      {chosen && (
        <div
          aria-live="polite"
          className="space-y-3 rounded-xl border border-border bg-card p-4"
        >
          <p className="text-muted-foreground text-sm">{chosen.description}</p>
          <ul className="space-y-1.5">
            {chosen.projects.map((item) => (
              <li
                key={item.templateId}
                className="flex items-center gap-2 text-sm"
              >
                <ProjectTile
                  icon={item.icon}
                  seed={item.templateId}
                  className="size-5"
                />
                <span className="text-foreground">{item.name}</span>
                <span className="font-mono text-muted-foreground text-xs">
                  {item.key}
                </span>
                {item.visibility === "restricted" && (
                  <span className="flex items-center gap-1 text-muted-foreground text-xs">
                    <Lock className="size-3" aria-hidden />
                    {t("common:modals.createProject.setup.privacyRestricted")}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-start gap-3">
            <Switch
              id={`${id}-examples`}
              checked={examples}
              onCheckedChange={onExamples}
              aria-describedby={`${id}-examples-hint`}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor={`${id}-examples`}>
                {t("common:modals.createProject.setup.examples")}
              </Label>
              <p
                id={`${id}-examples-hint`}
                className="text-muted-foreground text-xs"
              >
                {t("auth:onboarding.starters.examplesHint")}
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function InviteStep({
  workspaceId,
  personal,
  headingRef,
  stepPrefix,
  invitedCount,
  onInvited,
  onBack,
  onContinue,
}: {
  workspaceId: string;
  personal: boolean;
  headingRef: React.Ref<HTMLHeadingElement>;
  stepPrefix?: string;
  invitedCount: number;
  onInvited: (count: number) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  const [emails, setEmails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<InviteFailure[]>([]);
  const [invited, setInvited] = useState<{ id?: string; email: string }[]>([]);
  const [isPending, setIsPending] = useState(false);
  const [pickedRole, setPickedRole] = useState<string>();
  const { mutateAsync: invite } = useInviteWorkspaceUser();
  // The person onboarding just created this workspace, so they own it.
  const { roles } = useGrantableRoles(workspaceId, "owner");
  const role =
    pickedRole && roles.includes(pickedRole)
      ? pickedRole
      : defaultInviteRole(roles);

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    const { valid, invalid } = parseEmailList(emails);
    if (invalid.length > 0 || valid.length === 0) {
      setError(
        invalid.length > 0
          ? t("team:inviteModal.invalidEmails", { emails: invalid.join(", ") })
          : t("auth:onboarding.invalidEmail"),
      );
      return;
    }
    if (valid.length > MAX_INVITES_PER_SUBMIT) {
      setError(
        t("team:inviteModal.tooManyEmails", { max: MAX_INVITES_PER_SUBMIT }),
      );
      return;
    }
    if (!role) return;
    setIsPending(true);
    setError(null);
    setFailures([]);
    const result = await sendInvitesInSequence(
      valid,
      (email) => invite({ email, workspaceId, role }),
      {
        fallbackMessage: t("auth:onboarding.toast.inviteFailed"),
        rateLimitedMessage: t("team:inviteModal.rateLimited"),
      },
    );
    setIsPending(false);
    const fresh = result.sent.filter(
      (entry) => !invited.some((done) => done.email === entry.email),
    );
    setInvited((list) => [...list, ...fresh]);
    onInvited(fresh.length);
    // Keep only what failed in the box so it can be fixed and resent.
    setEmails(result.failed.map((failure) => failure.email).join("\n"));
    setFailures(result.failed);
  };

  return (
    <div className="space-y-6">
      <SetupHeading
        title={t("auth:onboarding.inviteTitle")}
        description={
          personal
            ? t("auth:onboarding.inviteSubtitlePersonal")
            : t("auth:onboarding.inviteSubtitle")
        }
        headingRef={headingRef}
        stepPrefix={stepPrefix}
      />

      <form onSubmit={handleInvite} className="space-y-3" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="onboarding-invite-email">
            {t("auth:onboarding.inviteEmailLabel")}
          </Label>
          <Textarea
            id="onboarding-invite-email"
            value={emails}
            onChange={(event) => {
              setEmails(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              // Enter in an empty box never submits.
              if (event.key === "Enter" && !emails.trim()) {
                event.preventDefault();
              }
            }}
            placeholder={t("auth:onboarding.inviteEmailPlaceholder")}
            aria-invalid={error !== null}
            aria-describedby={
              error ? "onboarding-invite-error" : "onboarding-invite-hint"
            }
            disabled={isPending}
            rows={2}
            autoComplete="off"
          />
          {error ? (
            <p
              id="onboarding-invite-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {error}
            </p>
          ) : (
            <p
              id="onboarding-invite-hint"
              className="text-xs text-muted-foreground"
            >
              {t("team:inviteModal.emailHint")}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="onboarding-invite-role">
              {t("team:inviteModal.roleLabel")}
            </Label>
            <InviteRoleSelect
              id="onboarding-invite-role"
              roles={roles}
              value={role}
              onChange={setPickedRole}
              disabled={isPending}
              className="w-full sm:w-44"
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={isPending || !emails.trim() || !role}
            className="sm:ms-auto"
          >
            {isPending
              ? t("auth:onboarding.inviting")
              : t("auth:onboarding.sendInvite")}
          </Button>
        </div>
        <InviteFailureList failures={failures} />
      </form>

      {invited.length > 0 ? (
        <section className="space-y-2" aria-live="polite">
          <p className="text-xs text-muted-foreground">
            {t("auth:onboarding.inviteLinkHint")}
          </p>
          <ul className="space-y-3">
            {invited.map((entry) => (
              <li key={entry.email} className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-sm text-foreground">
                  <CircleCheck className="size-3.5 text-success-foreground" />
                  {entry.email}
                </p>
                {entry.id ? (
                  <InvitationLinkField invitationId={entry.id} />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <StepFooter onBack={onBack}>
        {invitedCount > 0 ? (
          <Button type="button" onClick={onContinue}>
            {t("auth:onboarding.finish")}
            <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button type="button" variant="ghost" onClick={onContinue}>
            {t("auth:onboarding.skip")}
          </Button>
        )}
      </StepFooter>
    </div>
  );
}

function DoneStep({
  workspace,
  project,
  invitedCount,
  headingRef,
  onOpen,
}: {
  workspace: CreatedWorkspace;
  project: CreatedProject | null;
  invitedCount: number;
  headingRef: React.Ref<HTMLHeadingElement>;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const lines = useMemo(() => {
    const out = [t("auth:onboarding.done.workspace", { name: workspace.name })];
    if (project) {
      out.push(
        project.projectCount > 1
          ? t("auth:onboarding.done.projects", {
              count: project.projectCount,
              name: project.name,
            })
          : project.blank
            ? t("auth:onboarding.done.blankProject", { name: project.name })
            : project.exampleCount > 0
              ? t("auth:onboarding.done.projectWithExamples", {
                  name: project.name,
                  count: project.exampleCount,
                })
              : t("auth:onboarding.done.project", { name: project.name }),
      );
    }
    if (invitedCount > 0) {
      out.push(t("auth:onboarding.done.invited", { count: invitedCount }));
    }
    return out;
  }, [t, workspace.name, project, invitedCount]);

  return (
    <div className="space-y-6">
      <SetupHeading
        title={t("auth:onboarding.done.title")}
        headingRef={headingRef}
      />
      <ul className="space-y-2">
        {lines.map((line, index) => (
          <motion.li
            key={line}
            className="flex items-center gap-2 text-foreground text-sm"
            initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              duration: 0.2,
              delay: reduceMotion ? 0 : index * 0.06,
              ease: [0.23, 1, 0.32, 1],
            }}
          >
            <CircleCheck
              className="size-4 shrink-0 text-success-foreground"
              aria-hidden
            />
            {line}
          </motion.li>
        ))}
      </ul>
      <div className="space-y-2">
        <Button type="button" onClick={onOpen} className="w-full min-h-11">
          {project
            ? t("auth:onboarding.done.open", { name: project.name })
            : t("auth:onboarding.done.goToWorkspace")}
          <ArrowRight className="size-4" />
        </Button>
        {project && (
          <p className="text-center text-muted-foreground text-xs">
            {t("auth:onboarding.done.hint")}
          </p>
        )}
      </div>
    </div>
  );
}

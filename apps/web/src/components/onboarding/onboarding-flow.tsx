import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  Columns3,
  Inbox,
  IterationCw,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import { PendingInvitationList } from "@/components/invitation/pending-invitation-list";
import PageTitle from "@/components/page-title";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import InvitationLinkField from "@/components/team/invitation-link-field";
import InviteFailureList from "@/components/team/invite-failure-list";
import InviteRoleSelect from "@/components/team/invite-role-select";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { UpdateProjectFeaturesRequest } from "@/fetchers/project/update-project-features";
import useCreateProject from "@/hooks/mutations/project/use-create-project";
import useUpdateProjectFeatures from "@/hooks/mutations/project/use-update-project-features";
import useCreateTask from "@/hooks/mutations/task/use-create-task";
import useInviteWorkspaceUser from "@/hooks/mutations/workspace-user/use-invite-workspace-user";
import { usePendingInvitations } from "@/hooks/queries/invitation/use-pending-invitations";
import useCreateWorkspace from "@/hooks/queries/workspace/use-create-workspace";
import useGrantableRoles from "@/hooks/queries/workspace/use-grantable-roles";
import { authClient } from "@/lib/auth-client";
import generateProjectSlug from "@/lib/generate-project-id";
import { defaultInviteRole } from "@/lib/grantable-roles";
import { HttpError } from "@/lib/http-error";
import {
  type InviteFailure,
  MAX_INVITES_PER_SUBMIT,
  parseEmailList,
  sendInvitesInSequence,
} from "@/lib/invite-emails";
import { toast } from "@/lib/toast";
import { AuthDivider } from "../auth/divider";
import { SetupHeading, SetupLayout } from "./setup-layout";

type OnboardingStep = "workspace" | "project" | "invite" | "tasks";

const STEPS: OnboardingStep[] = ["workspace", "project", "invite", "tasks"];

// Every new project starts with the default columns (To Do first).
const FIRST_COLUMN_SLUG = "to-do";

type TemplateId = "board" | "cycles" | "intake";

// A template only turns optional project features on; the columns are the
// same defaults for all of them.
const TEMPLATES: {
  id: TemplateId;
  icon: LucideIcon;
  nameKey: string;
  noteKey: string;
  features?: UpdateProjectFeaturesRequest;
}[] = [
  {
    id: "board",
    icon: Columns3,
    nameKey: "auth:onboarding.templates.board.name",
    noteKey: "auth:onboarding.templates.board.note",
  },
  {
    id: "cycles",
    icon: IterationCw,
    nameKey: "auth:onboarding.templates.cycles.name",
    noteKey: "auth:onboarding.templates.cycles.note",
    features: { cyclesEnabled: true, estimatesEnabled: true },
  },
  {
    id: "intake",
    icon: Inbox,
    nameKey: "auth:onboarding.templates.intake.name",
    noteKey: "auth:onboarding.templates.intake.note",
    features: { intakeEnabled: true },
  },
];

export type WorkspaceFormValues = {
  name: string;
  description?: string;
};

type CreatedWorkspace = { id: string; name: string };
type CreatedProject = { id: string; name: string; slug: string };

function useStepTransition() {
  const reduceMotion = useReducedMotion();
  return {
    variants: {
      initial: { opacity: 0, y: reduceMotion ? 0 : 12 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: reduceMotion ? 0 : -12 },
    },
    initial: "initial",
    animate: "animate",
    exit: "exit",
    transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] },
  } as const;
}

/**
 * First run: workspace (or join one), first project, invite people, first
 * tasks, then the board. Only the names are required; Back always works and
 * shows what was already created instead of creating it twice.
 */
export function OnboardingFlow() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const transition = useStepTransition();
  const [step, setStep] = useState<OnboardingStep>("workspace");
  const [workspace, setWorkspace] = useState<CreatedWorkspace | null>(null);
  const [project, setProject] = useState<CreatedProject | null>(null);

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

  return (
    <>
      <PageTitle title={t("auth:onboarding.workspacePageTitle")} />
      <SetupLayout
        progress={{ current: STEPS.indexOf(step) + 1, total: STEPS.length }}
      >
        <AnimatePresence mode="wait">
          <motion.div key={step} {...transition}>
            {step === "workspace" && (
              <WorkspaceStep
                workspace={workspace}
                onCreated={(created) => {
                  setWorkspace(created);
                  setStep("project");
                }}
                onContinue={() => setStep("project")}
              />
            )}
            {step === "project" && workspace && (
              <ProjectStep
                workspaceId={workspace.id}
                project={project}
                onBack={() => setStep("workspace")}
                onCreated={(created) => {
                  setProject(created);
                  setStep("invite");
                }}
                onContinue={() => setStep("invite")}
              />
            )}
            {step === "invite" && workspace && (
              <InviteStep
                workspaceId={workspace.id}
                onBack={() => setStep("project")}
                onContinue={() => (project ? setStep("tasks") : finish())}
              />
            )}
            {step === "tasks" && project && (
              <TasksStep
                project={project}
                onBack={() => setStep("invite")}
                onFinish={finish}
              />
            )}
          </motion.div>
        </AnimatePresence>
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
          className="shrink-0"
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
function CreatedSummary({ label, name }: { label: string; name: string }) {
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
  onCreated,
  onContinue,
}: {
  workspace: CreatedWorkspace | null;
  onCreated: (workspace: CreatedWorkspace) => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { mutateAsync: createWorkspace, isPending } = useCreateWorkspace();
  const { data: invitations = [] } = usePendingInvitations();

  const workspaceSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, t("auth:onboarding.validation.workspaceNameRequired")),
        description: z.string().optional(),
      }),
    [t],
  );

  const form = useForm<WorkspaceFormValues>({
    resolver: standardSchemaResolver(workspaceSchema),
    defaultValues: { name: "", description: "" },
  });

  const onSubmit = async (data: WorkspaceFormValues) => {
    try {
      const created = await createWorkspace({
        name: data.name.trim(),
        description: data.description?.trim() || "",
        userId: user?.id,
      });

      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      await authClient.organization.setActive({
        organizationId: created.id,
      });
      toast.success(t("auth:onboarding.toast.workspaceCreated"));
      onCreated({ id: created.id, name: data.name.trim() });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("auth:onboarding.toast.createFailed"),
      );
    }
  };

  if (workspace) {
    return (
      <div className="space-y-6">
        <SetupHeading
          title={t("auth:onboarding.createWorkspaceTitle")}
          description={t("auth:onboarding.createWorkspaceSubtitle")}
        />
        <CreatedSummary
          name={workspace.name}
          label={t("auth:onboarding.workspaceCreatedTitle")}
        />
        <StepFooter>
          <Button type="button" onClick={onContinue} autoFocus>
            {t("auth:onboarding.continue")}
            <ArrowRight className="size-4" />
          </Button>
        </StepFooter>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {invitations.length > 0 ? (
        <section className="space-y-3">
          <SetupHeading
            title={t("auth:onboarding.joinTitle")}
            description={t("auth:onboarding.joinDescription")}
          />
          <PendingInvitationList invitations={invitations} />
          <AuthDivider />
        </section>
      ) : null}

      <SetupHeading
        title={t("auth:onboarding.createWorkspaceTitle")}
        description={t("auth:onboarding.createWorkspaceSubtitle")}
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium">
                  {t("auth:onboarding.workspaceName")}
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder={t("auth:onboarding.workspaceNamePlaceholder")}
                    autoFocus={invitations.length === 0}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium text-muted-foreground">
                  {t("auth:onboarding.descriptionOptional")}
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder={t("auth:onboarding.descriptionPlaceholder")}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <StepFooter>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? t("auth:onboarding.creating")
                : t("auth:onboarding.createWorkspace")}
              <ArrowRight className="size-4" />
            </Button>
          </StepFooter>
        </form>
      </Form>
    </div>
  );
}

function ProjectStep({
  workspaceId,
  project,
  onBack,
  onCreated,
  onContinue,
}: {
  workspaceId: string;
  project: CreatedProject | null;
  onBack: () => void;
  onCreated: (project: CreatedProject) => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [template, setTemplate] = useState<TemplateId>("board");
  const [keyConflict, setKeyConflict] = useState<string | null>(null);
  const { mutateAsync: createProject, isPending } = useCreateProject({
    name: name.trim(),
    slug: slug.trim().toUpperCase(),
    workspaceId,
    icon: "Layout",
  });
  const { mutateAsync: updateFeatures } = useUpdateProjectFeatures();

  if (project) {
    return (
      <div className="space-y-6">
        <SetupHeading
          title={t("auth:onboarding.projectTitle")}
          description={t("auth:onboarding.projectSubtitle")}
        />
        <CreatedSummary
          name={project.name}
          label={t("auth:onboarding.projectCreated")}
        />
        <StepFooter onBack={onBack}>
          <Button type="button" onClick={onContinue} autoFocus>
            {t("auth:onboarding.continue")}
            <ArrowRight className="size-4" />
          </Button>
        </StepFooter>
      </div>
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !slug.trim()) return;

    let created: Awaited<ReturnType<typeof createProject>>;
    try {
      created = await createProject();
    } catch (error) {
      // Keys are unique per workspace; say so next to the field.
      if (error instanceof HttpError && error.status === 409) {
        setKeyConflict(slug.trim().toUpperCase());
        return;
      }
      toast.error(
        error instanceof Error
          ? error.message
          : t("auth:onboarding.toast.projectFailed"),
      );
      return;
    }

    const features = TEMPLATES.find(
      (option) => option.id === template,
    )?.features;
    if (features) {
      try {
        await updateFeatures({
          projectId: created.id,
          workspaceId,
          features,
        });
      } catch {
        // The project exists either way; features can be turned on later.
        toast.error(t("auth:onboarding.toast.templateFailed"));
      }
    }

    await queryClient.invalidateQueries({ queryKey: ["projects"] });
    onCreated({ id: created.id, name: created.name, slug: created.slug });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <SetupHeading
        title={t("auth:onboarding.projectTitle")}
        description={t("auth:onboarding.projectSubtitle")}
      />

      <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
        <div className="space-y-2">
          <Label htmlFor="onboarding-project-name">
            {t("auth:onboarding.projectName")}
          </Label>
          <Input
            id="onboarding-project-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setSlug(generateProjectSlug(event.target.value));
              setKeyConflict(null);
            }}
            placeholder={t("auth:onboarding.projectNamePlaceholder")}
            autoFocus
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="onboarding-project-key">
            {t("auth:onboarding.projectKey")}
          </Label>
          <Input
            id="onboarding-project-key"
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value.toUpperCase());
              setKeyConflict(null);
            }}
            maxLength={8}
            aria-invalid={keyConflict !== null}
            aria-describedby="onboarding-project-key-hint"
            className="font-mono uppercase"
            required
          />
        </div>
        <p
          id="onboarding-project-key-hint"
          role={keyConflict ? "alert" : undefined}
          className={
            keyConflict
              ? "col-span-2 text-xs text-destructive"
              : "col-span-2 text-xs text-muted-foreground"
          }
        >
          {keyConflict
            ? t("common:modals.createProject.keyTaken", { key: keyConflict })
            : t("auth:onboarding.projectKeyHint", {
                example: slug.trim().toUpperCase() || "WEB",
              })}
        </p>
      </div>

      <div className="space-y-2">
        <Label id="onboarding-template-label">
          {t("auth:onboarding.templateLabel")}
        </Label>
        <RadioGroup
          aria-labelledby="onboarding-template-label"
          value={template}
          onValueChange={(value) => setTemplate(value as TemplateId)}
          className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
          {TEMPLATES.map((option) => {
            const Icon = option.icon;
            return (
              // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's Radio renders its own input inside the label, which labels it
              <label
                key={option.id}
                className="relative flex cursor-pointer gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/50 has-data-checked:border-primary has-data-checked:ring-1 has-data-checked:ring-primary sm:flex-col sm:gap-1.5"
              >
                <Radio value={option.id} className="absolute top-3 right-3" />
                <Icon
                  className="size-5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0 pr-6 sm:pr-0">
                  <span className="block text-sm font-medium text-foreground">
                    {t(option.nameKey)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(option.noteKey)}
                  </span>
                </span>
              </label>
            );
          })}
        </RadioGroup>
      </div>

      <StepFooter onBack={onBack}>
        <Button type="button" variant="ghost" onClick={onContinue}>
          {t("auth:onboarding.skip")}
        </Button>
        <Button
          type="submit"
          disabled={isPending || !name.trim() || !slug.trim()}
        >
          {isPending
            ? t("auth:onboarding.creating")
            : t("auth:onboarding.createProject")}
          <ArrowRight className="size-4" />
        </Button>
      </StepFooter>
    </form>
  );
}

function InviteStep({
  workspaceId,
  onBack,
  onContinue,
}: {
  workspaceId: string;
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
    setInvited((list) => [
      ...list,
      ...result.sent.filter(
        (entry) => !list.some((done) => done.email === entry.email),
      ),
    ]);
    // Keep only what failed in the box so it can be fixed and resent.
    setEmails(result.failed.map((failure) => failure.email).join("\n"));
    setFailures(result.failed);
  };

  return (
    <div className="space-y-6">
      <SetupHeading
        title={t("auth:onboarding.inviteTitle")}
        description={t("auth:onboarding.inviteSubtitle")}
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
            placeholder={t("auth:onboarding.inviteEmailPlaceholder")}
            aria-invalid={error !== null}
            aria-describedby={
              error ? "onboarding-invite-error" : "onboarding-invite-hint"
            }
            disabled={isPending}
            rows={2}
            autoComplete="off"
            autoFocus
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
        {invited.length > 0 ? (
          <Button type="button" onClick={onContinue}>
            {t("auth:onboarding.continue")}
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

function TasksStep({
  project,
  onBack,
  onFinish,
}: {
  project: CreatedProject;
  onBack: () => void;
  onFinish: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [created, setCreated] = useState<
    { id: string; title: string; number: number | null }[]
  >([]);
  const { mutateAsync: createTask, isPending } = useCreateTask();

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    try {
      const task = await createTask({
        title: value,
        description: "",
        projectId: project.id,
        status: FIRST_COLUMN_SLUG,
        priority: "no-priority",
      });
      setCreated((list) => [
        ...list,
        { id: task.id, title: value, number: task.number },
      ]);
      setTitle("");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("auth:onboarding.toast.taskFailed"),
      );
    }
  };

  return (
    <div className="space-y-6">
      <SetupHeading
        title={t("auth:onboarding.tasksTitle")}
        description={t("auth:onboarding.tasksSubtitle", {
          project: project.name,
        })}
      />

      <form onSubmit={handleAdd} className="space-y-2">
        <Label htmlFor="onboarding-task-title">
          {t("auth:onboarding.taskLabel")}
        </Label>
        <div className="flex gap-2">
          <Input
            id="onboarding-task-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("auth:onboarding.taskPlaceholder")}
            autoComplete="off"
            autoFocus
          />
          <Button
            type="submit"
            variant="outline"
            disabled={isPending || !title.trim()}
            className="shrink-0"
          >
            {t("auth:onboarding.addTask")}
          </Button>
        </div>
      </form>

      {created.length > 0 ? (
        <ul
          className="divide-y divide-border rounded-lg border border-border bg-card"
          aria-live="polite"
        >
          {created.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-2.5 px-3 py-2 text-sm"
            >
              {task.number !== null ? (
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {project.slug}-{task.number}
                </span>
              ) : (
                <CircleCheck className="size-3.5 text-success-foreground" />
              )}
              <span className="min-w-0 truncate text-foreground">
                {task.title}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <StepFooter onBack={onBack}>
        <Button type="button" onClick={onFinish}>
          {t("auth:onboarding.openBoard")}
          <ArrowRight className="size-4" />
        </Button>
      </StepFooter>
    </div>
  );
}

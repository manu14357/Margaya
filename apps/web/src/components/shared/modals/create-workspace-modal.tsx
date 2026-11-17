import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import {
  ChevronRight,
  CircleAlert,
  LayoutTemplate,
  UserPlus,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IntentChips } from "@/components/create-workspace/intent-chips";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import CreateProjectModal from "@/components/shared/modals/create-project-modal";
import InviteTeamMemberModal from "@/components/team/invite-team-member-modal";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import useCreateWorkspace from "@/hooks/queries/workspace/use-create-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { authClient } from "@/lib/auth-client";
import {
  clearWorkspaceDraft,
  readWorkspaceDraft,
  writeWorkspaceDraft,
  writeWorkspaceIntent,
} from "@/lib/create-flow-storage";
import { toast } from "@/lib/toast";

type CreateWorkspaceModalProps = {
  open: boolean;
  onClose: () => void;
  /**
   * The instance admin's page creates workspaces for others: just the form,
   * without the intent question or the "ready" step.
   */
  simple?: boolean;
};

const MAX_NAME = 80;

const bigInput =
  "w-full [&_[data-slot=input]]:h-auto [&_[data-slot=input]]:px-0 [&_[data-slot=input]]:py-2 [&_[data-slot=input]]:text-2xl [&_[data-slot=input]]:leading-tight [&_[data-slot=input]]:font-semibold [&_[data-slot=input]]:tracking-tight [&_[data-slot=input]]:text-foreground [&_[data-slot=input]]:placeholder:text-muted-foreground [&_[data-slot=input]]:outline-none";

/**
 * "Add another workspace": name it (plus the optional "What will you track
 * first?"), then "{{name}} is ready" with Start a project / Invite people.
 * Cancel keeps a draft for 30 minutes.
 */
function CreateWorkspaceModal({
  open,
  onClose,
  simple = false,
}: CreateWorkspaceModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const id = useId();
  const reduceMotion = useReducedMotion();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showDescription, setShowDescription] = useState(false);
  const [intent, setIntent] = useState<string | null>(null);
  const [intentOpen, setIntentOpen] = useState(false);
  const [restored, setRestored] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [next, setNext] = useState<"project" | "invite" | null>(null);
  // The intent outlives the form's reset, for the project gallery after it.
  const [handoffIntent, setHandoffIntent] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const readyHeadingRef = useRef<HTMLHeadingElement>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { mutateAsync, isPending } = useCreateWorkspace();
  const { canCreateProjects, canInviteUsers } = useWorkspacePermission();

  // Opening restores a fresh draft.
  useEffect(() => {
    if (!open || simple || !userId) return;
    const draft = readWorkspaceDraft(userId);
    if (draft && (draft.name || draft.description || draft.intent)) {
      setName(draft.name);
      setDescription(draft.description);
      setShowDescription(Boolean(draft.description));
      setIntent(draft.intent);
      setIntentOpen(Boolean(draft.intent));
      setRestored(true);
    }
  }, [open, simple, userId]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      if (created) readyHeadingRef.current?.focus();
      else inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [open, created]);

  const reset = () => {
    setName("");
    setDescription("");
    setShowDescription(false);
    setIntent(null);
    setIntentOpen(false);
    setRestored(false);
    setAttempted(false);
    setFailed(false);
    setCreated(null);
  };

  const handleClose = () => {
    if (
      !created &&
      !simple &&
      userId &&
      (name.trim() || description.trim() || intent)
    ) {
      writeWorkspaceDraft(userId, { name, description, intent });
    }
    if (created && userId) clearWorkspaceDraft(userId);
    reset();
    onClose();
  };

  const trimmed = name.trim();
  const nameError = !attempted
    ? null
    : !trimmed
      ? t("auth:onboarding.validation.workspaceNameRequired")
      : trimmed.length > MAX_NAME
        ? t("auth:onboarding.validation.workspaceNameTooLong")
        : null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!trimmed || trimmed.length > MAX_NAME) return;
    setFailed(false);
    try {
      const workspace = await mutateAsync({
        name: trimmed,
        description: description.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      await authClient.organization.setActive({ organizationId: workspace.id });
      writeWorkspaceIntent(workspace.id, intent);
      if (userId) clearWorkspaceDraft(userId);
      // The page behind the dialog already shows the new workspace.
      navigate({
        to: "/dashboard/workspace/$workspaceId",
        params: { workspaceId: workspace.id },
      });
      if (simple) {
        toast.success(t("common:modals.createWorkspace.successToast"));
        reset();
        onClose();
        return;
      }
      setCreated({ id: workspace.id, name: trimmed });
    } catch {
      setFailed(true);
    }
  };

  const choose = (action: "project" | "invite") => {
    setHandoffIntent(intent);
    setNext(action);
    reset();
    onClose();
  };

  const contentMotion = {
    initial: { opacity: 0, scale: reduceMotion ? 1 : 0.98 },
    animate: { opacity: 1, scale: 1 },
    transition: {
      duration: reduceMotion ? 0.15 : 0.2,
      ease: [0.23, 1, 0.32, 1],
    },
  } as const;

  return (
    <>
      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
        <DialogContent className="max-w-md" showCloseButton={false}>
          {created ? (
            <motion.div key="ready" {...contentMotion}>
              <DialogHeader>
                <DialogTitle
                  ref={readyHeadingRef}
                  tabIndex={-1}
                  className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("common:modals.createWorkspace.ready.title", {
                    name: created.name,
                  })}
                </DialogTitle>
                <DialogDescription>
                  {t("common:modals.createWorkspace.ready.body")}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 px-6 pb-2">
                {canCreateProjects() && (
                  <ReadyCard
                    icon={<LayoutTemplate className="size-5" aria-hidden />}
                    title={t("common:modals.createWorkspace.ready.project")}
                    note={t("common:modals.createWorkspace.ready.projectNote")}
                    onClick={() => choose("project")}
                  />
                )}
                {canInviteUsers() && (
                  <ReadyCard
                    icon={<UserPlus className="size-5" aria-hidden />}
                    title={t("common:modals.createWorkspace.ready.invite")}
                    note={t("common:modals.createWorkspace.ready.inviteNote")}
                    onClick={() => choose("invite")}
                  />
                )}
              </div>
              <DialogFooter variant="bare">
                <Button type="button" variant="ghost" onClick={handleClose}>
                  {t("common:modals.createWorkspace.ready.goToWorkspace")}
                </Button>
              </DialogFooter>
            </motion.div>
          ) : (
            <motion.div key="form" {...contentMotion} initial={false}>
              <DialogHeader>
                {/* The breadcrumb is a named nav, so it can't double as the title. */}
                <DialogTitle className="sr-only">
                  {t("common:modals.createWorkspace.title")}
                </DialogTitle>
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem className="text-muted-foreground font-semibold tracking-wider text-sm">
                      {t("common:modals.createWorkspace.breadcrumbMargaya")}
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem className="text-foreground font-medium text-sm">
                      {t("common:modals.createWorkspace.title")}
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
                <DialogDescription className="sr-only">
                  {t("common:modals.createWorkspace.description")}
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleSubmit} className="space-y-6" noValidate>
                <div className="space-y-3 px-6">
                  {restored && (
                    <p className="text-muted-foreground text-xs">
                      {t("common:modals.createWorkspace.restored")}{" "}
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto px-0"
                        onClick={() => {
                          if (userId) clearWorkspaceDraft(userId);
                          reset();
                        }}
                      >
                        {t("common:modals.createProject.startOver")}
                      </Button>
                    </p>
                  )}
                  <Input
                    ref={inputRef}
                    unstyled
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t(
                      "common:modals.createWorkspace.namePlaceholder",
                    )}
                    aria-label={t("auth:onboarding.workspaceName")}
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={nameError ? `${id}-error` : undefined}
                    disabled={isPending}
                    className={bigInput}
                  />
                  {nameError && (
                    <p
                      id={`${id}-error`}
                      className="text-destructive-foreground text-xs"
                    >
                      {nameError}
                    </p>
                  )}
                  {showDescription ? (
                    <Input
                      unstyled
                      value={description}
                      maxLength={280}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder={t(
                        "common:modals.createWorkspace.descriptionPlaceholder",
                      )}
                      aria-label={t("auth:onboarding.descriptionOptional")}
                      disabled={isPending}
                      className="w-full [&_[data-slot=input]]:h-auto [&_[data-slot=input]]:px-0 [&_[data-slot=input]]:py-2 [&_[data-slot=input]]:text-base [&_[data-slot=input]]:text-foreground [&_[data-slot=input]]:placeholder:text-muted-foreground [&_[data-slot=input]]:outline-none"
                    />
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
                  {!simple && (
                    <Collapsible open={intentOpen} onOpenChange={setIntentOpen}>
                      <CollapsibleTrigger className="flex min-h-11 items-center gap-1 rounded-md text-muted-foreground text-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 [&[data-panel-open]>svg]:rotate-90">
                        <ChevronRight
                          className="size-4 transition-transform duration-150"
                          aria-hidden
                        />
                        {t("auth:onboarding.intent.legend")}
                      </CollapsibleTrigger>
                      <CollapsiblePanel>
                        <div className="pt-2">
                          <IntentChips
                            value={intent}
                            onChange={setIntent}
                            disabled={isPending}
                            visuallyHiddenLegend
                          />
                        </div>
                      </CollapsiblePanel>
                    </Collapsible>
                  )}
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
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    onClick={handleClose}
                    variant="outline"
                    size="sm"
                  >
                    {t("common:actions.cancel")}
                  </Button>
                  <Button type="submit" size="sm" loading={isPending}>
                    {t("common:modals.createWorkspace.createButton")}
                  </Button>
                </DialogFooter>
              </form>
            </motion.div>
          )}
        </DialogContent>
      </Dialog>
      <CreateProjectModal
        open={next === "project"}
        onClose={() => setNext(null)}
        intent={handoffIntent}
      />
      <InviteTeamMemberModal
        open={next === "invite"}
        onClose={() => setNext(null)}
      />
    </>
  );
}

function ReadyCard({
  icon,
  title,
  note,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  note: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-start outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] motion-reduce:active:scale-100"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-medium text-foreground text-sm">
          {title}
        </span>
        <span className="block text-muted-foreground text-xs">{note}</span>
      </span>
    </button>
  );
}

export default CreateWorkspaceModal;

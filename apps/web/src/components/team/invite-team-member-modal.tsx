import { useState } from "react";
import { useTranslation } from "react-i18next";
import useInviteWorkspaceUser from "@/hooks/mutations/workspace-user/use-invite-workspace-user";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import useGrantableRoles from "@/hooks/queries/workspace/use-grantable-roles";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { defaultInviteRole } from "@/lib/grantable-roles";
import {
  InvitationProjectsError,
  type InviteFailure,
  MAX_INVITES_PER_SUBMIT,
  parseEmailList,
  sendInvitesInSequence,
} from "@/lib/invite-emails";
import { toast } from "@/lib/toast";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import InvitationLinkField from "./invitation-link-field";
import InviteFailureList from "./invite-failure-list";
import InviteGuestProjects, {
  type GuestProject,
} from "./invite-guest-projects";
import InviteRoleSelect from "./invite-role-select";

type Props = {
  open: boolean;
  onClose: () => void;
};

type SentInvitation = { id?: string; email: string };

function InviteTeamMemberModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { mutateAsync } = useInviteWorkspaceUser();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { canInviteUsers, role: myRole } = useWorkspacePermission();
  const canInvite = canInviteUsers();
  const { roles } = useGrantableRoles(workspaceId, myRole);

  const [emails, setEmails] = useState("");
  const [pickedRole, setPickedRole] = useState<string>();
  const [guestProjects, setGuestProjects] = useState<GuestProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<InviteFailure[]>([]);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [created, setCreated] = useState<SentInvitation[] | null>(null);

  const role =
    pickedRole && roles.includes(pickedRole)
      ? pickedRole
      : defaultInviteRole(roles);
  const sending = progress !== null;

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!workspaceId || !canInvite || !role) {
      // Defense-in-depth: parent gates the trigger, but if the modal is
      // somehow open without permission we refuse rather than firing a
      // mutation the server will reject.
      toast.error(t("team:inviteModal.error"));
      return;
    }

    const { valid, invalid } = parseEmailList(emails);
    if (invalid.length > 0) {
      setError(
        t("team:inviteModal.invalidEmails", { emails: invalid.join(", ") }),
      );
      return;
    }
    if (valid.length === 0) {
      setError(t("team:inviteModal.emailRequired"));
      return;
    }
    if (valid.length > MAX_INVITES_PER_SUBMIT) {
      setError(
        t("team:inviteModal.tooManyEmails", { max: MAX_INVITES_PER_SUBMIT }),
      );
      return;
    }

    setError(null);
    setFailures([]);
    const result = await sendInvitesInSequence(
      valid,
      (email) =>
        mutateAsync({
          email,
          workspaceId,
          role,
          // A guest reaches nothing else, so they start with their projects.
          projects: role === "guest" ? guestProjects : undefined,
        }).catch((error) => {
          throw error instanceof InvitationProjectsError
            ? new Error(
                t("team:inviteModal.guestProjectsFailed", {
                  message: error.message,
                }),
              )
            : error;
        }),
      {
        onProgress: (done, total) => setProgress({ done, total }),
        fallbackMessage: t("team:inviteModal.error"),
        rateLimitedMessage: t("team:inviteModal.rateLimited"),
      },
    );
    setProgress(null);

    if (result.failed.length === 0) {
      toast.success(t("team:inviteModal.success"));
      setEmails("");
      // The link is the only delivery channel when SMTP is unconfigured, so
      // the modal stays open on the links instead of closing. If the API
      // ever stops returning ids, fall back to closing on success.
      if (result.sent.some((entry) => entry.id)) {
        setCreated(result.sent);
        return;
      }
      resetAndCloseModal();
      return;
    }

    // Keep only what failed in the box so the person can fix and resend.
    setEmails(result.failed.map((failure) => failure.email).join("\n"));
    setFailures(result.failed);
    if (result.sent.length > 0) {
      toast.success(
        t("team:inviteModal.sentSome", {
          sent: result.sent.length,
          total: valid.length,
        }),
      );
    } else {
      toast.error(t("team:inviteModal.error"));
    }
  };

  const resetAndCloseModal = () => {
    if (sending) return;
    setCreated(null);
    setEmails("");
    setError(null);
    setFailures([]);
    setGuestProjects([]);
    onClose();
  };

  const createdWithLinks = created?.filter((entry) => entry.id) ?? [];

  return (
    <Dialog open={open} onOpenChange={resetAndCloseModal}>
      <DialogPopup className="w-full max-w-md">
        <DialogHeader>
          <DialogTitle>
            {created
              ? t("team:inviteModal.createdTitle")
              : t("team:inviteModal.title")}
          </DialogTitle>
        </DialogHeader>

        {created ? (
          <>
            <DialogPanel className="space-y-3">
              {createdWithLinks.length === 1 ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t("team:inviteModal.shareLinkDescription", {
                      email: createdWithLinks[0]?.email ?? "",
                    })}
                  </p>
                  <InvitationLinkField
                    invitationId={createdWithLinks[0]?.id ?? ""}
                  />
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t("team:inviteModal.shareLinksDescription")}
                  </p>
                  <ul className="space-y-3">
                    {createdWithLinks.map((entry) => (
                      <li key={entry.email} className="space-y-1.5">
                        <p className="break-all text-sm text-foreground">
                          {entry.email}
                        </p>
                        <InvitationLinkField invitationId={entry.id ?? ""} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </DialogPanel>
            <DialogFooter>
              <Button size="sm" onClick={resetAndCloseModal}>
                {t("team:inviteModal.done")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit} className="contents" noValidate>
            <DialogPanel className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="invite-emails">
                  {t("team:inviteModal.emailLabel")}
                </Label>
                <Textarea
                  id="invite-emails"
                  value={emails}
                  onChange={(event) => {
                    setEmails(event.target.value);
                    setError(null);
                  }}
                  placeholder={t("team:inviteModal.emailPlaceholder")}
                  aria-invalid={error !== null}
                  aria-describedby={
                    error ? "invite-emails-error" : "invite-emails-hint"
                  }
                  disabled={sending}
                  rows={3}
                  autoComplete="off"
                  autoFocus
                />
                {error ? (
                  <p
                    id="invite-emails-error"
                    role="alert"
                    className="text-xs text-destructive"
                  >
                    {error}
                  </p>
                ) : (
                  <p
                    id="invite-emails-hint"
                    className="text-xs text-muted-foreground"
                  >
                    {t("team:inviteModal.emailHint")}
                  </p>
                )}
              </div>

              {/* A grid stacks the label over the select, as for Email. */}
              <div className="grid gap-1.5">
                <Label htmlFor="invite-role">
                  {t("team:inviteModal.roleLabel")}
                </Label>
                <InviteRoleSelect
                  id="invite-role"
                  roles={roles}
                  value={role}
                  onChange={setPickedRole}
                  disabled={sending}
                  className="w-full sm:w-48"
                  aria-describedby="invite-role-hint"
                />
                <p
                  id="invite-role-hint"
                  className="text-xs text-muted-foreground"
                >
                  {role === "guest"
                    ? t("team:inviteModal.guestRoleHint")
                    : t("team:inviteModal.roleHint")}
                </p>
              </div>

              {role === "guest" && workspaceId && (
                <InviteGuestProjects
                  workspaceId={workspaceId}
                  value={guestProjects}
                  onChange={setGuestProjects}
                  disabled={sending}
                />
              )}

              <InviteFailureList failures={failures} />
            </DialogPanel>

            <DialogFooter>
              <DialogClose
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={sending}
                  />
                }
              >
                {t("common:actions.cancel")}
              </DialogClose>
              <Button
                type="submit"
                size="sm"
                disabled={
                  !workspaceId ||
                  !canInvite ||
                  !role ||
                  sending ||
                  !emails.trim()
                }
              >
                {progress
                  ? t("team:inviteModal.sending", {
                      current: Math.min(progress.done + 1, progress.total),
                      total: progress.total,
                    })
                  : t("team:inviteModal.sendInvitation")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogPopup>
    </Dialog>
  );
}

export default InviteTeamMemberModal;

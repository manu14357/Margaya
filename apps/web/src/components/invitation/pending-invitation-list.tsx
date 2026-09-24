import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, Loader2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { getPendingInvitations } from "@/fetchers/invitation/get-pending-invitations";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";
import { toast } from "@/lib/toast";

type PendingInvitation = Awaited<
  ReturnType<typeof getPendingInvitations>
>[number];

const DAY_MS = 1000 * 60 * 60 * 24;

function expiryTone(expiresAt: string) {
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / DAY_MS);
  if (days <= 1) return "destructive" as const;
  if (days <= 3) return "secondary" as const;
  return null;
}

/**
 * Pending workspace invitations for the signed-in user, with accept and
 * decline. Accepting makes the workspace active and opens it.
 */
export function PendingInvitationList({
  invitations,
}: {
  invitations: PendingInvitation[];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const handleAccept = async (invitationId: string, workspaceId: string) => {
    setAcceptingId(invitationId);
    try {
      const { data, error } = await authClient.organization.acceptInvitation({
        invitationId,
      });

      if (error) {
        toast.error(error.message || t("invitations:toast.acceptError"));
        return;
      }

      const organizationId = data?.invitation.organizationId || workspaceId;
      await authClient.organization.setActive({ organizationId });
      toast.success(t("invitations:toast.acceptSuccess"));
      await queryClient.invalidateQueries({
        queryKey: ["invitations", "pending"],
      });
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });

      navigate({
        to: "/dashboard/workspace/$workspaceId",
        params: { workspaceId: organizationId },
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("invitations:toast.acceptError"),
      );
    } finally {
      setAcceptingId(null);
    }
  };

  const handleReject = async (invitationId: string) => {
    setRejectingId(invitationId);
    try {
      const { error } = await authClient.organization.rejectInvitation({
        invitationId,
      });

      if (error) {
        toast.error(error.message || t("invitations:toast.rejectError"));
        return;
      }

      toast.success(t("invitations:toast.rejectSuccess"));
      await queryClient.invalidateQueries({
        queryKey: ["invitations", "pending"],
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("invitations:toast.rejectError"),
      );
    } finally {
      setRejectingId(null);
    }
  };

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
      {invitations.map((invitation) => {
        const tone = expiryTone(invitation.expiresAt);
        const expires = formatDateMedium(invitation.expiresAt);
        const isAccepting = acceptingId === invitation.id;
        const isRejecting = rejectingId === invitation.id;
        const isProcessing = isAccepting || isRejecting;

        return (
          <li
            key={invitation.id}
            className={cn(
              "flex flex-wrap items-center gap-3 px-3 py-2.5 sm:flex-nowrap",
              tone === "destructive" && "bg-destructive/4",
            )}
          >
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 font-heading text-sm font-semibold text-foreground"
            >
              {invitation.workspaceName.trim().charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {invitation.workspaceName}
              </p>
              <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                <span className="truncate">
                  {t("invitations:list.invitedBy", {
                    name: invitation.inviterName,
                  })}
                </span>
                <span aria-hidden>·</span>
                {tone ? (
                  <Badge variant={tone} className="text-xs font-normal">
                    {t("invitations:list.expires", { date: expires })}
                  </Badge>
                ) : (
                  <span>
                    {t("invitations:list.expires", { date: expires })}
                  </span>
                )}
              </p>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleReject(invitation.id)}
                disabled={isProcessing}
                aria-label={t("invitations:actions.reject", {
                  workspace: invitation.workspaceName,
                })}
              >
                {isRejecting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <X className="size-3.5" />
                )}
                {t("invitations:list.decline")}
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  handleAccept(invitation.id, invitation.workspaceId)
                }
                disabled={isProcessing}
                aria-label={t("invitations:actions.accept", {
                  workspace: invitation.workspaceName,
                })}
              >
                {isAccepting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                {t("invitations:list.accept")}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

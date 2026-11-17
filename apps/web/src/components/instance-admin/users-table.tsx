import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsTable,
  SettingsTableBody,
  SettingsTableCell,
  SettingsTableHead,
  SettingsTableHeader,
  SettingsTableMeta,
  SettingsTableRow,
} from "@/components/settings/settings-table";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CompactDate } from "@/components/ui/compact-date";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { MiddleTruncate } from "@/components/ui/truncated-text";
import {
  useAddInstanceAdmin,
  useInstanceUserAction,
  useRemoveInstanceAdmin,
} from "@/hooks/mutations/instance-admin/use-instance-admin-mutations";
import {
  instanceAdminKeys,
  useInstanceUsers,
} from "@/hooks/queries/instance-admin/use-instance-admin";
import { formatRelativeTime } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { toast } from "@/lib/toast";
import type { InstanceUser, InstanceUserStatus } from "@/types/instance-admin";
import { InstanceLoadState } from "./instance-page";
import { BanUserDialog, ResetPasswordDialog } from "./user-action-dialogs";
import { UserDetailSheet } from "./user-detail-sheet";

type UsersTableProps = { q: string; status: InstanceUserStatus };

type Pending = {
  kind: "ban" | "reset" | "resetTwoFactor" | "signOut" | "details";
  user: InstanceUser;
} | null;

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Every account on the instance with ban, reset, sign-out and admin actions. */
export function UsersTable({ q, status }: UsersTableProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useInstanceUsers(q, status);
  const action = useInstanceUserAction();
  const addAdmin = useAddInstanceAdmin();
  const removeAdmin = useRemoveInstanceAdmin();
  const [pending, setPending] = useState<Pending>(null);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  const refreshUsers = () =>
    void queryClient.invalidateQueries({ queryKey: instanceAdminKeys.users() });

  const run = async (work: () => Promise<unknown>, success: string) => {
    try {
      await work();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(errorText(error, t("instanceAdmin:saveError")));
      return false;
    }
  };

  const unban = (user: InstanceUser) =>
    run(
      () => action.mutateAsync({ type: "unban", userId: user.id }),
      t("accountSecurity:platform.users.unbanned", { name: user.name }),
    );

  const toggleAdmin = async (user: InstanceUser) => {
    const done = await run(
      () =>
        user.isAdmin
          ? removeAdmin.mutateAsync(user.id)
          : addAdmin.mutateAsync(user.email),
      user.isAdmin
        ? t("accountSecurity:platform.users.demoted", { name: user.name })
        : t("accountSecurity:platform.users.promoted", { name: user.name }),
    );
    if (done) refreshUsers();
  };

  if (!query.data) {
    return (
      <InstanceLoadState
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
      />
    );
  }

  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        {q.trim()
          ? t("accountSecurity:platform.users.empty", { query: q.trim() })
          : t("accountSecurity:platform.users.none")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <SettingsTable>
        <SettingsTableHeader>
          <SettingsTableRow>
            <SettingsTableHead>
              {t("accountSecurity:platform.users.columnUser")}
            </SettingsTableHead>
            <SettingsTableHead className="w-44">
              {t("accountSecurity:platform.users.columnStatus")}
            </SettingsTableHead>
            <SettingsTableHead className="w-28" align="end" hideBelow="md">
              {t("accountSecurity:platform.users.columnWorkspaces")}
            </SettingsTableHead>
            <SettingsTableHead className="w-32" hideBelow="md">
              {t("accountSecurity:platform.users.columnLastActive")}
            </SettingsTableHead>
            <SettingsTableHead className="w-28" hideBelow="md">
              {t("accountSecurity:platform.users.columnJoined")}
            </SettingsTableHead>
            <SettingsTableHead className="w-14">
              <span className="sr-only">
                {t("accountSecurity:platform.users.columnActions")}
              </span>
            </SettingsTableHead>
          </SettingsTableRow>
        </SettingsTableHeader>
        <SettingsTableBody>
          {items.map((user) => (
            <SettingsTableRow key={user.id}>
              <SettingsTableCell kind="primary">
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-2 rounded text-left focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => setPending({ kind: "details", user })}
                >
                  <Avatar className="size-7 shrink-0">
                    <AvatarImage src={user.image ?? ""} alt="" />
                    <AvatarFallback className="text-[10px]">
                      {getInitials(user.name, "U")}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-sm">
                      {user.name}
                    </span>
                    <MiddleTruncate
                      text={user.email}
                      className="text-muted-foreground text-xs"
                    />
                  </span>
                </button>
                <SettingsTableMeta hideAbove="md" className="ps-9">
                  <span>
                    {t("accountSecurity:platform.users.columnWorkspaces")}{" "}
                    {user.workspaceCount}
                  </span>
                  <span>
                    {user.lastActiveAt
                      ? formatRelativeTime(new Date(user.lastActiveAt))
                      : t("accountSecurity:platform.users.never")}
                  </span>
                </SettingsTableMeta>
              </SettingsTableCell>
              <SettingsTableCell
                label={t("accountSecurity:platform.users.columnStatus")}
              >
                <div className="flex flex-wrap gap-1">
                  {!user.isAdmin && !user.banned && !user.twoFactorEnabled && (
                    <span className="text-muted-foreground">—</span>
                  )}
                  {user.isAdmin && (
                    <Badge variant="outline">
                      {t("accountSecurity:platform.users.badgeAdmin")}
                    </Badge>
                  )}
                  {user.banned && (
                    <Badge variant="error">
                      {t("accountSecurity:platform.users.badgeBanned")}
                    </Badge>
                  )}
                  {user.twoFactorEnabled && (
                    <Badge variant="secondary">
                      {t("accountSecurity:platform.users.badgeTwoFactor")}
                    </Badge>
                  )}
                </div>
              </SettingsTableCell>
              <SettingsTableCell align="end" hideBelow="md">
                {user.workspaceCount}
              </SettingsTableCell>
              <SettingsTableCell
                hideBelow="md"
                className="text-muted-foreground"
              >
                {user.lastActiveAt ? (
                  <CompactDate value={user.lastActiveAt} />
                ) : (
                  t("accountSecurity:platform.users.never")
                )}
              </SettingsTableCell>
              <SettingsTableCell
                hideBelow="md"
                className="text-muted-foreground"
              >
                <CompactDate value={user.createdAt} />
              </SettingsTableCell>
              <SettingsTableCell kind="actions">
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={t(
                          "accountSecurity:platform.users.actionsFor",
                          { name: user.name },
                        )}
                      />
                    }
                  >
                    <MoreHorizontal className="size-4" />
                  </MenuTrigger>
                  <MenuPopup align="end" className="w-52">
                    <MenuItem
                      onClick={() => setPending({ kind: "details", user })}
                    >
                      {t("accountSecurity:platform.users.details")}
                    </MenuItem>
                    <MenuItem
                      onClick={() => setPending({ kind: "reset", user })}
                    >
                      {t("accountSecurity:platform.users.resetPassword")}
                    </MenuItem>
                    {user.twoFactorEnabled && (
                      <MenuItem
                        onClick={() =>
                          setPending({ kind: "resetTwoFactor", user })
                        }
                      >
                        {t("accountSecurity:platform.users.resetTwoFactor")}
                      </MenuItem>
                    )}
                    <MenuItem
                      onClick={() => setPending({ kind: "signOut", user })}
                    >
                      {t("accountSecurity:platform.users.signOut")}
                    </MenuItem>
                    <MenuItem onClick={() => void toggleAdmin(user)}>
                      {user.isAdmin
                        ? t("accountSecurity:platform.users.removeAdmin")
                        : t("accountSecurity:platform.users.makeAdmin")}
                    </MenuItem>
                    <MenuSeparator />
                    {user.banned ? (
                      <MenuItem onClick={() => void unban(user)}>
                        {t("accountSecurity:platform.users.unban")}
                      </MenuItem>
                    ) : (
                      <MenuItem
                        variant="destructive"
                        onClick={() => setPending({ kind: "ban", user })}
                      >
                        {t("accountSecurity:platform.users.ban")}
                      </MenuItem>
                    )}
                  </MenuPopup>
                </Menu>
              </SettingsTableCell>
            </SettingsTableRow>
          ))}
        </SettingsTableBody>
      </SettingsTable>
      {query.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t("accountSecurity:platform.loadMore")}
        </Button>
      )}

      {pending?.kind === "details" && (
        <UserDetailSheet user={pending.user} onClose={() => setPending(null)} />
      )}
      {pending?.kind === "ban" && (
        <BanUserDialog
          user={pending.user}
          onClose={() => setPending(null)}
          onConfirm={(reason, expiresInDays) =>
            run(
              () =>
                action.mutateAsync({
                  type: "ban",
                  userId: pending.user.id,
                  reason,
                  expiresInDays,
                }),
              t("accountSecurity:platform.users.banned", {
                name: pending.user.name,
              }),
            )
          }
        />
      )}
      {pending?.kind === "reset" && (
        <ResetPasswordDialog
          user={pending.user}
          onClose={() => setPending(null)}
          onConfirm={(password) =>
            run(
              () =>
                action.mutateAsync({
                  type: "resetPassword",
                  userId: pending.user.id,
                  password,
                }),
              password
                ? t("accountSecurity:platform.users.passwordSet", {
                    name: pending.user.name,
                  })
                : t("accountSecurity:platform.users.resetSent", {
                    email: pending.user.email,
                  }),
            )
          }
        />
      )}
      <AlertDialog
        open={pending?.kind === "signOut"}
        onOpenChange={(open) => !open && setPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("accountSecurity:platform.users.signOutTitle", {
                name: pending?.user.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("accountSecurity:platform.users.signOutDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button
              loading={action.isPending}
              onClick={async () => {
                if (!pending) return;
                const done = await run(
                  () =>
                    action.mutateAsync({
                      type: "revokeSessions",
                      userId: pending.user.id,
                    }),
                  t("accountSecurity:platform.users.signedOut", {
                    name: pending.user.name,
                  }),
                );
                if (done) setPending(null);
              }}
            >
              {t("accountSecurity:platform.users.signOut")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={pending?.kind === "resetTwoFactor"}
        onOpenChange={(open) => !open && setPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("accountSecurity:platform.users.resetTwoFactorTitle", {
                name: pending?.user.name ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("accountSecurity:platform.users.resetTwoFactorDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button
              loading={action.isPending}
              onClick={async () => {
                if (!pending) return;
                const done = await run(
                  () =>
                    action.mutateAsync({
                      type: "resetTwoFactor",
                      userId: pending.user.id,
                    }),
                  t("accountSecurity:platform.users.twoFactorReset", {
                    name: pending.user.name,
                  }),
                );
                if (done) setPending(null);
              }}
            >
              {t("accountSecurity:platform.users.resetTwoFactor")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

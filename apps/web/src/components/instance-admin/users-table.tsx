import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useAddInstanceAdmin,
  useInstanceUserAction,
  useRemoveInstanceAdmin,
} from "@/hooks/mutations/instance-admin/use-instance-admin-mutations";
import {
  instanceAdminKeys,
  useInstanceUsers,
} from "@/hooks/queries/instance-admin/use-instance-admin";
import { formatDateMedium, formatRelativeTime } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { toast } from "@/lib/toast";
import type { InstanceUser, InstanceUserStatus } from "@/types/instance-admin";
import { InstanceLoadState } from "./instance-page";
import { BanUserDialog, ResetPasswordDialog } from "./user-action-dialogs";
import { UserDetailSheet } from "./user-detail-sheet";

type UsersTableProps = { q: string; status: InstanceUserStatus };

type Pending = {
  kind: "ban" | "reset" | "signOut" | "details";
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
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                {t("accountSecurity:platform.users.columnUser")}
              </TableHead>
              <TableHead>
                {t("accountSecurity:platform.users.columnStatus")}
              </TableHead>
              <TableHead className="text-right">
                {t("accountSecurity:platform.users.columnWorkspaces")}
              </TableHead>
              <TableHead>
                {t("accountSecurity:platform.users.columnLastActive")}
              </TableHead>
              <TableHead>
                {t("accountSecurity:platform.users.columnJoined")}
              </TableHead>
              <TableHead className="w-0">
                <span className="sr-only">
                  {t("accountSecurity:platform.users.columnActions")}
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-2 rounded text-left focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={() => setPending({ kind: "details", user })}
                  >
                    <Avatar className="size-7">
                      <AvatarImage src={user.image ?? ""} alt="" />
                      <AvatarFallback className="text-[10px]">
                        {getInitials(user.name, "U")}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {user.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {user.email}
                      </span>
                    </span>
                  </button>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
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
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {user.workspaceCount}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {user.lastActiveAt
                    ? formatRelativeTime(new Date(user.lastActiveAt))
                    : t("accountSecurity:platform.users.never")}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateMedium(user.createdAt)}
                </TableCell>
                <TableCell>
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
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
    </div>
  );
}

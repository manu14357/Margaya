import { useTranslation } from "react-i18next";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetTitle,
} from "@/components/ui/sheet";
import { useInstanceUser } from "@/hooks/queries/instance-admin/use-instance-admin";
import { formatDateMedium } from "@/lib/format";
import type { InstanceUser } from "@/types/instance-admin";
import { InstanceLoadState } from "./instance-page";

/** One account's workspaces (with its role), sessions and sign-in setup. */
export function UserDetailSheet({
  user,
  onClose,
}: {
  user: InstanceUser;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const detail = useInstanceUser(user.id);

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{user.name}</SheetTitle>
          <SheetDescription>{user.email}</SheetDescription>
        </SheetHeader>
        <SheetPanel className="space-y-5">
          {detail.data ? (
            <>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("accountSecurity:platform.users.activeSessions")}
                  </dt>
                  <dd className="tabular-nums">{detail.data.activeSessions}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("accountSecurity:platform.users.signInMethod")}
                  </dt>
                  <dd>
                    {detail.data.hasPassword
                      ? t("accountSecurity:platform.users.hasPassword")
                      : t("accountSecurity:platform.users.noPassword")}
                  </dd>
                </div>
                {user.banned && user.banReason && (
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">
                      {t("accountSecurity:platform.users.banReason")}
                    </dt>
                    <dd>{user.banReason}</dd>
                  </div>
                )}
              </dl>
              <section className="space-y-2">
                <h3 className="text-sm font-medium">
                  {t("accountSecurity:platform.users.workspacesTitle")}
                </h3>
                {detail.data.workspaces.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("accountSecurity:platform.users.noWorkspaces")}
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {detail.data.workspaces.map((workspace) => (
                      <li
                        key={workspace.id}
                        className="flex items-center justify-between gap-3 px-3 py-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm">
                            {workspace.name}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {t("accountSecurity:platform.users.joined", {
                              date: formatDateMedium(workspace.joinedAt),
                            })}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {workspace.role}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : (
            <InstanceLoadState
              isLoading={detail.isLoading}
              isError={detail.isError}
              onRetry={() => void detail.refetch()}
              rows={3}
            />
          )}
        </SheetPanel>
      </SheetContent>
    </Sheet>
  );
}

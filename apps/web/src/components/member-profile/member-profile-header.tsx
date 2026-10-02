import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { WorkspaceMemberProfile } from "@/fetchers/workspace-user/get-workspace-member";
import { formatDateMedium } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";

/** Built-in roles have labels; a custom role shows its own name. */
export function memberRoleLabel(t: TFunction, role: string): string {
  switch (role) {
    case "owner":
      return t("team:roles.owner");
    case "admin":
      return t("team:roles.admin");
    case "member":
      return t("team:roles.member");
    case "viewer":
      return t("team:roles.viewer");
    default:
      return role;
  }
}

type MemberProfileHeaderProps = {
  workspaceId: string;
  member: WorkspaceMemberProfile | undefined;
  isLoading: boolean;
  isSelf: boolean;
};

/** Avatar, name, email, role and when they joined. */
export default function MemberProfileHeader({
  workspaceId,
  member,
  isLoading,
  isSelf,
}: MemberProfileHeaderProps) {
  const { t } = useTranslation();

  if (isLoading || !member) {
    return (
      <div className="flex items-center gap-3">
        <Skeleton className="size-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Avatar className="size-12">
        <AvatarImage src={member.image ?? ""} alt="" />
        <AvatarFallback className="text-base">
          {getInitials(member.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate font-semibold text-lg leading-7">
            {member.name}
          </h2>
          <Badge variant="outline">{memberRoleLabel(t, member.role)}</Badge>
          {isSelf && (
            <Link
              to="/dashboard/workspace/$workspaceId/my-work"
              params={{ workspaceId }}
              className="text-muted-foreground text-xs hover:text-foreground hover:underline"
            >
              {t("team:profile.openYourWork")}
            </Link>
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 text-muted-foreground text-xs">
          <span className="truncate">{member.email}</span>
          <span>
            {t("team:profile.joined", {
              date: formatDateMedium(member.joinedAt),
            })}
          </span>
        </div>
      </div>
    </div>
  );
}

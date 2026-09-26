import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/preview-card";
import { getInitials } from "@/lib/get-initials";
import { type AssigneeEntry, assigneeDisplayName } from "@/lib/task-assignees";

type AssigneeProfileHoverCardProps = {
  workspaceId: string;
  assignees: readonly AssigneeEntry[];
  children: ReactNode;
};

/**
 * Hovering a task's assignee faces lists the people with a link to each
 * current member's profile. The trigger is a plain span, so it can sit
 * inside the button that edits the assignees.
 */
export default function AssigneeProfileHoverCard({
  workspaceId,
  assignees,
  children,
}: AssigneeProfileHoverCardProps) {
  const { t } = useTranslation();
  if (assignees.length === 0) return <>{children}</>;

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger render={<span className="inline-flex shrink-0" />}>
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        className="w-64 p-1.5"
        side="bottom"
        onClick={(event) => event.stopPropagation()}
      >
        <ul
          className="flex w-full flex-col gap-0.5"
          aria-label={t("tasks:assignees.label")}
        >
          {assignees.map((person) => {
            const name = assigneeDisplayName(person, t);
            const linkable = !person.isFormerMember && !person.isUnknown;
            return (
              <li
                key={person.id}
                className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1"
              >
                <Avatar className="size-6 shrink-0">
                  <AvatarImage src={person.image ?? ""} alt="" />
                  <AvatarFallback className="border border-border/30 font-medium text-xs">
                    {getInitials(person.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {linkable && (
                  <Link
                    to="/dashboard/workspace/$workspaceId/profile/$userId"
                    params={{ workspaceId, userId: person.id }}
                    className="shrink-0 text-muted-foreground text-xs hover:text-foreground hover:underline"
                    aria-label={t("team:profile.viewProfileOf", { name })}
                  >
                    {t("team:profile.viewProfile")}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
}

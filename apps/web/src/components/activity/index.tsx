import {
  Archive,
  ArchiveRestore,
  Bot,
  Boxes,
  Calendar,
  CircleAlert,
  History,
  IterationCw,
  MessageSquare,
  Ruler,
  Trash2,
  UserRound,
} from "lucide-react";
import type { ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";
import { AgentBadge } from "@/components/ai/agents/agent-badge";
import { AiContentLabel } from "@/components/ai/ai-content-label";
import EstimateActivityText from "@/components/estimate/estimate-activity-text";
import {
  getIntakeActivityIcon,
  INTAKE_SNOOZE_ENDED,
  intakeActivityText,
  isIntakeActivity,
} from "@/components/intake/intake-activity-text";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import useGetWorkspaceUsers from "@/hooks/queries/workspace-users/use-get-workspace-users";
import { agentViaOf } from "@/lib/ai/agents";
import { provenanceOf } from "@/lib/ai/provenance";
import { cn } from "@/lib/cn";
import { formatDateMedium, formatRelativeTime } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { getPriorityLabel, getStatusLabel } from "@/lib/i18n/domain";
import type { PublicAuthorKind } from "@/types/publication";
import type { ReactionGroup } from "@/types/reaction";
import type { CommentPublicBoard } from "../publication/comment-public-actions";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../ui/preview-card";
import { TimelineContent, TimelineItem } from "../ui/timeline";
import { automationActivityText, automationOf } from "./automation-activity";
import CommentCard from "./comment-card";
import CommentThread, { useReplyComposer } from "./comment-thread";
import {
  getTaskDetailActivityIcon,
  renderTaskDetailActivity,
} from "./task-detail-activity";
import { isCommentActivity } from "./utils";

type ActivityItem = {
  type: string;
  content: string | null;
  eventData?: unknown;
  id: string;
  createdAt: string;
  /** Comments: a later edit shows an "(edited)" marker. */
  updatedAt?: string;
  userId: string | null;
  taskId: string;
  externalUserName?: string | null;
  externalUserAvatar?: string | null;
  externalSource?: string | null;
  externalUrl?: string | null;
  /** Comments only: public comments also show on the public board. */
  visibility?: "internal" | "public";
  /** Replies only: the top-level comment of their thread. */
  parentId?: string | null;
  /** Comments only: set when AI wrote the text (AI-generated label). */
  aiProvenance?: unknown;
};

/** A comment author as the comment list reports them (B12 §3.3). */
export type CommentAuthor = {
  name: string;
  image: string | null;
  isWorkspaceMember: boolean;
  isGuest: boolean;
};

/** Tools the generic importers bring tasks from, by activity source id. */
const IMPORT_SOURCE_NAMES: Record<string, string> = {
  trello: "Trello",
  linear: "Linear",
  asana: "Asana",
};

function authorKindOf(author: CommentAuthor | undefined) {
  if (!author) return undefined;
  const kind: PublicAuthorKind = author.isGuest
    ? "guest"
    : author.isWorkspaceMember
      ? "member"
      : "external";
  return kind;
}

function getEventDataRecord(
  eventData: unknown,
): Record<string, unknown> | null {
  if (!eventData || typeof eventData !== "object" || Array.isArray(eventData)) {
    return null;
  }

  return eventData as Record<string, unknown>;
}

type WorkspaceUser = {
  user?: {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
};

function getActivityTypeIcon(type: string) {
  if (isIntakeActivity(type)) {
    const intakeIcon = getIntakeActivityIcon(type);
    if (intakeIcon) return intakeIcon;
  }
  const detailIcon = getTaskDetailActivityIcon(type);
  if (detailIcon) return detailIcon;
  const iconClass = "h-4 w-4";
  switch (type) {
    case "status_changed":
      return <History className={iconClass} />;
    case "priority_changed":
      return <CircleAlert className={iconClass} />;
    case "due_date_changed":
      return <Calendar className={iconClass} />;
    case "assignee_changed":
    case "unassigned":
      return <UserRound className={iconClass} />;
    case "cycle_changed":
      return <IterationCw className={iconClass} />;
    case "module_added":
    case "module_removed":
      return <Boxes className={iconClass} />;
    case "estimate_changed":
      return <Ruler className={iconClass} />;
    case "archived":
      return <Archive className={iconClass} />;
    case "unarchived":
    case "restored":
      return <ArchiveRestore className={iconClass} />;
    case "deleted":
      return <Trash2 className={iconClass} />;
    default:
      return <History className={iconClass} />;
  }
}

function formatActivityDateText(value: string) {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return formatDateMedium(parsed);
  }

  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!slashMatch) return value;
  const [, month, day, year] = slashMatch;
  const fromSlashDate = new Date(`${year}-${month}-${day}T00:00:00`);
  if (Number.isNaN(fromSlashDate.getTime())) return value;
  return formatDateMedium(fromSlashDate);
}

function toDisplayCase(value: string) {
  return value
    .replace(/[-_]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function findUserByName(users: WorkspaceUser[] | undefined, name: string) {
  if (!users) return null;
  const matches = users.filter(
    (member) =>
      member.user?.name?.toLowerCase().trim() === name.toLowerCase().trim(),
  );

  if (matches.length !== 1) return null;
  return matches[0];
}

function UserHoverName({
  user,
  fallbackName,
}: {
  user: WorkspaceUser | null;
  fallbackName: string;
}) {
  if (!user?.user) {
    return <span className="font-medium text-foreground">{fallbackName}</span>;
  }

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <span className="cursor-pointer font-medium text-foreground transition-colors hover:text-primary">
          {user.user.name}
        </span>
      </HoverCardTrigger>
      <HoverCardContent className="w-52 p-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarImage
              src={user.user.image ?? ""}
              alt={user.user.name || ""}
            />
            <AvatarFallback className="bg-muted text-xs font-medium">
              {getInitials(user.user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground leading-none">
              {user.user.name}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {user.user.email}
            </p>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function ActorAvatar({
  user,
  fallbackName,
}: {
  user: WorkspaceUser | null;
  fallbackName: string;
}) {
  return (
    <Avatar className="size-6">
      <AvatarImage src={user?.user?.image ?? ""} alt={fallbackName} />
      <AvatarFallback className="bg-muted text-[11px] font-medium">
        {getInitials(fallbackName)}
      </AvatarFallback>
    </Avatar>
  );
}

/** The API won't name a cycle of a project this reader can't see. */
function cycleChangeCopy(
  eventData: Record<string, unknown>,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (eventData.reason === "cycle_deleted") return t("activity:deletedCycle");
  const from = String(eventData.oldCycleName ?? "");
  const to = String(eventData.newCycleName ?? "");
  const oldHidden = eventData.oldCycleHidden === true;
  const newHidden = eventData.newCycleHidden === true;
  const hadCycle = oldHidden || Boolean(eventData.oldCycleId);
  const hasCycle = newHidden || Boolean(eventData.newCycleId);
  if (hadCycle && hasCycle) {
    if (oldHidden && newHidden) return t("activity:movedCycleBetweenHidden");
    if (oldHidden) return t("activity:movedCycleFromHidden", { to });
    if (newHidden) return t("activity:movedCycleToHidden", { from });
    return t("activity:movedCycle", { from, to });
  }
  if (hasCycle) {
    return newHidden
      ? t("activity:addedToHiddenCycle")
      : t("activity:addedToCycle", { name: to });
  }
  return oldHidden
    ? t("activity:removedFromHiddenCycle")
    : t("activity:removedFromCycle", { name: from });
}

function renderActivityContent({
  activity,
  workspaceUsers,
  workspaceId,
  t,
}: {
  activity: ActivityItem;
  workspaceUsers: WorkspaceUser[] | undefined;
  workspaceId?: string;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const content = activity.content || "";
  const eventData = getEventDataRecord(activity.eventData);

  if (activity.type === "priority_changed") {
    if (eventData) {
      return (
        <span className="text-sm text-muted-foreground">
          {t("activity:changedPriority", {
            from: getPriorityLabel(String(eventData.oldPriority ?? "")),
            to: getPriorityLabel(String(eventData.newPriority ?? "")),
          })}
        </span>
      );
    }

    const match = content.match(
      /changed priority from "?(.+?)"? to "?(.+?)"?$/i,
    );
    if (!match) {
      return <span className="text-sm text-muted-foreground">{content}</span>;
    }

    return (
      <span className="text-sm text-muted-foreground">
        {t("activity:changedPriority", {
          from: getPriorityLabel(match[1]),
          to: getPriorityLabel(match[2]),
        })}
      </span>
    );
  }

  if (activity.type === "status_changed") {
    // The API won't name a column of a project this reader can't see.
    if (eventData?.statusHidden) {
      return (
        <span className="text-sm text-muted-foreground">
          {t("activity:changedStatusHidden")}
        </span>
      );
    }
    if (eventData) {
      return (
        <span className="text-sm text-muted-foreground">
          {t("activity:changedStatus", {
            from: getStatusLabel(String(eventData.oldStatus ?? "")),
            to: getStatusLabel(String(eventData.newStatus ?? "")),
          })}
        </span>
      );
    }

    const match = content.match(/changed status from "?(.+?)"? to "?(.+?)"?$/i);
    if (!match) {
      return <span className="text-sm text-muted-foreground">{content}</span>;
    }

    return (
      <span className="text-sm text-muted-foreground">
        {t("activity:changedStatus", {
          from: getStatusLabel(match[1]),
          to: getStatusLabel(match[2]),
        })}
      </span>
    );
  }

  if (activity.type === "due_date_changed") {
    if (eventData) {
      const oldDueDate = eventData.oldDueDate
        ? formatActivityDateText(String(eventData.oldDueDate))
        : null;
      const newDueDate = eventData.newDueDate
        ? formatActivityDateText(String(eventData.newDueDate))
        : null;

      return (
        <span className="text-sm text-muted-foreground">
          {newDueDate
            ? oldDueDate
              ? t("activity:changedDueDate", {
                  from: oldDueDate,
                  to: newDueDate,
                })
              : t("activity:setDueDate", { date: newDueDate })
            : t("activity:clearedDueDate")}
        </span>
      );
    }

    const changeMatch = content.match(/changed due date from (.+) to (.+)$/i);
    if (changeMatch) {
      return (
        <span className="text-sm text-muted-foreground">
          {t("activity:changedDueDate", {
            from: formatActivityDateText(changeMatch[1]),
            to: formatActivityDateText(changeMatch[2]),
          })}
        </span>
      );
    }

    const setMatch = content.match(/set due date to (.+)$/i);
    if (setMatch) {
      return (
        <span className="text-sm text-muted-foreground">
          {t("activity:setDueDate", {
            date: formatActivityDateText(setMatch[1]),
          })}
        </span>
      );
    }

    if (content.includes("cleared the due date")) {
      return (
        <span className="text-sm text-muted-foreground">
          {t("activity:clearedDueDate")}
        </span>
      );
    }

    return <span className="text-sm text-muted-foreground">{content}</span>;
  }

  if (activity.type === "unassigned") {
    // One row per removed person; rows written before that carry nobody.
    if (eventData?.isSelfUnassigned) {
      return (
        <span className="text-sm text-muted-foreground">
          {t("activity:unassignedSelf")}
        </span>
      );
    }
    if (eventData?.oldAssigneeId) {
      const targetId = String(eventData.oldAssigneeId);
      const targetUser =
        workspaceUsers?.find((member) => member.user?.id === targetId) || null;
      return (
        <span className="text-sm text-muted-foreground">
          {t("activity:unassignedUser", {
            name:
              targetUser?.user?.name ??
              String(eventData.oldAssignee ?? t("common:people.someone")),
          })}
        </span>
      );
    }
    return (
      <span className="text-sm text-muted-foreground">
        {t("activity:unassigned")}
      </span>
    );
  }

  if (activity.type === "assignee_changed") {
    if (eventData) {
      if (eventData.isSelfAssigned) {
        return (
          <span className="text-sm text-muted-foreground">
            {t("activity:assignedToSelf")}
          </span>
        );
      }

      const targetId = String(eventData.newAssigneeId ?? "");
      const targetName = String(eventData.newAssignee ?? "");
      const targetUser =
        workspaceUsers?.find((member) => member.user?.id === targetId) || null;

      return (
        <span className="text-sm text-muted-foreground">
          {t("activity:assignedTo", {
            name: targetUser?.user?.name ?? targetName,
          })}
        </span>
      );
    }

    if (content.includes("themselves")) {
      return (
        <span className="text-sm text-muted-foreground">
          {t("activity:assignedToSelf")}
        </span>
      );
    }

    const tokenMatch = content.match(
      /assigned the task to \[\[user:([^|\]]+)\|([^\]]+)\]\]/,
    );
    if (tokenMatch) {
      const [, targetId, targetName] = tokenMatch;
      const targetUser =
        workspaceUsers?.find((member) => member.user?.id === targetId) || null;

      return (
        <span className="text-sm text-muted-foreground">
          {t("activity:assignedTo", {
            name: targetUser?.user?.name ?? targetName,
          })}
        </span>
      );
    }

    const legacyMatch = content.match(/assigned the task to (.+)$/i);
    if (legacyMatch) {
      const targetName = legacyMatch[1];
      const targetUser = findUserByName(workspaceUsers, targetName);
      return (
        <span className="text-sm text-muted-foreground">
          {t("activity:assignedTo", {
            name: targetUser?.user?.name ?? targetName,
          })}
        </span>
      );
    }
  }

  if (activity.type === "title_changed") {
    if (eventData) {
      return (
        <span className="text-sm text-muted-foreground">
          {t("activity:changedTitle", {
            from: String(eventData.oldTitle ?? ""),
            to: String(eventData.newTitle ?? ""),
          })}
        </span>
      );
    }

    const legacyMatch = content.match(/changed title from "(.+)" to "(.+)"$/i);
    if (legacyMatch) {
      return (
        <span className="text-sm text-muted-foreground">
          {t("activity:changedTitle", {
            from: legacyMatch[1],
            to: legacyMatch[2],
          })}
        </span>
      );
    }
  }

  if (activity.type === "moved") {
    if (eventData) {
      const from = String(eventData.fromProjectName ?? "");
      const to = String(eventData.toProjectName ?? "");
      // The API won't name a project this reader can't see.
      const copy =
        eventData.fromProjectHidden && eventData.toProjectHidden
          ? t("activity:movedBetweenHidden")
          : eventData.fromProjectHidden
            ? t("activity:movedFromHidden", { to })
            : eventData.toProjectHidden
              ? t("activity:movedToHidden", { from })
              : t("activity:moved", { from, to });
      return <span className="text-sm text-muted-foreground">{copy}</span>;
    }
  }

  if (activity.type === "cycle_changed" && eventData) {
    return (
      <span className="text-sm text-muted-foreground">
        {cycleChangeCopy(eventData, t)}
      </span>
    );
  }

  if (
    (activity.type === "module_added" || activity.type === "module_removed") &&
    eventData
  ) {
    const name = String(eventData.moduleName ?? "");
    const hidden = eventData.moduleHidden === true;
    const copy =
      activity.type === "module_added"
        ? hidden
          ? t("activity:addedToHiddenModule")
          : t("activity:addedToModule", { name })
        : hidden
          ? t("activity:removedFromHiddenModule")
          : t("activity:removedFromModule", { name });
    return <span className="text-sm text-muted-foreground">{copy}</span>;
  }

  if (activity.type === "estimate_changed" && eventData) {
    return <EstimateActivityText eventData={eventData} />;
  }

  // Trash (C7): moved to the trash and restored from it.
  if (activity.type === "deleted" || activity.type === "restored") {
    return (
      <span className="text-sm text-muted-foreground">
        {activity.type === "deleted"
          ? t("activity:movedToTrash")
          : t("activity:restoredFromTrash")}
      </span>
    );
  }

  if (activity.type === "archived" || activity.type === "unarchived") {
    return (
      <span className="text-sm text-muted-foreground">
        {activity.type === "archived"
          ? t("activity:archived")
          : t("activity:unarchived")}
      </span>
    );
  }

  // Written by the Jira import: the issue key the task came from.
  if (activity.type === "imported" && eventData?.source === "jira") {
    return (
      <span className="text-sm text-muted-foreground">
        {t("activity:importedFromJira", {
          key: typeof eventData.key === "string" ? eventData.key : "",
        })}
      </span>
    );
  }

  // Written by the Trello, Linear and Asana imports.
  const importSource =
    activity.type === "imported" && typeof eventData?.source === "string"
      ? IMPORT_SOURCE_NAMES[eventData.source]
      : undefined;
  if (importSource) {
    return (
      <span className="text-sm text-muted-foreground">
        {t("activity:importedFromSource", {
          source: importSource,
          key: typeof eventData?.key === "string" ? eventData.key : "",
        })}
      </span>
    );
  }

  if (activity.type === "created") {
    if (eventData) {
      return (
        <span className="text-sm text-muted-foreground">
          {t("activity:created")}
        </span>
      );
    }
  }

  const intakeLine = intakeActivityText(activity, t);
  if (intakeLine) {
    return <span className="text-sm text-muted-foreground">{intakeLine}</span>;
  }

  const detailLine = renderTaskDetailActivity(activity, t, { workspaceId });
  if (detailLine) return detailLine;

  return (
    <span className="text-sm text-muted-foreground">
      {content || toDisplayCase(activity.type)}
    </span>
  );
}

type CommentContext = {
  /** Each comment's reaction groups; undefined while they load. */
  commentReactions?: ReadonlyMap<string, readonly ReactionGroup[]>;
  /** Comment authors by comment id, loaded when the project has a board. */
  commentAuthors?: ReadonlyMap<string, CommentAuthor>;
  /** The project's public board, passed down once by the task view. */
  publicBoard?: CommentPublicBoard;
};

/** "by Agent X on behalf of Y" (ai-agent attribution), or null. */
function AgentViaLine({ eventData }: { eventData: unknown }) {
  const { t } = useTranslation();
  const via = agentViaOf(eventData);
  if (!via) return null;
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
      <AgentBadge />
      {via.onBehalfOfName
        ? t("ai:agents.activity.onBehalfOf", { name: via.onBehalfOfName })
        : null}
    </span>
  );
}

/**
 * One row of the feed: its icon tile in a narrow column, the row's content
 * beside it. With `rail`, a thin line runs through the column and joins
 * the tiles of neighbouring rows into one timeline.
 */
function FeedRow({
  step,
  rail,
  tile,
  tileClassName,
  tileOffsetClassName,
  className,
  children,
}: {
  step: number;
  rail: boolean;
  tile: ReactNode;
  tileClassName?: string;
  /** Lines the tile up with the content's first line. */
  tileOffsetClassName: string;
  className?: string;
  children: ReactNode;
}) {
  const line = rail ? "w-px bg-border" : "w-px";
  return (
    <TimelineItem
      className={cn("m-0! flex-row items-stretch gap-3 py-0!", className)}
      step={step}
    >
      <div
        aria-hidden="true"
        className="flex w-6 shrink-0 flex-col items-center"
      >
        <span
          className={cn(
            "shrink-0",
            line,
            tileOffsetClassName,
            "group-first/timeline-item:bg-transparent",
          )}
        />
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center text-muted-foreground",
            tileClassName,
          )}
        >
          {tile}
        </span>
        <span
          className={cn(
            "flex-1",
            line,
            "group-last/timeline-item:bg-transparent",
          )}
        />
      </div>
      {children}
    </TimelineItem>
  );
}

/** One comment's card, top-level or a reply. */
function CommentActivityCard({
  activity,
  commentReactions,
  commentAuthors,
  publicBoard,
  variant,
  parentVisibility,
  onReply,
  replyLabel,
  replyButtonRef,
  children,
}: CommentContext & {
  activity: ActivityItem;
  variant?: "card" | "reply";
  /** A reply's top-level comment's visibility. */
  parentVisibility?: "internal" | "public";
  onReply?: () => void;
  replyLabel?: string;
  replyButtonRef?: Ref<HTMLButtonElement>;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const { data: workspaceUsers } = useGetWorkspaceUsers({
    workspaceId: workspace?.id,
  });

  const user = activity.userId
    ? workspaceUsers?.find(
        (workspaceUser) => workspaceUser.user?.id === activity.userId,
      )
    : null;

  const isExternalComment = Boolean(activity.externalSource);
  const actorName = user?.user?.name || t("common:people.someone");
  const via = agentViaOf(activity.eventData);
  const aiProvenance = provenanceOf(activity.aiProvenance);

  // Public board authors are usually outsiders, missing from the members.
  const author = commentAuthors?.get(activity.id);
  // A comment an automation rule wrote is signed "Automation".
  const ruleComment = automationOf(activity)?.rule === "custom";
  const commentUser = ruleComment
    ? {
        id: undefined,
        name: t("activity:automation.actor"),
        email: undefined,
        image: undefined,
      }
    : isExternalComment
      ? {
          id: undefined,
          name: activity.externalUserName ?? t("activity:githubUser"),
          email: undefined,
          image: activity.externalUserAvatar ?? undefined,
        }
      : !activity.userId
        ? {
            // The author's account was deleted; the comment stays.
            id: undefined,
            name: via
              ? t("ai:agents.desk.deletedAgent")
              : t("publicProject:comments.deletedUser"),
            email: undefined,
            image: undefined,
          }
        : {
            id: user?.user?.id ?? activity.userId ?? undefined,
            name: user?.user?.name ?? author?.name,
            email: user?.user?.email,
            image: user?.user?.image ?? author?.image,
          };

  return (
    <CommentCard
      commentId={activity.id}
      taskId={activity.taskId}
      content={activity.content || ""}
      user={commentUser}
      createdAt={activity.createdAt}
      updatedAt={activity.updatedAt}
      importedBy={
        activity.userId && activity.externalSource !== "github"
          ? actorName
          : undefined
      }
      externalSource={activity.externalSource}
      externalUrl={activity.externalUrl}
      reactionGroups={
        commentReactions ? (commentReactions.get(activity.id) ?? []) : undefined
      }
      visibility={activity.visibility}
      authorKind={isExternalComment ? undefined : authorKindOf(author)}
      publicBoard={publicBoard}
      parentVisibility={parentVisibility}
      variant={variant}
      badges={
        via || aiProvenance ? (
          <>
            {via ? <AgentViaLine eventData={activity.eventData} /> : null}
            <AiContentLabel provenance={aiProvenance} />
          </>
        ) : null
      }
      onReply={onReply}
      replyLabel={replyLabel}
      replyButtonRef={replyButtonRef}
      workspaceId={workspace?.id}
    >
      {children}
    </CommentCard>
  );
}

/** The name a comment is signed with, for labels such as "Reply to …". */
function commentAuthorName(
  activity: ActivityItem,
  memberName: string | null | undefined,
  author: CommentAuthor | undefined,
) {
  if (activity.externalSource) return activity.externalUserName ?? null;
  return memberName ?? author?.name ?? null;
}

type ActivityProps = CommentContext & {
  activity: ActivityItem;
  step: number;
  /** Joins this row to its neighbours with the feed's timeline line. */
  rail?: boolean;
  /**
   * A top-level comment's replies, oldest first: renders its thread inside
   * the card and, with `canReply`, the Reply actions. Undefined renders no
   * thread (feeds that list comments without their threads).
   */
  replies?: readonly ActivityItem[];
  /** The viewer may comment on the task. */
  canReply?: boolean;
};

/** A comment on the feed: its card, with its thread inside. */
function CommentActivity({
  activity,
  step,
  rail = false,
  replies,
  canReply = false,
  ...context
}: ActivityProps) {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const { data: workspaceUsers } = useGetWorkspaceUsers({
    workspaceId: workspace?.id,
  });
  const composer = useReplyComposer();

  const memberName = activity.userId
    ? workspaceUsers?.find(
        (workspaceUser) => workspaceUser.user?.id === activity.userId,
      )?.user?.name
    : null;
  const parentAuthorName = commentAuthorName(
    activity,
    memberName,
    context.commentAuthors?.get(activity.id),
  );
  const replyLabel = parentAuthorName
    ? t("activity:comment.thread.replyTo", { name: parentAuthorName })
    : t("activity:comment.thread.reply");
  const threaded = replies !== undefined;
  const parentVisibility = activity.visibility ?? "internal";
  // The public board lists comments flat, so only a public comment's
  // replies may be public too (the API enforces the same).
  const publicReplies =
    Boolean(context.publicBoard?.open) && parentVisibility === "public";

  return (
    <FeedRow
      step={step}
      rail={rail}
      tile={<MessageSquare className="size-3.5" />}
      tileClassName="rounded-md border border-border bg-card"
      tileOffsetClassName="h-4"
    >
      <TimelineContent className="min-w-0 flex-1 py-2">
        <CommentActivityCard
          activity={activity}
          {...context}
          onReply={threaded && canReply ? composer.open : undefined}
          replyLabel={replyLabel}
          replyButtonRef={composer.replyButtonRef}
        >
          {threaded && (
            <CommentThread
              taskId={activity.taskId}
              parentId={activity.id}
              replyLabel={replyLabel}
              replies={replies}
              canReply={canReply}
              publicReplies={publicReplies}
              composer={composer}
              renderReply={(reply) => (
                <CommentActivityCard
                  activity={reply}
                  variant="reply"
                  parentVisibility={parentVisibility}
                  {...context}
                />
              )}
            />
          )}
        </CommentActivityCard>
      </TimelineContent>
    </FeedRow>
  );
}

function Activity(props: ActivityProps) {
  if (isCommentActivity(props.activity)) {
    return <CommentActivity {...props} />;
  }
  return (
    <HistoryActivity
      activity={props.activity}
      step={props.step}
      rail={props.rail}
    />
  );
}

/** A history line: who changed what, and when. */
function HistoryActivity({
  activity,
  step,
  rail = false,
}: {
  activity: ActivityItem;
  step: number;
  rail?: boolean;
}) {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const { data: workspaceUsers } = useGetWorkspaceUsers({
    workspaceId: workspace?.id,
  });

  const user = activity.userId
    ? workspaceUsers?.find(
        (workspaceUser) => workspaceUser.user?.id === activity.userId,
      )
    : null;

  const actorName = user?.user?.name || t("common:people.someone");
  const viaLine = agentViaOf(activity.eventData) ? (
    <AgentViaLine eventData={activity.eventData} />
  ) : null;

  const activityIcon = getActivityTypeIcon(activity.type);
  // The wake-up job ends snoozes: nobody did it, so no name or avatar.
  // A repeat the schedule created has no actor either.
  const isSystemRow =
    activity.type === INTAKE_SNOOZE_ENDED ||
    (!activity.userId &&
      (activity.type === "recurred_from" || activity.type === "recurred_to"));
  // Scheduled automations act as "Automation", with a bot for an avatar.
  const automation = automationOf(activity);

  return (
    <FeedRow
      step={step}
      rail={rail}
      tile={activityIcon}
      tileClassName="text-muted-foreground/80 [&_svg]:size-3.5"
      tileOffsetClassName="h-2"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2 py-2">
        {automation ? (
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Bot className="size-3.5" />
          </span>
        ) : (
          !isSystemRow && (
            <ActorAvatar user={user || null} fallbackName={actorName} />
          )
        )}
        <TimelineContent className="min-w-0 text-foreground text-sm leading-6">
          {automation ? (
            <>
              <span className="font-medium">
                {t("activity:automation.actor")}
              </span>{" "}
            </>
          ) : (
            !isSystemRow && (
              <>
                <UserHoverName
                  user={user || null}
                  fallbackName={actorName}
                />{" "}
              </>
            )
          )}
          {automation && automation.rule !== "custom" ? (
            <span className="text-muted-foreground text-sm">
              {automationActivityText(activity, automation, t)}
            </span>
          ) : (
            renderActivityContent({
              activity,
              workspaceUsers: workspaceUsers as WorkspaceUser[] | undefined,
              workspaceId: workspace?.id,
              t,
            })
          )}{" "}
          {viaLine && <>{viaLine} </>}
          {automation?.rule === "custom" && automation.ruleName && (
            <span className="text-muted-foreground text-xs">
              {t("activity:automation.byRule", {
                name: automation.ruleName,
              })}{" "}
            </span>
          )}
          <span className="whitespace-nowrap text-muted-foreground/70 text-xs">
            {formatRelativeTime(activity.createdAt)}
          </span>
        </TimelineContent>
      </div>
    </FeedRow>
  );
}

export default Activity;

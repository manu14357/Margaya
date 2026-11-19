import { MargayaIssueLink as SchemaIssueLink } from "@margaya/editor-schema";
import { useQuery } from "@tanstack/react-query";
import { mergeAttributes } from "@tiptap/core";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/preview-card";
import getProject from "@/fetchers/project/get-project";
import getTask from "@/fetchers/task/get-task";
import { embeddedAssignees, formatAssigneeSummary } from "@/lib/task-assignees";
import { isValidUrl } from "./url-safety";

function parseTaskRouteFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(
      /\/dashboard\/workspace\/([^/]+)\/project\/([^/]+)\/task\/([^/]+)(?:\/|$)/i,
    );
    if (!match) return null;
    return {
      workspaceId: match[1],
      projectId: match[2],
      taskId: match[3],
    };
  } catch {
    return null;
  }
}

function MargayaIssueLinkView({ node }: NodeViewProps) {
  const { t } = useTranslation();
  const issueKey = String(node.attrs.issueKey || "");
  const taskIdAttr = String(node.attrs.taskId || "");
  const url = String(node.attrs.url || "");
  const taskRoute = parseTaskRouteFromUrl(url);
  const taskId = taskIdAttr || taskRoute?.taskId || "";

  const { data: task } = useQuery({
    queryKey: ["task", taskId, "margaya-issue-link"],
    queryFn: () => getTask(taskId),
    enabled: Boolean(taskId),
    staleTime: 1000 * 60,
  });
  const { data: project } = useQuery({
    queryKey: [
      "projects",
      taskRoute?.workspaceId,
      taskRoute?.projectId,
      "margaya-issue-link",
    ],
    queryFn: () =>
      getProject({
        id: taskRoute?.projectId ?? "",
        workspaceId: taskRoute?.workspaceId ?? "",
      }),
    enabled: Boolean(taskRoute?.workspaceId && taskRoute?.projectId),
    staleTime: 1000 * 60,
  });

  const projectSlug = project?.slug ? String(project.slug).toUpperCase() : "";
  const resolvedIssueKey =
    issueKey ||
    (projectSlug && task?.number ? `${projectSlug}-${task.number}` : "");
  const title = task?.title || issueKey || t("tasks:entity.task");
  const status = task?.status
    ? t(`tasks:status.${task.status}`)
    : t("tasks:status.to-do");
  const priority = task?.priority
    ? t(`tasks:priority.${task.priority}`)
    : t("tasks:priority.no-priority");
  const assignee = formatAssigneeSummary(
    task ? embeddedAssignees(task) : [],
    t,
  );
  const resolvedHref =
    taskRoute?.workspaceId && taskRoute?.projectId && task?.id
      ? `/dashboard/workspace/${taskRoute.workspaceId}/project/${taskRoute.projectId}/task/${task.id}`
      : url;
  const isInternal = resolvedHref.startsWith("/");
  const href = isInternal || isValidUrl(resolvedHref) ? resolvedHref : "";

  return (
    <NodeViewWrapper as="span" className="margaya-issue-link-node">
      <HoverCard openDelay={160} closeDelay={120}>
        <HoverCardTrigger asChild>
          <a
            href={href || undefined}
            target={isInternal ? undefined : "_blank"}
            rel={isInternal ? undefined : "noopener noreferrer"}
            className="margaya-issue-link-chip"
          >
            {resolvedIssueKey ? (
              <span className="margaya-issue-link-key">{resolvedIssueKey}</span>
            ) : null}
            <span className="margaya-issue-link-title">{title}</span>
          </a>
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          align="start"
          sideOffset={8}
          className="margaya-issue-link-preview"
        >
          <div className="margaya-issue-link-preview-top">
            <span className="margaya-issue-link-preview-key">
              {resolvedIssueKey || t("tasks:entity.task")}
            </span>
            <span className="margaya-issue-link-preview-assignee">
              {assignee}
            </span>
          </div>
          <p className="margaya-issue-link-preview-title">{title}</p>
          <div className="margaya-issue-link-preview-meta">
            <span>{status}</span>
            <span>·</span>
            <span>{priority}</span>
          </div>
        </HoverCardContent>
      </HoverCard>
    </NodeViewWrapper>
  );
}

// The headless node from @margaya/editor-schema (attributes and markdown, so
// the server reads and writes task links exactly as the editor does) with
// the web's HTML and chip view.
export const MargayaIssueLink = SchemaIssueLink.extend({
  // A tag on a line of its own reaches the editor as HTML, where the
  // attribute names are the markdown's dashed ones.
  addAttributes() {
    const read = (name: string) => ({
      default: "",
      parseHTML: (element: HTMLElement) =>
        element.getAttribute(name) ??
        element.getAttribute(`data-${name}`) ??
        "",
    });
    return {
      url: read("url"),
      issueKey: read("issue-key"),
      taskId: read("task-id"),
    };
  },

  parseHTML() {
    return [
      { tag: "margaya-issue-link[url]" },
      { tag: "span[data-type='margaya-issue-link'][data-url]" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "margaya-issue-link",
      mergeAttributes(HTMLAttributes, {
        "data-type": "margaya-issue-link",
        "data-url": HTMLAttributes.url,
        "data-issue-key": HTMLAttributes.issueKey,
        "data-task-id": HTMLAttributes.taskId,
        url: HTMLAttributes.url,
        "issue-key": HTMLAttributes.issueKey,
        "task-id": HTMLAttributes.taskId,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MargayaIssueLinkView);
  },
});

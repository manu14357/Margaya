import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InboxRow from "./inbox-row";
import { inboxNotification } from "./inbox-test-fixtures";

// English for the strings these tests read whole; other keys stay keys.
const EN = vi.hoisted<Record<string, string>>(() => ({
  "ai:agents.reply.title": "{{agentName}} answered your request",
  "ai:agents.reply.verb": "answered your request",
  "notifications:inbox.verbs.page_mention_titled":
    "mentioned you in {{pageTitle}}",
  "notifications:events.page_mention.content":
    "{{mentionerName}} mentioned you in: {{pageTitle}}",
  "notifications:inbox.verbs.page_comment_titled": "commented on {{pageTitle}}",
  "notifications:events.page_comment.content":
    "{{commenterName}} commented on {{pageTitle}}: {{commentPreview}}",
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const english = EN[key];
      if (english) {
        return english.replace(/{{(\w+)}}/g, (_, name: string) =>
          String(values?.[name] ?? ""),
        );
      }
      return values?.date ? `${key} ${values.date}` : key;
    },
  }),
}));
vi.mock("@/lib/format", () => ({
  formatRelativeTime: () => "2 hours ago",
  formatDate: () => "Sat, Sep 27, 9:00 AM",
  formatDateMedium: () => "Sep 27, 2026",
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderRow(
  overrides: Parameters<typeof inboxNotification>[0] = {},
  view: "inbox" | "snoozed" | "archived" = "inbox",
) {
  const onSelect = vi.fn();
  const onAction = vi.fn();
  const notification = inboxNotification(overrides);
  render(
    <InboxRow
      notification={notification}
      view={view}
      selected={false}
      onSelect={onSelect}
      onAction={onAction}
    />,
  );
  return { notification, onSelect, onAction };
}

describe("InboxRow", () => {
  it("shows the actor, verb, task and comment preview", () => {
    renderRow();
    expect(screen.getByText("Ana Silva")).toBeInTheDocument();
    expect(
      screen.getByText("notifications:inbox.verbs.task_comment"),
    ).toBeInTheDocument();
    expect(screen.getByText("WEB-12")).toBeInTheDocument();
    expect(screen.getByText("Ship it")).toBeInTheDocument();
    expect(screen.getByText("Looks good")).toBeInTheDocument();
    expect(screen.getByText("2 hours ago")).toBeInTheDocument();
  });

  it("marks unread rows with a dot and a strong actor", () => {
    renderRow();
    expect(document.querySelector(".bg-info")).not.toBeNull();
    expect(screen.getByText("Ana Silva")).toHaveClass("font-medium");
    cleanup();
    renderRow({ isRead: true });
    expect(document.querySelector(".bg-info")).toBeNull();
    expect(screen.getByText("Ana Silva")).not.toHaveClass("font-medium");
  });

  it("renders system rows without an actor", () => {
    renderRow({
      type: "due_date_reminder",
      actor: null,
      actorId: null,
      eventData: { taskTitle: "Ship it", leadTimeMinutes: 60 },
    });
    expect(screen.queryByText("Ana Silva")).not.toBeInTheDocument();
    expect(
      screen.getByText("notifications:inbox.verbs.due_date_reminder"),
    ).toBeInTheDocument();
    expect(screen.queryByText("notifications:inbox.someone")).toBeNull();
  });

  it("gives a system row without a task its content, not its title again", () => {
    renderRow({
      type: "workspace_created",
      actor: null,
      actorId: null,
      task: null,
      resourceType: "workspace",
      resourceId: "ws",
      eventData: { workspaceName: "Acme" },
    });
    expect(
      screen.getAllByText("notifications:events.workspace_created.title"),
    ).toHaveLength(1);
    expect(
      screen.getByText("notifications:events.workspace_created.content"),
    ).toBeInTheDocument();
  });

  const agent = { id: "agent-1", name: "Standup", image: null };
  const workspaceNotice = {
    task: null,
    resourceType: "workspace",
    resourceId: "ws",
    actor: agent,
    actorId: agent.id,
  } as const;

  it("gives an agent's answer its summary as plain text, not its title again", () => {
    renderRow({
      ...workspaceNotice,
      type: "ai_agent_reply",
      title: "Standup answered your request",
      content:
        "Created a standup page **2026-11-05** for the Website project: [2026-11-05](/dashboard/workspace/ws/project/p1/pages/pg1).\n\n- It lists `WEB-4` as _done_.",
      eventData: { runId: "run-1", agentName: "Standup" },
    });
    expect(screen.getByText("answered your request")).toBeInTheDocument();
    expect(screen.queryByText("Standup answered your request")).toBeNull();
    expect(
      screen.getByText(
        "Created a standup page 2026-11-05 for the Website project: 2026-11-05. It lists WEB-4 as done.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("option")).not.toHaveTextContent(
      /\*\*|\]\(|\/dashboard/,
    );
  });

  it("gives an agent's question and proposed change their text, not the title", () => {
    renderRow({
      ...workspaceNotice,
      type: "ai_agent_reply",
      title: "Standup has a question",
      content: "Which project should the **weekly** standup cover?",
      eventData: { runId: "run-2", agentName: "Standup", needsInput: true },
    });
    expect(
      screen.queryByText("ai:agents.needsInput.notificationTitle"),
    ).toBeNull();
    expect(
      screen.getByText("Which project should the weekly standup cover?"),
    ).toBeInTheDocument();
    cleanup();

    renderRow({
      ...workspaceNotice,
      type: "ai_approval_requested",
      title: "Standup needs your approval",
      content: 'Create page "Retro notes"',
      eventData: { approvalId: "ap-1", runId: "run-3", agentName: "Standup" },
    });
    expect(screen.queryByText("ai:agents.inbox.title")).toBeNull();
    expect(screen.getByText('Create page "Retro notes"')).toBeInTheDocument();
  });

  it("never shows a model's control tokens from a stored answer", () => {
    renderRow({
      ...workspaceNotice,
      type: "ai_agent_reply",
      title: "Standup answered your request",
      content:
        "Created the standup page **[2026-11-03](/dashboard/workspace/ws/project/p1/pages/pg1)**; no blocked items, so that section was left out.<|tool_calls_section_begin|><|tool_calls_section_end|>",
      eventData: { runId: "run-5", agentName: "Standup" },
    });
    expect(
      screen.getByText(
        "Created the standup page 2026-11-03; no blocked items, so that section was left out.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("option")).not.toHaveTextContent(/tool_calls|<\|/);
  });

  it("shows no second line when the first already says everything", () => {
    renderRow({
      ...workspaceNotice,
      type: "ai_agent_reply",
      title: "Standup answered your request",
      content: "Standup answered your request",
      eventData: { runId: "run-4", agentName: "Standup" },
    });
    expect(screen.queryByText("Standup answered your request")).toBeNull();
  });

  it("shows a page notification's page and comment, not its body again", () => {
    const page = {
      task: null,
      resourceType: "page",
      resourceId: "page-1",
    } as const;
    renderRow({
      ...page,
      type: "page_mention",
      eventData: {
        pageTitle: "Release plan",
        mentionerName: "Ana Silva",
        projectId: "project-1",
      },
    });
    // The page is the subject, as a task row shows its task.
    expect(screen.getByText("Release plan")).toBeInTheDocument();
    expect(
      screen.queryByText("Ana Silva mentioned you in: Release plan"),
    ).toBeNull();
    cleanup();

    renderRow({
      ...page,
      type: "page_comment",
      eventData: {
        pageTitle: "Release plan",
        commenterName: "Ana Silva",
        commentPreview: "Can we ship on Friday?",
        projectId: "project-1",
      },
    });
    expect(screen.getByText("Release plan")).toBeInTheDocument();
    expect(screen.getByText("Can we ship on Friday?")).toBeInTheDocument();
    expect(screen.queryByText(/commented on Release plan:/)).toBeNull();
  });

  it("keeps the verb in view next to a long name", () => {
    renderRow({
      actor: {
        id: "ana",
        name: "Maximiliana Alexandrovna Wolfeschlegelsteinhausen-Bergdorff",
        image: null,
      },
    });
    const name = screen.getByText(
      "Maximiliana Alexandrovna Wolfeschlegelsteinhausen-Bergdorff",
    );
    // The name gives way first, so the verb never truncates out of view.
    expect(name).toHaveClass("truncate");
    expect(name.className).toMatch(/max-w-/);
    expect(
      screen.getByText("notifications:inbox.verbs.task_comment"),
    ).toHaveClass("truncate");
  });

  it("shows the snooze end in the Snoozed view", () => {
    renderRow(
      { isSnoozed: true, snoozedUntil: "2026-09-27T09:00:00.000Z" },
      "snoozed",
    );
    expect(
      screen.getByText("notifications:inbox.snooze.until Sat, Sep 27, 9:00 AM"),
    ).toBeInTheDocument();
    expect(screen.queryByText("2 hours ago")).toBeNull();
  });

  it("selects on click and on Enter", () => {
    const { notification, onSelect } = renderRow();
    const row = screen.getByRole("option");
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect.mock.calls[0]?.[0]).toBe(notification);
  });

  it("hover actions call the right action without selecting", () => {
    const { notification, onAction, onSelect } = renderRow();
    fireEvent.click(
      screen.getByRole("button", {
        name: "notifications:inbox.actions.markRead",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "notifications:inbox.actions.archive",
      }),
    );
    expect(onAction.mock.calls).toEqual([
      [notification, { action: "read" }],
      [notification, { action: "archive" }],
    ]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  // jsdom can't match pointer media queries; the phone spec proves the result.
  it("gives touch screens visible actions on their own line", () => {
    renderRow();
    const row = screen.getByRole("option");
    expect(row).toHaveClass("pointer-coarse:flex-wrap");
    const actions = screen.getByRole("button", {
      name: "notifications:inbox.actions.archive",
    }).parentElement;
    expect(actions).toHaveClass(
      "pointer-coarse:opacity-100",
      "pointer-coarse:static",
      "pointer-coarse:w-full",
    );
  });

  it("shows times at full muted contrast", () => {
    renderRow();
    expect(screen.getByText("2 hours ago")).toHaveClass(
      "text-muted-foreground",
    );
    cleanup();
    renderRow(
      { isSnoozed: true, snoozedUntil: "2026-09-27T09:00:00.000Z" },
      "snoozed",
    );
    expect(
      screen.getByText("notifications:inbox.snooze.until Sat, Sep 27, 9:00 AM"),
    ).toHaveClass("text-muted-foreground");
  });

  it("offers unread and move-to-inbox for read, archived rows", () => {
    const { notification, onAction } = renderRow(
      { isRead: true, archivedAt: "2026-09-26T11:00:00.000Z" },
      "archived",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "notifications:inbox.actions.markUnread",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "notifications:inbox.actions.unarchive",
      }),
    );
    expect(onAction.mock.calls).toEqual([
      [notification, { action: "unread" }],
      [notification, { action: "unarchive" }],
    ]);
  });
});

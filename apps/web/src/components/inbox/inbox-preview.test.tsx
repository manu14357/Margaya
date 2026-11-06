import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InboxPreview from "./inbox-preview";
import { inboxNotification } from "./inbox-test-fixtures";

const mocks = vi.hoisted(() => ({
  task: {} as {
    data?: { title: string };
    isLoading: boolean;
    isError: boolean;
  },
  navigate: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/hooks/queries/task/use-get-task", () => ({
  default: () => mocks.task,
}));
vi.mock("@/hooks/use-project-websocket", () => ({
  useProjectWebSocket: vi.fn(),
}));
vi.mock("@/hooks/mutations/recent-visit/use-record-visit", () => ({
  useRecordVisit: vi.fn(),
  visitArchiveState: vi.fn(),
}));
vi.mock("@/components/ai/agents/agent-reply-card", () => ({
  AgentReplyCard: () => null,
  agentReplyOf: () => null,
}));
vi.mock("@/components/ai/agents/approval-card", () => ({
  ApprovalCard: () => null,
}));
vi.mock("@/components/ai/agents/task-agent-waiting", async () => {
  const { createContext } = await import("react");
  return { AgentItemShownAbove: createContext({}) };
});
vi.mock("@/components/task/task-details-content", () => ({
  default: () => <div>conversation</div>,
}));
vi.mock("@/components/task/task-page-skeleton", () => ({
  TaskDetailsSkeleton: () => <div>skeleton</div>,
}));
vi.mock("@/components/task/task-properties-sidebar", () => ({
  default: ({ taskId }: { taskId: string }) => <div>properties:{taskId}</div>,
}));
vi.mock("@/components/task/task-subscribe-button", () => ({
  default: () => null,
}));

const SHOW = "notifications:inbox.preview.showProperties";
const HIDE = "notifications:inbox.preview.hideProperties";

function renderPreview(notification = inboxNotification()) {
  const props = {
    workspaceId: "ws",
    onAction: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(<InboxPreview notification={notification} {...props} />);
  return {
    ...view,
    moveTo: (next: typeof notification) =>
      view.rerender(<InboxPreview notification={next} {...props} />),
  };
}

beforeEach(() => {
  mocks.task = {
    data: { title: "Ship it now" },
    isLoading: false,
    isError: false,
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InboxPreview", () => {
  it("shows the conversation with properties collapsed and unloaded", () => {
    renderPreview();
    expect(screen.getByText("conversation")).toBeInTheDocument();
    expect(screen.queryByText("properties:task-1")).toBeNull();
    expect(
      screen.getByRole("button", { name: new RegExp(SHOW) }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("opens and closes the properties from the toggle", () => {
    renderPreview();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(SHOW) }));
    expect(screen.getByText("properties:task-1")).toBeInTheDocument();

    const hide = screen.getByRole("button", { name: new RegExp(HIDE) });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(hide);
    expect(
      screen.getByRole("button", { name: new RegExp(SHOW) }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the choice while moving to another notification", () => {
    const { moveTo } = renderPreview();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(SHOW) }));

    moveTo(
      inboxNotification({
        id: "n2",
        task: {
          id: "task-2",
          key: "WEB-13",
          title: "Next",
          projectId: "project-1",
          projectName: "Website",
        },
      }),
    );
    expect(screen.getByText("properties:task-2")).toBeInTheDocument();
  });

  it("names the task in the header, with the project still on the toggle", () => {
    renderPreview();
    expect(screen.getByTitle("Ship it now")).toHaveTextContent("Ship it now");
    expect(screen.getByText("WEB-12")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: new RegExp(SHOW) }),
    ).toHaveTextContent("Website");
  });

  it("uses the notification's title until the task loads", () => {
    mocks.task = { isLoading: true, isError: false };
    renderPreview();
    expect(screen.getByTitle("Ship it")).toHaveTextContent("Ship it");
  });

  it("shows no properties toggle for a notice without a task", () => {
    renderPreview(
      inboxNotification({
        task: null,
        resourceType: "workspace",
        resourceId: "ws",
      }),
    );
    expect(screen.queryByRole("button", { name: new RegExp(SHOW) })).toBeNull();
  });

  const pagePath =
    "/dashboard/workspace/ws/project/project-1/pages/page-1?panel=comments&source=standup-agent-scheduled-run-2026-11-05";
  const agentAnswer = inboxNotification({
    type: "ai_agent_reply",
    task: null,
    resourceType: "workspace",
    resourceId: "ws",
    title: "Standup answered your request",
    content: [
      `Created a standup page **2026-11-05**: [2026-11-05](${pagePath}).`,
      "",
      "- The [release notes](https://example.com/releases/2026/11/notes)",
      `- [Same app, full address](${window.location.origin}/dashboard/workspace/ws/inbox)`,
      "- [run me](javascript:alert(1)) and [mail](mailto:someone@example.com)",
      '- <b>raw</b> <img src="x" onerror="alert(1)"> ![tracker](https://example.com/pixel.png)',
    ].join("\n"),
    eventData: { runId: "run-1", agentName: "Standup" },
  });

  it("renders an agent's answer as Markdown, never as raw syntax or HTML", () => {
    const { container } = renderPreview(agentAnswer);
    expect(container.querySelector("strong")).toHaveTextContent("2026-11-05");
    expect(container).not.toHaveTextContent("**2026-11-05**");
    expect(container).not.toHaveTextContent(`](${pagePath})`);
    // Raw HTML stays text, and images (remote fetches) are not loaded.
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("tracker");
  });

  it("navigates in-app links in place and opens only http(s) links outside", () => {
    renderPreview(agentAnswer);
    const inApp = screen.getByRole("link", { name: "2026-11-05" });
    expect(inApp).toHaveAttribute("href", pagePath);
    expect(inApp).not.toHaveAttribute("target");
    fireEvent.click(inApp);
    expect(mocks.navigate).toHaveBeenCalledWith({ href: pagePath });

    fireEvent.click(
      screen.getByRole("link", { name: "Same app, full address" }),
    );
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      href: "/dashboard/workspace/ws/inbox",
    });

    const outside = screen.getByRole("link", { name: "release notes" });
    expect(outside).toHaveAttribute(
      "href",
      "https://example.com/releases/2026/11/notes",
    );
    expect(outside).toHaveAttribute("target", "_blank");
    expect(outside.getAttribute("rel")).toContain("noopener");
    fireEvent.click(outside);
    expect(mocks.navigate).toHaveBeenCalledTimes(2);

    // Any other scheme is text, not a link.
    expect(screen.queryByRole("link", { name: "run me" })).toBeNull();
    expect(screen.queryByRole("link", { name: "mail" })).toBeNull();
    expect(screen.getByText("run me")).toBeInTheDocument();
  });

  it("keeps a modified click on an in-app link for the browser", () => {
    renderPreview(agentAnswer);
    fireEvent.click(screen.getByRole("link", { name: "2026-11-05" }), {
      ctrlKey: true,
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("wraps long words so the notice never scrolls sideways", () => {
    const { container } = renderPreview(agentAnswer);
    const body = container.querySelector("strong")?.closest("div");
    expect(body).toHaveClass("wrap-anywhere");
    const scroller = body?.closest(".overflow-y-auto");
    expect(scroller).toHaveClass("overflow-x-hidden");
  });

  it("shows a stored answer without a model's control tokens, its link working", () => {
    const link = "/dashboard/workspace/ws/project/p1/pages/pg1";
    const { container } = renderPreview(
      inboxNotification({
        type: "ai_agent_reply",
        task: null,
        resourceType: "workspace",
        resourceId: "ws",
        title: "Standup answered your request",
        content: `Created the standup page **[2026-11-03](${link})**; that section was left out.<|tool_calls_section_begin|><|tool_calls_section_end|>`,
        eventData: { runId: "run-5", agentName: "Standup" },
      }),
    );
    expect(container).not.toHaveTextContent(/tool_calls|<\||\|>/);
    expect(container).toHaveTextContent("that section was left out.");
    const page = screen.getByRole("link", { name: "2026-11-03" });
    expect(page.closest("strong")).not.toBeNull();
    fireEvent.click(page);
    expect(mocks.navigate).toHaveBeenCalledWith({ href: link });
  });

  it("keeps a template-built body as plain text", () => {
    const { container } = renderPreview(
      inboxNotification({
        type: "workspace_created",
        task: null,
        actor: null,
        actorId: null,
        resourceType: "workspace",
        resourceId: "ws",
        eventData: { workspaceName: "**Acme**" },
      }),
    );
    expect(
      screen.getByText("notifications:events.workspace_created.content"),
    ).toHaveClass("wrap-anywhere");
    expect(container.querySelector("strong")).toBeNull();
  });
});

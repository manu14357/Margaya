import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiSpecDraftButton, specPageContent } from "./ai-spec-draft";
import { AiSummaryButton } from "./ai-summary";

const m = vi.hoisted(() => ({
  available: true,
  pagesOn: true,
  canCreatePages: true,
  calls: [] as Array<{ path: string; body: Record<string, unknown> }>,
  reply: "**On track.**\n\n- WEB-1 done",
  created: [] as Array<Record<string, unknown>>,
  /** The `done` event's stop reason; null sends no `done` (dropped). */
  stop: "end_turn" as string | null,
  /** When set, the stream waits for it before finishing. */
  hold: null as Promise<void> | null,
  invalidated: [] as unknown[],
  navigate: vi.fn(),
  canUpdateTasks: true,
  comments: [] as Array<Record<string, unknown>>,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { resolvedLanguage: "fr-FR", language: "fr-FR" },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => m.navigate,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: (input: unknown) => m.invalidated.push(input),
  }),
}));
vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useAiAvailability: () => ({ available: m.available }),
}));
vi.mock("@/hooks/use-project-features", () => ({
  useProjectFeatures: () => ({
    isEnabled: (key: string) => key === "pages" && m.pagesOn,
  }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreatePages: () => m.canCreatePages,
    canUpdateTasks: () => m.canUpdateTasks,
  }),
}));
vi.mock("@/hooks/mutations/comment/use-create-comment", () => ({
  default: () => ({
    isPending: false,
    mutate: (
      variables: Record<string, unknown>,
      options: { onSuccess?: () => void },
    ) => {
      m.comments.push(variables);
      options.onSuccess?.();
    },
  }),
}));
vi.mock("@/components/editor/ai/ai-feedback-buttons", () => ({
  default: () => <span data-testid="ai-feedback" />,
}));
vi.mock("@/hooks/mutations/page/use-create-page", () => ({
  useCreatePage: () => ({
    isPending: false,
    mutate: (
      variables: Record<string, unknown>,
      options: { onSuccess?: (page: { id: string }) => void },
    ) => {
      m.created.push(variables);
      options.onSuccess?.({ id: "page-new" });
    },
  }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/fetchers/ai/writing", () => {
  const stream =
    (path: string) =>
    async (
      body: Record<string, unknown>,
      handlers: {
        onDelta?: (text: string) => void;
        onDone?: (done: { stop: string }) => void;
      },
    ) => {
      m.calls.push({ path, body });
      handlers.onDelta?.(m.reply);
      if (m.hold) await m.hold;
      if (m.stop) handlers.onDone?.({ stop: m.stop });
      return m.reply;
    };
  return {
    streamSummary: stream("summarize"),
    streamSpecDraft: stream("spec-draft"),
  };
});

afterEach(cleanup);
beforeEach(() => {
  m.available = true;
  m.pagesOn = true;
  m.canCreatePages = true;
  m.calls = [];
  m.created = [];
  m.invalidated = [];
  m.stop = "end_turn";
  m.hold = null;
  m.canUpdateTasks = true;
  m.comments = [];
});

const summaryProps = {
  kind: "cycle" as const,
  id: "cycle-1",
  projectId: "p-1",
  workspaceId: "ws-1",
  name: "Sprint 9",
};

describe("one-click summaries", () => {
  it("is hidden while AI is unavailable", () => {
    m.available = false;
    const { container } = render(<AiSummaryButton {...summaryProps} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("streams the summary into a dismissible card with Copy and Save as page", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<AiSummaryButton {...summaryProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: "ai:writing.summary.cycle" }),
    );
    expect(m.calls).toEqual([
      {
        path: "summarize",
        body: {
          workspaceId: "ws-1",
          kind: "cycle",
          id: "cycle-1",
          locale: "fr-FR",
        },
      },
    ]);
    const card = await screen.findByRole("dialog", {
      name: "ai:writing.summary.cycle",
    });
    expect(card).toHaveTextContent("On track.");
    expect(card.querySelector("strong")).not.toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /ai:writing.summary.copy/ }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(m.reply));

    fireEvent.click(
      screen.getByRole("button", { name: /ai:writing.summary.saveAsPage/ }),
    );
    expect(m.created).toEqual([
      {
        projectId: "p-1",
        title: 'ai:writing.summary.pageTitle {"name":"Sprint 9"}',
        content: m.reply,
        // Saved AI text carries the AI-generated label.
        aiAssist: { feature: "summarize" },
      },
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "ai:writing.summary.dismiss" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers no Save as page without page:create", async () => {
    m.canCreatePages = false;
    render(<AiSummaryButton {...summaryProps} kind="project" id="p-1" />);
    fireEvent.click(
      screen.getByRole("button", { name: "ai:writing.summary.project" }),
    );
    await screen.findByRole("dialog");
    expect(
      screen.queryByRole("button", { name: /ai:writing.summary.saveAsPage/ }),
    ).toBeNull();
  });
});

describe("task summaries", () => {
  it("summarizes a task and saves it as a comment, not a page", async () => {
    render(
      <AiSummaryButton {...summaryProps} kind="task" id="task-1" name="Fix" />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "ai:writing.summary.task" }),
    );
    expect(m.calls[0]).toEqual({
      path: "summarize",
      body: {
        workspaceId: "ws-1",
        kind: "task",
        id: "task-1",
        locale: "fr-FR",
      },
    });
    await screen.findByRole("dialog", { name: "ai:writing.summary.task" });
    expect(screen.getByTestId("ai-feedback")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /ai:writing.summary.saveAsPage/ }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /ai:writing.summary.saveAsComment/ }),
    );
    expect(m.comments).toEqual([
      {
        taskId: "task-1",
        comment: m.reply,
        aiAssist: { feature: "summarize" },
      },
    ]);
    expect(m.invalidated).toContainEqual({
      queryKey: ["activities", "task-1"],
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers no Save as comment without the right to comment", async () => {
    m.canUpdateTasks = false;
    render(<AiSummaryButton {...summaryProps} kind="task" id="task-1" />);
    fireEvent.click(
      screen.getByRole("button", { name: "ai:writing.summary.task" }),
    );
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: /saveAsComment/ })).toBeNull();
  });
});

const specProps = {
  taskId: "task-1",
  projectId: "p-1",
  workspaceId: "ws-1",
  taskTitle: "Offline mode",
  taskKey: "WEB-12",
};

describe("spec drafts", () => {
  it("is hidden while AI is off, without page:create or with Pages off", () => {
    m.available = false;
    const first = render(<AiSpecDraftButton {...specProps} />);
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();
    m.available = true;
    m.pagesOn = false;
    const second = render(<AiSpecDraftButton {...specProps} />);
    expect(second.container).toBeEmptyDOMElement();
  });

  it("drafts into a preview and creates a page linked to the task", async () => {
    m.reply = "## Problem\n\nUsers lose work.";
    render(<AiSpecDraftButton {...specProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: /ai:writing.spec.button/ }),
    );
    await waitFor(() => expect(m.calls).toHaveLength(1));
    expect(m.calls[0]).toEqual({
      path: "spec-draft",
      body: { workspaceId: "ws-1", taskId: "task-1", locale: "fr-FR" },
    });
    expect(
      await screen.findByRole("heading", { name: "Problem" }),
    ).toBeTruthy();
    expect(m.created).toHaveLength(0);

    fireEvent.click(
      screen.getByRole("button", { name: /ai:writing.spec.edit/ }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "ai:writing.spec.bodyLabel" }),
      { target: { value: "## Problem\n\nEdited." } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /ai:writing.spec.create/ }),
    );

    expect(m.created).toHaveLength(1);
    const page = m.created[0] as {
      title: string;
      content: string;
      projectId: string;
    };
    expect(page.projectId).toBe("p-1");
    expect(page.title).toBe(
      'ai:writing.spec.pageTitle {"title":"Offline mode"}',
    );
    expect(page.content).toContain('task-id="task-1"');
    expect(page.content).toContain('issue-key="WEB-12"');
    expect(page.content).toContain("Edited.");
    expect(m.invalidated).toEqual([
      { queryKey: ["page-task-references", "task-1"] },
    ]);
  });

  it("keeps Create page off while drafting and shows partial text", async () => {
    m.reply = "## Problem\n\nUsers lose";
    let finish = () => {};
    m.hold = new Promise<void>((resolve) => {
      finish = resolve;
    });
    render(<AiSpecDraftButton {...specProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: /ai:writing.spec.button/ }),
    );
    // The first delta shows at once, with the "writing" state.
    expect(
      await screen.findByRole("heading", { name: "Problem" }),
    ).toBeTruthy();
    expect(screen.getByText("ai:writing.preview.generating")).toBeTruthy();
    const create = screen.getByRole("button", {
      name: /ai:writing.spec.create/,
    }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    finish();
    await waitFor(() => expect(create.disabled).toBe(false));
    expect(screen.queryByText("ai:writing.preview.generating")).toBeNull();
    expect(screen.queryByText("ai:writing.preview.incomplete")).toBeNull();
  });

  it("keeps Create page off when the draft is empty", async () => {
    m.reply = "";
    render(<AiSpecDraftButton {...specProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: /ai:writing.spec.button/ }),
    );
    expect(await screen.findByText("ai:writing.preview.empty")).toBeTruthy();
    const create = screen.getByRole("button", {
      name: /ai:writing.spec.create/,
    }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
  });

  it("flags a cut-off draft and blocks one whose stream dropped", async () => {
    m.reply = "## Problem\n\nUsers lose";
    m.stop = "max_tokens";
    const first = render(<AiSpecDraftButton {...specProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: /ai:writing.spec.button/ }),
    );
    expect(
      await screen.findByText("ai:writing.preview.incomplete"),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: /ai:writing.spec.create/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    first.unmount();

    m.stop = null;
    render(<AiSpecDraftButton {...specProps} />);
    fireEvent.click(
      screen.getByRole("button", { name: /ai:writing.spec.button/ }),
    );
    expect(
      await screen.findByText("ai:writing.preview.incomplete"),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: /ai:writing.spec.create/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("escapes the task link's attributes", () => {
    const content = specPageContent({
      url: 'https://x.test/a"b',
      taskId: "t<1>",
      markdown: "Body",
    });
    expect(content).toContain('url="https://x.test/a&quot;b"');
    expect(content).toContain('task-id="t&lt;1&gt;"');
  });
});

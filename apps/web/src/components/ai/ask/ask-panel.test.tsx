import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginSignOut, endSignOut } from "@/lib/sign-out";
import { AskButton } from "./ask-button";
import AskPanel from "./ask-panel";
import { openAsk, useAskPanel } from "./ask-store";

type Handlers = {
  onMeta?: (meta: Record<string, unknown>) => void;
  onDelta?: (text: string) => void;
  onDone?: (done: Record<string, unknown>) => void;
  onError?: (error: { code: string; message: string }) => void;
  onEvent?: (event: string, data: unknown) => void;
};

const m = vi.hoisted(() => ({
  available: true,
  projectAvailable: true,
  features: {
    webSearch: false,
    storeConversations: false,
    autopilot: false,
    speech: false,
    showReasoning: false,
  },
  model: "nemotron-3-ultra:cloud" as string | null,
  skills: [] as Array<{
    id: string;
    name: string;
    description: string | null;
  }>,
  searchResults: [] as Array<Record<string, unknown>>,
  people: [] as Array<{ id: string; name: string; image: null }>,
  agents: [] as Array<{ id: string; name: string; enabled: boolean }>,
  feedback: vi.fn(),
  startRun: vi.fn(),
  summaries: [] as Array<Record<string, unknown>>,
  server: {
    list: [] as Array<Record<string, unknown>>,
    get: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    remove: vi.fn(),
  },
  user: { id: "u1" } as { id: string } | null,
  pathname: "/dashboard/workspace/w1/project/p1/board",
  calls: [] as Array<Record<string, unknown>>,
  reply: null as null | ((handlers: Handlers) => void | Promise<void>),
  navigate: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { resolvedLanguage: "de-DE", language: "de-DE" },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => m.navigate,
  useLocation: ({
    select,
  }: {
    select: (l: { pathname: string; href: string }) => string;
  }) => select({ pathname: m.pathname, href: m.pathname }),
}));
vi.mock("@/hooks/queries/ai/use-ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/queries/ai/use-ai")>()),
  useAiAvailability: (projectId?: string | null) => ({
    available: projectId ? m.available && m.projectAvailable : m.available,
    data: {
      features: m.features,
      model: m.model,
      destination: "local",
    },
  }),
}));
vi.mock("@/hooks/queries/ai/use-ai-assistant", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/hooks/queries/ai/use-ai-assistant")
  >()),
  useAiSkills: () => ({ data: m.skills }),
}));
vi.mock("@/fetchers/ai/conversations", () => ({
  listConversations: async () => m.server.list,
  getConversation: (...args: unknown[]) => m.server.get(...args),
  saveConversation: (...args: unknown[]) => m.server.put(...args),
  updateConversation: (...args: unknown[]) => m.server.patch(...args),
  deleteConversation: (...args: unknown[]) => m.server.remove(...args),
}));
vi.mock("@/hooks/mutations/ai/use-ai-assistant-mutations", () => ({
  useSendAiFeedback: () => ({ mutate: m.feedback }),
}));
vi.mock("@/hooks/mutations/ai/use-agent-mutations", () => ({
  useStartAgentRun: () => ({ mutateAsync: m.startRun }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreatePages: () => true,
    canCreateTasks: () => true,
  }),
}));
vi.mock("@/hooks/queries/search/use-global-search", () => ({
  default: ({ q }: { q: string }) => ({
    data: q ? { results: m.searchResults } : undefined,
    isFetching: false,
  }),
}));
vi.mock("@/components/module/module-people", () => ({
  useWorkspacePeople: () => m.people,
}));
vi.mock("@/hooks/queries/ai/use-agents", () => ({
  useAgents: () => ({ data: m.agents }),
}));
vi.mock("@/components/shared/modals/create-task-modal", () => ({
  default: (props: {
    open: boolean;
    prefill?: { title?: string; description?: string };
  }) =>
    props.open ? (
      <div
        data-testid="create-task"
        data-title={props.prefill?.title}
        data-description={props.prefill?.description}
      />
    ) : null,
}));
vi.mock("@/fetchers/ai/chat-build", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/ai/chat-build")>()),
  streamBuildPlan: async (
    _body: unknown,
    handlers: {
      onContext?: (context: unknown) => void;
      onReasoning?: (text: string) => void;
    },
  ) => {
    handlers.onContext?.({
      facts: { projects: 1, tasks: 3, members: 2, cycles: 0 },
      items: [{ kind: "task", title: "WEB-18 Release notes", url: "/t/18" }],
      memoryNotes: 0,
      earlierTurns: 0,
    });
    handlers.onReasoning?.("WEB-18 is medium now.");
    return {
      status: "proposal",
      summary: "Raise WEB-18 to high.",
      actions: [],
      question: null,
      truncated: false,
      model: "m",
      reasoningMs: 1200,
    };
  },
}));
vi.mock("@/fetchers/ai/writing", () => ({
  streamSummary: async (body: Record<string, unknown>, handlers: Handlers) => {
    m.summaries.push(body);
    handlers.onMeta?.({});
    handlers.onDelta?.("A short summary.");
    handlers.onDone?.({});
    return "";
  },
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [{ id: "p1", name: "Website" }] }),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: m.user }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/fetchers/ai/ask", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/ai/ask")>()),
  streamAsk: async (body: Record<string, unknown>, handlers: Handlers) => {
    m.calls.push(body);
    await m.reply?.(handlers);
    return "";
  },
}));

const STORAGE_KEY = "margaya:ask-history:v1:u1:w1";

let queryClient = new QueryClient();
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: Wrapper });
}

const SOURCE = {
  ref: "T:WEB-12",
  kind: "task",
  id: "t1",
  title: "WEB-12 Fix login",
  url: "/dashboard/workspace/w1/project/p1/task/t1",
  projectId: "p1",
  updatedAt: null,
};

function answerWith(text: string, extra: Record<string, unknown> = {}) {
  m.reply = (handlers) => {
    handlers.onMeta?.({ sources: [SOURCE] });
    handlers.onDelta?.(text);
    handlers.onDone?.({ citations: ["T:WEB-12"], noResults: false, ...extra });
  };
}

function saved() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw
    ? (JSON.parse(raw) as {
        currentId: string | null;
        conversations: Array<{
          id: string;
          projectId: string | null;
          turns: Array<Record<string, unknown>>;
        }>;
      })
    : null;
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  m.features = {
    webSearch: false,
    storeConversations: false,
    autopilot: false,
    speech: false,
    showReasoning: false,
  };
  m.model = "nemotron-3-ultra:cloud";
  m.skills = [];
  m.searchResults = [];
  m.people = [];
  m.agents = [];
  m.feedback.mockReset();
  m.startRun.mockReset();
  m.summaries = [];
  m.server.list = [];
  m.server.get.mockReset();
  m.server.put.mockReset().mockResolvedValue({});
  m.server.patch.mockReset().mockResolvedValue({});
  m.server.remove.mockReset().mockResolvedValue({});
  m.available = true;
  m.projectAvailable = true;
  m.user = { id: "u1" };
  m.calls = [];
  m.reply = null;
  m.navigate.mockReset();
  localStorage.clear();
  useAskPanel.setState({
    open: false,
    projectId: null,
    request: null,
    slot: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function composer() {
  return screen.getByRole("textbox", { name: "ai:ask.placeholder" });
}

async function ask(question: string) {
  const before = m.calls.length;
  fireEvent.change(composer(), { target: { value: question } });
  fireEvent.keyDown(composer(), { key: "Enter" });
  await waitFor(() => expect(m.calls.length).toBeGreaterThan(before));
}

describe("Ask entry points", () => {
  it("shows the sparkle only while AI is available, scoped to the route's project", () => {
    m.available = false;
    const { rerender } = render(<AskButton />);
    expect(screen.queryByRole("button", { name: "ai:ask.title" })).toBeNull();

    m.available = true;
    rerender(<AskButton />);
    fireEvent.click(screen.getByRole("button", { name: "ai:ask.title" }));
    expect(useAskPanel.getState()).toMatchObject({
      open: true,
      projectId: "p1",
    });
  });

  it("opens workspace-wide when AI is off in the route's project", () => {
    m.projectAvailable = false;
    render(<AskButton />);
    fireEvent.click(screen.getByRole("button", { name: "ai:ask.title" }));
    expect(useAskPanel.getState().projectId).toBeNull();
  });

  it("stays closed while AI is unavailable", () => {
    m.available = false;
    render(<AskPanel />);
    act(() => openAsk());
    expect(screen.queryByTestId("ask-panel")).toBeNull();
  });
});

describe("Ask chat window", () => {
  it("docks beside the page without blocking it, and closes on Escape", () => {
    const onBoard = vi.fn();
    render(
      <>
        <button type="button" onClick={onBoard}>
          Board
        </button>
        <AskPanel />
      </>,
    );
    act(() => openAsk());

    const panel = screen.getByRole("dialog", { name: "ai:ask.title" });
    expect(panel.getAttribute("aria-modal")).toBe("false");
    expect(document.activeElement).toBe(composer());

    // The page behind stays reachable and clickable while chatting.
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(onBoard).toHaveBeenCalled();
    expect(screen.getByTestId("ask-panel")).toBeTruthy();

    fireEvent.keyDown(composer(), { key: "Escape" });
    expect(useAskPanel.getState().open).toBe(false);
    expect(screen.queryByTestId("ask-panel")).toBeNull();
  });

  it("toggles a larger size and closes from the header", () => {
    render(<AskPanel />);
    act(() => openAsk());
    const panel = screen.getByTestId("ask-panel");
    fireEvent.click(screen.getByRole("button", { name: "ai:ask.expand" }));
    expect(panel.dataset.expanded).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "ai:ask.collapse" }));
    expect(panel.dataset.expanded).toBeUndefined();
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.close" }),
    );
    expect(useAskPanel.getState().open).toBe(false);
  });

  it("sends a suggestion with one click and shows typing dots until words arrive", async () => {
    let finish = () => {};
    m.reply = (handlers) =>
      new Promise<void>((resolve) => {
        finish = () => {
          handlers.onMeta?.({ sources: [] });
          handlers.onDelta?.("Nothing is overdue.");
          handlers.onDone?.({ citations: [], noResults: false });
          resolve();
        };
      });
    render(<AskPanel />);
    act(() => openAsk({ projectId: "p1" }));
    expect(screen.getByText("ai:ask.greeting")).toBeTruthy();
    // A project gets project suggestions.
    expect(
      screen.getByRole("button", { name: "ai:ask.examples.summarize" }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "ai:ask.examples.overdue" }),
    );
    await waitFor(() => expect(m.calls).toHaveLength(1));
    expect(m.calls[0]?.question).toBe("ai:ask.examples.overdue");
    expect(screen.getByTestId("ask-typing")).toBeTruthy();
    expect(screen.getByRole("button", { name: "ai:ask.stop" })).toBeTruthy();

    await act(async () => finish());
    expect(await screen.findByText("Nothing is overdue.")).toBeTruthy();
    expect(screen.queryByTestId("ask-typing")).toBeNull();
  });

  it("sends on Enter and keeps Shift+Enter for a new line", async () => {
    answerWith("Yes [T:WEB-12]");
    render(<AskPanel />);
    act(() => openAsk());
    fireEvent.change(composer(), { target: { value: "Line one" } });
    fireEvent.keyDown(composer(), { key: "Enter", shiftKey: true });
    expect(m.calls).toHaveLength(0);

    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() => expect(m.calls).toHaveLength(1));
    expect(m.calls[0]?.question).toBe("Line one");
    expect((composer() as HTMLTextAreaElement).value).toBe("");
  });

  it("streams a cited answer into a live region with chips and sources", async () => {
    answerWith("Login is fixed [T:WEB-12]. Not real: [T:NOPE-1]");
    render(<AskPanel />);
    act(() => openAsk({ projectId: "p1" }));
    expect(
      screen.getByText('ai:ask.scopeProject {"project":"Website"}'),
    ).toBeTruthy();
    await ask("Is login fixed?");

    expect(m.calls[0]).toEqual({
      workspaceId: "w1",
      question: "Is login fixed?",
      projectId: "p1",
      locale: "de-DE",
    });
    const region = await screen.findByRole("region", { name: "ai:ask.answer" });
    expect(region.getAttribute("aria-live")).toBe("polite");
    await waitFor(() => expect(region.getAttribute("aria-busy")).toBe("false"));

    const chip = screen.getByRole("link", {
      name: 'ai:ask.openSource {"title":"WEB-12 Fix login"}',
    });
    expect(chip.getAttribute("href")).toBe(SOURCE.url);
    expect(region.textContent).toContain("[T:NOPE-1]");
    expect(screen.getByText('ai:ask.sourcesCount {"total":1}')).toBeTruthy();

    // The docked window stays open beside the page it opened.
    fireEvent.click(chip);
    expect(m.navigate).toHaveBeenCalledWith({ href: SOURCE.url });
    expect(useAskPanel.getState().open).toBe(true);
  });

  it("sends earlier turns for follow-ups and drops them on a new conversation", async () => {
    answerWith("First answer [T:WEB-12]");
    render(<AskPanel />);
    act(() => openAsk());
    await ask("What's overdue?");
    await screen.findByText("ai:ask.copy");

    answerWith("Mia owns it [T:WEB-12]");
    await ask("Who owns it?");
    await waitFor(() => expect(m.calls).toHaveLength(2));
    expect(m.calls[1]?.history).toEqual([
      { question: "What's overdue?", answer: "First answer [T:WEB-12]" },
    ]);
    expect(m.calls[1]?.projectId).toBeUndefined();

    fireEvent.click(
      await screen.findByRole("button", { name: "ai:ask.newChat" }),
    );
    answerWith("Fresh");
    await ask("Again");
    await waitFor(() => expect(m.calls).toHaveLength(3));
    expect(m.calls[2]?.history).toBeUndefined();
  });

  it("says when nothing was found and maps errors to messages", async () => {
    m.reply = (handlers) => {
      handlers.onMeta?.({ sources: [] });
      handlers.onDone?.({ citations: [], noResults: true });
    };
    render(<AskPanel />);
    act(() => openAsk({ question: "quantum flux" }));
    expect(await screen.findByText("ai:ask.noResults")).toBeTruthy();
    expect(m.calls[0]?.question).toBe("quantum flux");

    m.reply = (handlers) =>
      handlers.onError?.({ code: "AI_BUDGET_EXCEEDED", message: "cap" });
    await ask("More?");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "ai:errors.AI_BUDGET_EXCEEDED",
    );
  });

  it("shows an error, never a blank answer, when the model wrote nothing", async () => {
    // The API ends an answer cut off before any text with an error event.
    m.reply = (handlers) => {
      handlers.onMeta?.({ sources: [SOURCE] });
      handlers.onError?.({
        code: "AI_PROVIDER_ERROR",
        message: "The AI model ran out of room before answering.",
      });
    };
    render(<AskPanel />);
    act(() => openAsk({ question: "Is login fixed?" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "ai:errors.AI_PROVIDER_ERROR",
    );

    // A stream that closes without text or `done` is a failure too.
    for (const reply of [
      (handlers: Handlers) => {
        handlers.onMeta?.({ sources: [SOURCE] });
        handlers.onDone?.({ citations: [], noResults: false });
      },
      (handlers: Handlers) => handlers.onMeta?.({ sources: [SOURCE] }),
    ]) {
      m.reply = reply;
      await ask("Again?");
      await waitFor(() =>
        expect(
          screen
            .getAllByRole("alert")
            .map((alert) => alert.textContent)
            .filter((text) => text === "ai:errors.AI_PROVIDER_ERROR"),
        ).toHaveLength(m.calls.length),
      );
    }
  });

  it("copies the answer with plain labels and links", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    answerWith("Fixed [T:WEB-12].");
    render(<AskPanel />);
    act(() => openAsk());
    await ask("Is login fixed?");
    fireEvent.click(await screen.findByRole("button", { name: "ai:ask.copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]?.[0]).toBe(
      `Fixed [WEB-12].\n\nai:ask.sources:\n- WEB-12 Fix login: ${window.location.origin}${SOURCE.url}`,
    );
  });
});

describe("Ask history", () => {
  it("saves the conversation in this browser and restores it after a reload", async () => {
    answerWith("Fixed [T:WEB-12].");
    const first = render(<AskPanel />);
    act(() => openAsk({ projectId: "p1" }));
    await ask("Is login fixed?");
    await screen.findByText("ai:ask.copy");

    const stored = saved();
    expect(stored?.conversations).toHaveLength(1);
    expect(stored?.conversations[0]).toMatchObject({
      projectId: "p1",
      turns: [
        {
          question: "Is login fixed?",
          answer: "Fixed [T:WEB-12].",
          status: "done",
          citations: ["T:WEB-12"],
        },
      ],
    });
    expect(stored?.currentId).toBe(stored?.conversations[0]?.id);

    // A reload: a fresh mount picks the conversation back up.
    first.unmount();
    render(<AskPanel />);
    expect(await screen.findByText("Is login fixed?")).toBeTruthy();
    expect(screen.getByText("ai:ask.copy")).toBeTruthy();

    answerWith("Since Monday [T:WEB-12]");
    await ask("Since when?");
    expect(m.calls[1]?.history).toEqual([
      { question: "Is login fixed?", answer: "Fixed [T:WEB-12]." },
    ]);
    await waitFor(() =>
      expect(saved()?.conversations[0]?.turns).toHaveLength(2),
    );
    expect(saved()?.conversations).toHaveLength(1);
  });

  it("reopens, deletes and clears past conversations", async () => {
    answerWith("Answer one");
    render(<AskPanel />);
    act(() => openAsk());
    await ask("First question");
    await screen.findByText("Answer one");

    fireEvent.click(screen.getByRole("button", { name: "ai:ask.newChat" }));
    answerWith("Answer two");
    await ask("Second question");
    await screen.findByText("Answer two");
    await waitFor(() => expect(saved()?.conversations).toHaveLength(2));

    const historyButton = screen.getByRole("button", {
      name: "ai:ask.history.title",
    });
    fireEvent.click(historyButton);
    expect(historyButton.getAttribute("aria-pressed")).toBe("true");
    const titles = screen
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");
    expect(titles[0]).toContain("Second question");
    expect(titles[1]).toContain("First question");

    // Reopen the first one and continue it.
    fireEvent.click(screen.getByText("First question"));
    expect(await screen.findByText("Answer one")).toBeTruthy();
    expect(screen.queryByText("Answer two")).toBeNull();
    answerWith("Follow-up answer");
    await ask("And then?");
    expect(m.calls.at(-1)?.history).toEqual([
      { question: "First question", answer: "Answer one" },
    ]);
    await screen.findByText("Follow-up answer");

    // Delete the other one.
    fireEvent.click(historyButton);
    const second = screen
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes("Second question"));
    fireEvent.click(
      (second as HTMLElement).querySelector(
        '[aria-label="ai:ask.history.delete"]',
      ) as HTMLElement,
    );
    expect(saved()?.conversations).toHaveLength(1);
    expect(screen.queryByText("Second question")).toBeNull();

    // Clearing asks first.
    fireEvent.click(
      screen.getByRole("button", { name: "ai:ask.history.clear" }),
    );
    expect(screen.getByText("ai:ask.history.clearConfirm")).toBeTruthy();
    expect(saved()?.conversations).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "ai:ask.history.clear" }),
    );
    expect(saved()).toBeNull();
    expect(screen.getByText("ai:ask.history.empty")).toBeTruthy();
  });

  it("still answers when browser storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    answerWith("Works anyway");
    render(<AskPanel />);
    act(() => openAsk());
    await ask("Does it work?");
    expect(await screen.findByText("Works anyway")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "ai:ask.history.title" }),
    );
    expect(screen.getByText("Does it work?")).toBeTruthy();
  });

  it("stores nothing while signed out", async () => {
    m.user = null;
    answerWith("Hello");
    render(<AskPanel />);
    act(() => openAsk());
    await ask("Anyone?");
    await screen.findByText("Hello");
    expect(localStorage.length).toBe(0);
    expect(
      screen.queryByRole("button", { name: "ai:ask.history.title" }),
    ).toBeNull();
  });

  it("forgets saved conversations on sign-out", async () => {
    localStorage.setItem("unrelated", "kept");
    answerWith("Bye");
    render(<AskPanel />);
    act(() => openAsk());
    await ask("Leaving?");
    await screen.findByText("Bye");
    expect(saved()).not.toBeNull();

    act(() => beginSignOut());
    endSignOut();
    expect(saved()).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("kept");
    expect(screen.queryByText("Leaving?")).toBeNull();
  });
});

function controlled() {
  let handlers: Handlers = {};
  let resolve = () => {};
  m.reply = (next) =>
    new Promise<void>((done) => {
      handlers = next;
      resolve = done;
    });
  return {
    get handlers() {
      return handlers;
    },
    finish: () => resolve(),
  };
}

describe("Ask composer", () => {
  it("adds @ context as chips and sends it with the question", async () => {
    m.searchResults = [
      {
        id: "t9",
        type: "task",
        title: "Fix login",
        projectSlug: "WEB",
        taskNumber: 12,
        projectId: "p1",
      },
      { id: "c1", type: "comment", title: "ignored" },
    ];
    m.people = [{ id: "u2", name: "Webster Mia", image: null }];
    answerWith("Done [T:WEB-12]");
    render(<AskPanel />);
    act(() => openAsk());
    expect(composer().getAttribute("placeholder")).toBe("ai:ask.placeholder");

    fireEvent.change(composer(), { target: { value: "@web" } });
    const listbox = await screen.findByRole("listbox", {
      name: "ai:ask.contextPicker",
    });
    const options = within(listbox).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "WEB-12 Fix loginai:ask.contextKinds.task",
      "Webster Miaai:ask.contextKinds.user",
    ]);
    fireEvent.keyDown(composer(), { key: "Enter" });
    expect(
      screen.getByRole("button", {
        name: 'ai:ask.removeChip {"name":"WEB-12 Fix login"}',
      }),
    ).toBeTruthy();
    expect((composer() as HTMLTextAreaElement).value).toBe("");

    await ask("Is it fixed?");
    expect(m.calls[0]?.context).toEqual([{ kind: "task", id: "t9" }]);
    // Chips belong to one question.
    expect(
      screen.queryByRole("button", {
        name: 'ai:ask.removeChip {"name":"WEB-12 Fix login"}',
      }),
    ).toBeNull();
  });

  it("runs / commands: summarize the scoped project and use a skill", async () => {
    m.skills = [{ id: "s1", name: "release-notes", description: null }];
    render(<AskPanel />);
    act(() => openAsk({ projectId: "p1" }));

    fireEvent.change(composer(), { target: { value: "/sum" } });
    const menu = await screen.findByRole("listbox", {
      name: "ai:ask.commandMenu",
    });
    expect(within(menu).getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(composer(), { key: "Enter" });
    expect(await screen.findByText("A short summary.")).toBeTruthy();
    expect(m.summaries).toEqual([
      { workspaceId: "w1", kind: "project", id: "p1", locale: "de-DE" },
    ]);
    expect(
      screen.getByText('ai:ask.commands.summarizeTurn {"name":"Website"}'),
    ).toBeTruthy();

    fireEvent.change(composer(), { target: { value: "/rel" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    expect(
      screen.getByRole("button", {
        name: 'ai:ask.removeChip {"name":"release-notes"}',
      }),
    ).toBeTruthy();
    answerWith("Notes");
    await ask("For cycle 4");
    expect(m.calls.at(-1)?.skillId).toBe("s1");

    // /chart fills the composer instead of sending.
    fireEvent.change(composer(), { target: { value: "/chart" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    expect((composer() as HTMLTextAreaElement).value).toBe(
      "ai:ask.commands.chartPrefill ",
    );
  });

  it("shows web search only when the workspace allows it and sends it", async () => {
    render(<AskPanel />);
    act(() => openAsk());
    expect(
      screen.queryByRole("button", { name: "ai:ask.webSearch" }),
    ).toBeNull();
    cleanup();

    m.features = { ...m.features, webSearch: true };
    render(<AskPanel />);
    act(() => openAsk());
    const globe = screen.getByRole("button", { name: "ai:ask.webSearch" });
    fireEvent.click(globe);
    expect(globe.getAttribute("aria-pressed")).toBe("true");
    answerWith("From the web");
    await ask("Latest release of React?");
    expect(m.calls[0]?.webSearch).toBe(true);
  });

  it("offers Build and Autopilot modes only as allowed", () => {
    render(<AskPanel />);
    act(() => openAsk());
    const modes = screen.getByRole("group", {
      name: "ai:ask.modes.label",
    });
    expect(
      within(modes)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["ai:ask.modes.ask", "ai:ask.modes.build"]);
    cleanup();
    m.features = { ...m.features, autopilot: true };
    render(<AskPanel />);
    act(() => openAsk());
    expect(
      within(
        screen.getByRole("group", { name: "ai:ask.modes.label" }),
      ).getAllByRole("button"),
    ).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "ai:ask.modes.build" }));
    expect(composer().getAttribute("placeholder")).toBe(
      "ai:ask.placeholderBuild",
    );
  });

  it("lists a Build request once in a new conversation", async () => {
    render(<AskPanel />);
    act(() => openAsk());
    fireEvent.click(screen.getByRole("button", { name: "ai:ask.modes.build" }));
    fireEvent.change(composer(), { target: { value: "Make WEB-18 high" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    expect(await screen.findByText("Raise WEB-18 to high.")).toBeTruthy();
    expect(screen.getAllByText("Make WEB-18 high")).toHaveLength(1);
    // What it read and how long it thought stay with the turn.
    expect(screen.getByTestId("build-context")).toBeTruthy();
    expect(screen.getByText('ai:ask.thinking.done {"seconds":1}')).toBeTruthy();
  });
});

describe("Ask answers", () => {
  it("shows the model, thinking time and reasoning, then follow-ups", async () => {
    const stream = controlled();
    render(<AskPanel />);
    act(() => openAsk());
    expect(screen.getByTestId("ask-model").textContent).toBe(
      "nemotron-3-ultra:cloud · ai:destinations.local",
    );
    fireEvent.change(composer(), { target: { value: "How many?" } });
    fireEvent.keyDown(composer(), { key: "Enter" });
    await waitFor(() => expect(m.calls).toHaveLength(1));
    // Dots until the first token.
    expect(screen.getByTestId("ask-typing")).toBeTruthy();

    act(() => {
      stream.handlers.onMeta?.({
        sources: [],
        provider: "openai_compatible",
        model: "minimax-m3",
        destination: "cloud",
      });
      stream.handlers.onEvent?.("reasoning", { text: "Let me count." });
    });
    expect(screen.queryByTestId("ask-typing")).toBeNull();
    expect(screen.getByText('ai:ask.thinking.live {"seconds":0}')).toBeTruthy();
    // The reasoning is open while the model thinks.
    expect(screen.getByTestId("ask-thinking").textContent).toContain(
      "Let me count.",
    );
    expect(screen.getByTestId("ask-model").textContent).toBe(
      "minimax-m3 · ai:destinations.cloud",
    );

    await act(async () => {
      stream.handlers.onDelta?.("Twelve.");
      stream.handlers.onDone?.({
        citations: [],
        noResults: false,
        reasoningMs: 20_000,
        followUps: ["Chart it", "Who owns these?"],
      });
      stream.finish();
    });
    expect(
      await screen.findByText('ai:ask.thinking.done {"seconds":20}'),
    ).toBeTruthy();
    // Folded once the answer is in; a click opens it again.
    expect(screen.getByTestId("ask-thinking").textContent).not.toContain(
      "Let me count.",
    );
    fireEvent.click(screen.getByText('ai:ask.thinking.done {"seconds":20}'));
    expect(screen.getByTestId("ask-thinking").textContent).toContain(
      "Let me count.",
    );
    const followUps = screen.getByRole("list", { name: "ai:ask.followUps" });
    answerWith("A chart");
    fireEvent.click(
      within(followUps).getByRole("button", { name: "Chart it" }),
    );
    await waitFor(() => expect(m.calls).toHaveLength(2));
    expect(m.calls[1]?.question).toBe("Chart it");
    // Reasoning text is never saved; its duration is.
    await waitFor(() =>
      expect(saved()?.conversations[0]?.turns).toHaveLength(2),
    );
    expect(JSON.stringify(saved())).not.toContain("Let me count.");
    expect(saved()?.conversations[0]?.turns[0]).toMatchObject({
      reasoningMs: 20_000,
    });
  });

  it("sends thumbs up, and thumbs down with a reason, with the answer's model", async () => {
    m.reply = (handlers) => {
      handlers.onMeta?.({
        sources: [],
        provider: "anthropic",
        model: "claude-x",
        destination: "cloud",
      });
      handlers.onDelta?.("Yes.");
      handlers.onDone?.({ citations: [], noResults: false });
    };
    render(<AskPanel />);
    act(() => openAsk());
    await ask("First?");
    fireEvent.click(
      await screen.findByRole("button", { name: "ai:ask.feedback.up" }),
    );
    expect(m.feedback).toHaveBeenCalledWith({
      workspaceId: "w1",
      feature: "ask",
      rating: 1,
      provider: "anthropic",
      model: "claude-x",
    });
    expect(screen.getByText("ai:ask.feedback.thanks")).toBeTruthy();

    await ask("Second?");
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "ai:ask.feedback.down" }),
      ).toHaveLength(2),
    );
    const down = screen.getAllByRole("button", {
      name: "ai:ask.feedback.down",
    })[1] as HTMLElement;
    fireEvent.click(down);
    // Nothing is sent until the reason is given or skipped.
    expect(m.feedback).toHaveBeenCalledTimes(1);
    fireEvent.change(
      screen.getByRole("textbox", { name: "ai:ask.feedback.reasonLabel" }),
      { target: { value: "Wrong count" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "ai:ask.feedback.send" }),
    );
    expect(m.feedback).toHaveBeenLastCalledWith(
      expect.objectContaining({ rating: -1, reason: "Wrong count" }),
    );
  });

  it("regenerates the last answer and keeps both versions", async () => {
    answerWith("First take");
    render(<AskPanel />);
    act(() => openAsk());
    await ask("Summarize");
    answerWith("Second take");
    fireEvent.click(
      await screen.findByRole("button", { name: "ai:ask.regenerate" }),
    );
    expect(await screen.findByText("Second take")).toBeTruthy();
    expect(m.calls).toHaveLength(2);
    expect(m.calls[1]?.question).toBe("Summarize");
    expect(m.calls[1]?.history).toBeUndefined();
    expect(screen.getByText("2/2")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "ai:ask.versions.previous" }),
    );
    expect(screen.getByText("First take")).toBeTruthy();
    expect(screen.queryByText("Second take")).toBeNull();
    expect(screen.getByText("1/2")).toBeTruthy();
  });

  it("edits a question and asks again, dropping what came after", async () => {
    answerWith("Answer A");
    render(<AskPanel />);
    act(() => openAsk());
    await ask("Question A");
    answerWith("Answer B");
    await ask("Question B");
    await screen.findByText("Answer B");

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "ai:ask.editQuestion",
      })[0] as HTMLElement,
    );
    const editor = screen.getByRole("textbox", {
      name: "ai:ask.editQuestion",
    });
    fireEvent.change(editor, { target: { value: "Question A, edited" } });
    answerWith("Answer A2");
    fireEvent.click(screen.getByRole("button", { name: "ai:ask.resend" }));
    expect(await screen.findByText("Answer A2")).toBeTruthy();
    expect(m.calls.at(-1)?.question).toBe("Question A, edited");
    expect(m.calls.at(-1)?.history).toBeUndefined();
    expect(screen.queryByText("Question B")).toBeNull();
    expect(screen.queryByText("Answer B")).toBeNull();
  });

  it("turns an answer into a task with the answer as its description", async () => {
    answerWith("Fix the login [T:WEB-12].");
    render(<AskPanel />);
    act(() => openAsk({ projectId: "p1" }));
    await ask("What should we do?");
    fireEvent.click(
      await screen.findByRole("button", { name: "ai:ask.moreActions" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "ai:ask.createTask" }),
    );
    const dialog = await screen.findByTestId("create-task");
    expect(dialog.dataset.title).toBe("What should we do?");
    expect(dialog.dataset.description).toBe(
      `Fix the login [WEB-12](${window.location.origin}${SOURCE.url}).`,
    );
  });
});

describe("Ask history: names, pins, search and the server", () => {
  it("renames, pins and searches conversations", async () => {
    answerWith("One");
    render(<AskPanel />);
    act(() => openAsk());
    await ask("Alpha question");
    await screen.findByText("One");
    fireEvent.click(screen.getByRole("button", { name: "ai:ask.newChat" }));
    answerWith("Two");
    await ask("Beta question");
    await screen.findByText("Two");
    await waitFor(() => expect(saved()?.conversations).toHaveLength(2));
    const alphaSaved = () =>
      saved()?.conversations.find(
        (item) => item.turns[0]?.question === "Alpha question",
      );

    fireEvent.click(
      screen.getByRole("button", { name: "ai:ask.history.title" }),
    );
    const alpha = screen
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes("Alpha question"));
    fireEvent.click(
      within(alpha as HTMLElement).getByRole("button", {
        name: "ai:ask.history.rename",
      }),
    );
    const name = screen.getByRole("textbox", {
      name: "ai:ask.history.renameLabel",
    });
    fireEvent.change(name, { target: { value: "Launch plan" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(alphaSaved()).toMatchObject({ title: "Launch plan" });

    const renamed = screen
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes("Launch plan"));
    fireEvent.click(
      within(renamed as HTMLElement).getByRole("button", {
        name: "ai:ask.history.pin",
      }),
    );
    expect(screen.getAllByRole("listitem")[0]?.textContent).toContain(
      "Launch plan",
    );
    expect(alphaSaved()).toMatchObject({ pinned: true });

    fireEvent.change(
      screen.getByRole("searchbox", { name: "ai:ask.history.search" }),
      { target: { value: "beta" } },
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "ai:ask.history.search" }),
      { target: { value: "nothing like it" } },
    );
    expect(screen.getByText("ai:ask.history.noMatches")).toBeTruthy();
  });

  it("keeps history on the server when the workspace does, and imports this browser's", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        currentId: null,
        conversations: [
          {
            id: "local-conv-1",
            projectId: null,
            createdAt: 1,
            updatedAt: 1,
            turns: [{ question: "Local q", answer: "Local a", status: "done" }],
          },
        ],
      }),
    );
    m.features = { ...m.features, storeConversations: true };
    m.server.list = [
      {
        id: "server-conv-1",
        title: "Old chat",
        projectId: null,
        pinned: true,
        turnCount: 1,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    ];
    m.server.get.mockResolvedValue({
      id: "server-conv-1",
      title: "Old chat",
      projectId: null,
      pinned: true,
      turns: [{ question: "Old q", answer: "Old a", status: "done" }],
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    render(<AskPanel />);
    act(() => openAsk());
    fireEvent.click(
      screen.getByRole("button", { name: "ai:ask.history.title" }),
    );
    expect(await screen.findByText("Old chat")).toBeTruthy();
    expect(screen.getByText("ai:ask.history.serverNote")).toBeTruthy();

    // A one-time import of what this browser kept.
    fireEvent.click(
      screen.getByRole("button", { name: "ai:ask.history.import" }),
    );
    await waitFor(() =>
      expect(m.server.put).toHaveBeenCalledWith(
        "local-conv-1",
        expect.objectContaining({ workspaceId: "w1", title: "Local q" }),
      ),
    );
    await waitFor(() => expect(saved()?.conversations ?? []).toHaveLength(0));

    fireEvent.click(screen.getByText("Old chat"));
    expect(await screen.findByText("Old a")).toBeTruthy();
    expect(m.server.get).toHaveBeenCalledWith("w1", "server-conv-1");

    answerWith("New a");
    await ask("New q");
    await waitFor(() =>
      expect(m.server.put).toHaveBeenCalledWith(
        "server-conv-1",
        expect.objectContaining({
          workspaceId: "w1",
          title: "Old chat",
          pinned: true,
        }),
      ),
    );
    const body = m.server.put.mock.calls.at(-1)?.[1] as { turns: unknown[] };
    expect(body.turns).toHaveLength(2);
    // Nothing goes to this browser's storage in server mode.
    expect(saved()?.conversations ?? []).toHaveLength(0);
  });

  it("renders at full width on the AI page with history alongside", () => {
    const slot = document.createElement("div");
    document.body.appendChild(slot);
    render(<AskPanel />);
    act(() => useAskPanel.setState({ slot }));
    const panel = slot.querySelector('[data-testid="ask-panel"]');
    expect(panel?.getAttribute("data-full-page")).toBe("true");
    expect(slot.querySelector("aside")).toBeTruthy();
    // Close goes back to the page the full view was opened from.
    act(() => useAskPanel.setState({ returnTo: "/dashboard/x/board" }));
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.close" }),
    );
    expect(m.navigate).toHaveBeenCalledWith({ href: "/dashboard/x/board" });
    expect(useAskPanel.getState().returnTo).toBeNull();
    act(() => useAskPanel.setState({ slot: null }));
    slot.remove();
  });
});

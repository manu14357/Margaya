import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CodingAgentProfile,
  CodingAgentTask,
  CodingHandoff,
} from "@/fetchers/coding-agent/coding-agent";
import { CodingHandoffTimeline, handoffSteps } from "./coding-handoff-timeline";
import { profilesFor, SendToCodingAgentButton } from "./send-to-coding-agent";

const m = vi.hoisted(() => ({
  data: null as unknown,
  prepared: [] as unknown[],
  sent: [] as unknown[],
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "en-US", resolvedLanguage: "en-US" },
  }),
}));
vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useAiAvailability: () => ({ available: false }),
}));
vi.mock("@/components/editor/ai/use-editor-ai", () => ({
  useAiLocale: () => "de-DE",
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/hooks/queries/coding-agent/use-coding-agent", () => ({
  useTaskCodingAgents: () => ({ data: m.data }),
  usePrepareCodingAgentBrief: () => ({
    isPending: false,
    error: null,
    mutate: (
      input: unknown,
      options?: { onSuccess?: (result: unknown) => void },
    ) => {
      m.prepared.push(input);
      options?.onSuccess?.({
        title: "API-3: Rate limit",
        brief: "## Task\nRate limit the API",
        aiUsed: false,
        relatedTasks: 0,
        linkedPages: 0,
      });
    },
  }),
  useSendToCodingAgent: () => ({
    isPending: false,
    mutate: (input: unknown) => {
      m.sent.push(input);
    },
  }),
}));

function profile(
  id: string,
  providers: Array<"github" | "gitea">,
  extra: Partial<CodingAgentProfile> = {},
): CodingAgentProfile {
  return {
    id,
    builtin: null,
    name: id,
    mention: "",
    assignee: null,
    enabled: true,
    providers,
    ...extra,
  };
}

function handoff(extra: Partial<CodingHandoff> = {}): CodingHandoff {
  return {
    id: "h1",
    provider: "github",
    profileName: "Claude Code (GitHub Action)",
    issueNumber: 41,
    issueUrl: "https://github.com/acme/web/issues/41",
    prNumber: null,
    prUrl: null,
    prTitle: null,
    state: "issue_created",
    sentBy: { id: "u1", name: "Mia" },
    createdAt: "2026-10-21T10:00:00.000Z",
    workingAt: null,
    readyAt: null,
    finishedAt: null,
    ...extra,
  };
}

beforeEach(() => {
  m.data = null;
  m.prepared = [];
  m.sent = [];
});
afterEach(cleanup);

describe("handoffSteps", () => {
  it("marks steps done from the timestamps", () => {
    const steps = handoffSteps(
      handoff({
        state: "ready_for_review",
        workingAt: "2026-10-21T11:00:00.000Z",
        readyAt: "2026-10-21T12:00:00.000Z",
      }),
    );
    expect(steps.map((s) => [s.key, s.done])).toEqual([
      ["issue_created", true],
      ["working", true],
      ["ready_for_review", true],
      ["merged", false],
    ]);
  });

  it("ends with 'closed' for a pull request closed without merging", () => {
    const steps = handoffSteps(
      handoff({
        state: "closed",
        workingAt: "2026-10-21T11:00:00.000Z",
        finishedAt: "2026-10-21T13:00:00.000Z",
      }),
    );
    expect(steps.at(-1)).toMatchObject({ key: "closed", done: true });
  });
});

describe("profilesFor", () => {
  it("keeps GitHub-only profiles away from Gitea repositories", () => {
    const list = [
      profile("claude", ["github", "gitea"]),
      profile("copilot", ["github"]),
    ];
    const gitea = {
      integrationId: "i2",
      provider: "gitea" as const,
      name: "acme/api",
      ready: true,
    };
    expect(profilesFor(list, gitea).map((p) => p.id)).toEqual(["claude"]);
    expect(profilesFor(list, { ...gitea, provider: "github" })).toHaveLength(2);
    expect(profilesFor(list, undefined)).toEqual([]);
  });
});

describe("CodingHandoffTimeline", () => {
  it("shows who sent it, the issue and pull request, and the steps", () => {
    m.data = {
      repositories: [],
      profiles: [],
      canSend: true,
      handoffs: [
        handoff({
          state: "working",
          workingAt: "2026-10-21T11:00:00.000Z",
          prNumber: 5,
          prUrl: "https://github.com/acme/web/pull/5",
        }),
      ],
    } satisfies CodingAgentTask;
    render(<CodingHandoffTimeline taskId="t1" />);
    expect(screen.getByText(/ai:codingAgent.sentBy/).textContent).toContain(
      '"name":"Mia"',
    );
    expect(
      screen
        .getByText(/ai:codingAgent.issueLink/)
        .closest("a")
        ?.getAttribute("href"),
    ).toBe("https://github.com/acme/web/issues/41");
    expect(
      screen
        .getByText(/ai:codingAgent.prLink/)
        .closest("a")
        ?.getAttribute("href"),
    ).toBe("https://github.com/acme/web/pull/5");
    expect(screen.getByText("ai:codingAgent.steps.working")).toBeTruthy();
    expect(screen.getByText("ai:codingAgent.steps.merged")).toBeTruthy();
  });

  it("renders nothing without handoffs", () => {
    m.data = { repositories: [], profiles: [], canSend: true, handoffs: [] };
    const { container } = render(<CodingHandoffTimeline taskId="t1" />);
    expect(container.textContent).toBe("");
  });
});

describe("SendToCodingAgentButton", () => {
  const giteaTask = (): CodingAgentTask => ({
    repositories: [
      { integrationId: "i2", provider: "gitea", name: "acme/api", ready: true },
    ],
    profiles: [
      profile("copilot", ["github"], { name: "Copilot" }),
      profile("codex", ["github", "gitea"], {
        name: "Codex",
        mention: "@codex",
      }),
    ],
    handoffs: [],
    canSend: true,
  });

  it("is hidden without task:update or without a repository", () => {
    m.data = { ...giteaTask(), canSend: false };
    const first = render(
      <SendToCodingAgentButton taskId="t1" projectId="p1" />,
    );
    expect(first.container.textContent).toBe("");
    first.unmount();
    m.data = { ...giteaTask(), repositories: [] };
    const second = render(
      <SendToCodingAgentButton taskId="t1" projectId="p1" />,
    );
    expect(second.container.textContent).toBe("");
  });

  it("prepares the brief, lets the person edit it, and sends it", async () => {
    m.data = giteaTask();
    render(<SendToCodingAgentButton taskId="t1" projectId="p1" />);
    fireEvent.click(screen.getByText("ai:codingAgent.button"));
    await waitFor(() => expect(m.prepared).toHaveLength(1));
    expect(m.prepared[0]).toMatchObject({
      taskId: "t1",
      integrationId: "i2",
      useAi: false,
    });
    const textarea = (await screen.findByLabelText(
      "ai:codingAgent.briefLabel",
    )) as HTMLTextAreaElement;
    expect(textarea.value).toContain("Rate limit the API");
    fireEvent.change(textarea, { target: { value: "## Goal\nEdited brief" } });
    fireEvent.click(screen.getByText("ai:codingAgent.send"));
    expect(m.sent).toEqual([
      {
        taskId: "t1",
        integrationId: "i2",
        // Copilot (an assignee) does not work on Gitea, so Codex is used.
        profileId: "codex",
        title: "API-3: Rate limit",
        brief: "## Goal\nEdited brief",
      },
    ]);
  });
});

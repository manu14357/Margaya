import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentReplyCard } from "./agent-reply-card";

const m = vi.hoisted(() => ({
  run: { data: undefined as unknown },
  useAgentRun: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => (
    <a href="/agents">{children}</a>
  ),
}));
vi.mock("@/components/ai/ai-markdown", () => ({
  default: ({ text }: { text: string }) => <p>{text}</p>,
}));
vi.mock("@/hooks/queries/ai/use-agents", () => ({
  useAgentRun: m.useAgentRun,
}));
vi.mock("./run-reply", () => ({
  NeedsInputPanel: ({ question }: { question: { options: string[] } }) => (
    <div data-testid="answer">{question.options.join(",")}</div>
  ),
}));

const props = {
  workspaceId: "ws-1",
  runId: "run-1",
  agentName: "Spec writer",
  text: "Which release should this go in?",
};

beforeEach(() => {
  m.run = { data: undefined };
  m.useAgentRun.mockImplementation(() => m.run);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AgentReplyCard", () => {
  it("answers a question that still waits right in the inbox", () => {
    m.run = {
      data: {
        status: "needs_input",
        question: { text: props.text, options: ["2.4", "2.5"] },
      },
    };
    render(<AgentReplyCard {...props} needsInput />);
    expect(m.useAgentRun).toHaveBeenCalledWith("ws-1", "run-1");
    expect(screen.getByTestId("answer")).toHaveTextContent("2.4,2.5");
  });

  it("links to the Agent Desk once the question was answered", () => {
    m.run = { data: { status: "running", question: null } };
    render(<AgentReplyCard {...props} needsInput />);
    expect(screen.queryByTestId("answer")).toBeNull();
    expect(screen.getByText("ai:agents.run.viewInDesk")).toBeInTheDocument();
    expect(
      screen.queryByText("ai:agents.needsInput.inboxHint"),
    ).not.toBeInTheDocument();
  });

  it("keeps the notification's wording while the run loads", () => {
    render(<AgentReplyCard {...props} needsInput />);
    expect(screen.getByText(props.text)).toBeInTheDocument();
    expect(screen.getByText("ai:agents.needsInput.answer")).toBeInTheDocument();
  });

  it("does not load the run for a plain answer", () => {
    render(<AgentReplyCard {...props} />);
    expect(m.useAgentRun).toHaveBeenCalledWith("ws-1", null);
    expect(screen.getByText("ai:agents.reply.hint")).toBeInTheDocument();
  });
});

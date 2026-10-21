import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FollowUpBox, NeedsInputPanel } from "./run-reply";

const m = vi.hoisted(() => ({
  reply: vi.fn(async () => ({ id: "run-1", status: "queued" })),
  followUp: vi.fn(async () => ({ id: "run-2", status: "queued" })),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/mutations/ai/use-agent-mutations", () => ({
  useReplyToAgentRun: () => ({ isPending: false, mutateAsync: m.reply }),
  useFollowUpAgentRun: () => ({ isPending: false, mutateAsync: m.followUp }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NeedsInputPanel", () => {
  const question = {
    text: "Which release should this go in?",
    options: ["2.4", "2.5"],
  };

  it("shows the question and its options", () => {
    render(
      <NeedsInputPanel workspaceId="ws-1" runId="run-1" question={question} />,
    );
    expect(
      screen.getByText("Which release should this go in?"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2.4" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2.5" })).toBeInTheDocument();
  });

  it("answers with an option in one click", async () => {
    render(
      <NeedsInputPanel workspaceId="ws-1" runId="run-1" question={question} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "2.5" }));
    await waitFor(() =>
      expect(m.reply).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        runId: "run-1",
        text: "2.5",
      }),
    );
  });

  it("sends a typed answer", async () => {
    render(
      <NeedsInputPanel
        workspaceId="ws-1"
        runId="run-1"
        question={{ text: "Why?", options: [] }}
      />,
    );
    const reply = screen.getByRole("button", {
      name: "ai:agents.needsInput.reply",
    });
    expect(reply).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText("ai:agents.needsInput.answerLabel"),
      { target: { value: "  Because of the audit  " } },
    );
    fireEvent.click(reply);
    await waitFor(() =>
      expect(m.reply).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        runId: "run-1",
        text: "Because of the audit",
      }),
    );
  });
});

describe("FollowUpBox", () => {
  it("starts a follow-up run and hands over its id", async () => {
    const onStarted = vi.fn();
    render(
      <FollowUpBox workspaceId="ws-1" runId="run-1" onStarted={onStarted} />,
    );
    fireEvent.change(screen.getByLabelText("ai:agents.followUp.label"), {
      target: { value: "Now add acceptance criteria" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "ai:agents.followUp.send" }),
    );
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("run-2"));
    expect(m.followUp).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      runId: "run-1",
      text: "Now add acceptance criteria",
    });
  });
});

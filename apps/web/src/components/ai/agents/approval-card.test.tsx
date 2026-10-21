import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalCard } from "./approval-card";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children?: ReactNode }) => (
    <a href="/agents" {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/mutations/ai/use-agent-mutations", () => ({
  useDecideAgentApproval: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/queries/ai/use-agents", () => ({
  useAgentRun: () => ({
    isLoading: false,
    data: {
      agent: { name: "Triage bot" },
      steps: [
        {
          toolName: null,
          status: "awaiting_approval",
          change: null,
          approval: {
            id: "ap-1",
            status: "pending",
            canDecide: true,
            expiresAt: "2026-10-23T09:00:00.000Z",
          },
        },
      ],
    },
  }),
}));
vi.mock("./change-preview", () => ({ ChangePreview: () => null }));

afterEach(cleanup);

const props = { workspaceId: "ws-1", runId: "run-1", approvalId: "ap-1" };

describe("ApprovalCard", () => {
  it("links to the Agent Desk from the inbox", () => {
    render(<ApprovalCard {...props} />);
    expect(
      screen.getByRole("button", { name: "ai:agents.change.approve" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ai:agents.run.viewInDesk")).toBeInTheDocument();
  });

  it("drops the Agent Desk link inside the Agent Desk", () => {
    render(<ApprovalCard {...props} showDeskLink={false} />);
    expect(
      screen.getByRole("button", { name: "ai:agents.change.approve" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("ai:agents.run.viewInDesk")).toBeNull();
  });
});

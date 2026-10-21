import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTemplate } from "@/fetchers/ai/agents";
import { draftFromTemplate } from "./agent-template-picker";
import { AgentDialog } from "./agents-settings";

const STANDUP: AgentTemplate = {
  id: "standup",
  name: "Standup",
  instructions: "You write short standup summaries for a project.",
  role: "member",
  modelTier: "fast",
  suggestedTriggers: ["schedule"],
  suggestedSchedule: { cron: "0 9 * * 1-5", prompt: "Write the standup." },
};
const TRIAGE: AgentTemplate = {
  id: "triage",
  name: "Triage",
  instructions: "You triage new tasks.",
  role: "member",
  modelTier: "deep",
  suggestedTriggers: ["assign", "automation"],
  suggestedSchedule: null,
};

const m = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/hooks/queries/ai/use-agents", () => ({
  useAgents: () => ({ data: [], isLoading: false }),
  useAgentTemplates: () => ({ data: [TRIAGE, STANDUP] }),
}));
vi.mock("@/hooks/mutations/ai/use-agent-mutations", () => ({
  useCreateAgent: () => ({ isPending: false, mutateAsync: m.create }),
  useUpdateAgent: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteAgent: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/queries/ai/use-ai", () => ({
  useAiAvailability: () => ({ data: { destination: "cloud" } }),
}));
vi.mock("@/hooks/queries/workspace/use-grantable-roles", () => ({
  default: () => ({ roles: ["viewer", "member"] }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ role: "owner" }),
}));
vi.mock("./agent-access-fields", () => ({ AgentAccessFields: () => null }));
vi.mock("./agent-schedules", () => ({ AgentSchedulesDialog: () => null }));
vi.mock("./connectors-settings", () => ({ ConnectorsSection: () => null }));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(cleanup);

describe("draftFromTemplate", () => {
  it("takes the translated name and the template's settings", () => {
    expect(draftFromTemplate((key) => `T:${key}`, STANDUP)).toEqual({
      name: "T:ai:agents.templates.standup.name",
      instructions: "You write short standup summaries for a project.",
      role: "member",
      modelTier: "fast",
    });
  });

  it("keeps an unknown template's own name", () => {
    expect(
      draftFromTemplate((key) => key, { ...TRIAGE, id: "future", name: "X" })
        .name,
    ).toBe("X");
  });
});

describe("the new-agent form", () => {
  it("fills the fields from a chosen template", () => {
    render(<AgentDialog workspaceId="ws-1" agent={null} onClose={vi.fn()} />);
    const name = screen.getByLabelText(
      "ai:agents.fields.name",
    ) as HTMLInputElement;
    const instructions = screen.getByLabelText(
      "ai:agents.fields.instructions",
    ) as HTMLTextAreaElement;
    expect(name.value).toBe("");

    fireEvent.click(
      screen.getByRole("button", {
        name: /ai:agents\.templates\.standup\.name/,
      }),
    );
    expect(name.value).toBe("ai:agents.templates.standup.name");
    expect(instructions.value).toBe(STANDUP.instructions);
    expect(
      screen.getByRole("button", {
        name: /ai:agents\.templates\.standup\.name/,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    // The suggested trigger shows as a hint.
    expect(
      screen.getAllByText("ai:agents.templates.triggers.schedule").length,
    ).toBeGreaterThan(0);
  });

  it("starts blank and shows no picker when editing", () => {
    render(
      <AgentDialog
        workspaceId="ws-1"
        agent={{
          id: "a1",
          userId: "u1",
          name: "Bot",
          description: null,
          image: null,
          role: "member",
          enabled: true,
          modelTier: "balanced",
          providerOverride: null,
          instructions: "Old",
          monthlyBudgetMicros: null,
          monthSpendMicros: 0,
          projectIds: null,
          skillIds: [],
          webAccess: false,
          ownerId: null,
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
        }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("ai:agents.templates.title")).toBeNull();
  });
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@/fetchers/ai/agents";
import { HttpError } from "@/lib/http-error";
import {
  AgentIntakeTriggerDialog,
  intakeTriggerErrorKey,
} from "./agent-intake-trigger";

const m = vi.hoisted(() => ({ save: vi.fn(), close: vi.fn() }));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values?.name ? `${key}:${values.name}` : key,
  }),
}));
vi.mock("@/hooks/mutations/ai/use-agent-mutations", () => ({
  useSetAgentIntakeTrigger: () => ({ isPending: false, mutateAsync: m.save }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function agent(trigger: Agent["intakeTrigger"]): Agent {
  return {
    id: "a1",
    userId: "u1",
    name: "Intake Bot",
    description: null,
    image: null,
    role: "member",
    enabled: true,
    modelTier: "fast",
    providerOverride: null,
    instructions: "",
    monthlyBudgetMicros: null,
    monthSpendMicros: 0,
    projectIds: null,
    skillIds: [],
    webAccess: false,
    intakeTrigger: trigger,
    ownerId: null,
    createdAt: "2026-10-29T00:00:00.000Z",
    updatedAt: "2026-10-29T00:00:00.000Z",
  };
}

const OFF = { enabled: false, prompt: null, runsAs: null };

afterEach(() => {
  cleanup();
  m.save.mockReset();
  m.close.mockReset();
});

describe("agent intake trigger", () => {
  it("turns the trigger on with a prompt for this workspace", async () => {
    m.save.mockResolvedValue({});
    render(
      <AgentIntakeTriggerDialog
        workspaceId="ws-1"
        agent={agent(OFF)}
        onClose={m.close}
      />,
    );
    const toggle = screen.getByRole("switch", {
      name: "ai:agents.intakeTrigger.enabled",
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText("ai:agents.intakeTrigger.runsAsYou"),
    ).toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText("ai:agents.intakeTrigger.prompt"), {
      target: { value: "  Suggest labels  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "ai:agents.save" }));
    await waitFor(() =>
      expect(m.save).toHaveBeenCalledWith({
        agentId: "a1",
        trigger: {
          workspaceId: "ws-1",
          enabled: true,
          prompt: "Suggest labels",
        },
      }),
    );
    await waitFor(() => expect(m.close).toHaveBeenCalled());
  });

  it("shows who the runs act for and saves an empty prompt as the default", async () => {
    m.save.mockResolvedValue({});
    render(
      <AgentIntakeTriggerDialog
        workspaceId="ws-1"
        agent={agent({
          enabled: true,
          prompt: null,
          runsAs: { id: "u2", name: "Owen" },
        })}
        onClose={m.close}
      />,
    );
    expect(
      screen.getByRole("switch", { name: "ai:agents.intakeTrigger.enabled" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText("ai:agents.intakeTrigger.runsAs:Owen"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("switch", { name: "ai:agents.intakeTrigger.enabled" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "ai:agents.save" }));
    await waitFor(() =>
      expect(m.save).toHaveBeenCalledWith({
        agentId: "a1",
        trigger: { workspaceId: "ws-1", enabled: false, prompt: null },
      }),
    );
  });

  it("explains a refusal and stays open", async () => {
    m.save.mockRejectedValue(
      new HttpError(
        400,
        JSON.stringify({ code: "AGENT_CANT_READ_INTAKE", message: "x" }),
      ),
    );
    render(
      <AgentIntakeTriggerDialog
        workspaceId="ws-1"
        agent={agent(OFF)}
        onClose={m.close}
      />,
    );
    fireEvent.click(
      screen.getByRole("switch", { name: "ai:agents.intakeTrigger.enabled" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "ai:agents.save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ai:agents.intakeTrigger.errors.AGENT_CANT_READ_INTAKE",
    );
    expect(m.close).not.toHaveBeenCalled();
  });

  it("maps errors to messages", () => {
    expect(intakeTriggerErrorKey(new HttpError(403, "no"))).toBe(
      "ai:agents.intakeTrigger.errors.forbidden",
    );
    expect(intakeTriggerErrorKey(new Error("boom"))).toBe(
      "ai:agents.intakeTrigger.saveError",
    );
  });
});

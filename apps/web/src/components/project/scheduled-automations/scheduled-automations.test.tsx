import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScheduledAutomations from "./scheduled-automations";

type Automations = Record<string, unknown>;

const m = vi.hoisted(() => ({
  canUpdate: true,
  automations: undefined as Automations | undefined,
  columns: [] as Array<Record<string, unknown>>,
  update: vi.fn(),
  preview: vi.fn(),
  success: vi.fn(),
  cyclesEnabled: true,
  leadUserId: "u-lead" as string | null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateProjects: () => m.canUpdate,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/queries/project-automation/use-project-automations", () => ({
  useProjectAutomations: () => ({
    data: m.automations,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/project-automation/use-automation-preview", () => ({
  useAutomationPreview: () => ({ data: { count: 0, capped: false } }),
  useFetchAutomationPreview: () => m.preview,
}));
vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: () => ({ data: m.columns }),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({
    data: {
      id: "p1",
      cyclesEnabled: m.cyclesEnabled,
      leadUserId: m.leadUserId,
    },
  }),
}));
vi.mock(
  "@/hooks/mutations/project-automation/use-update-project-automations",
  () => ({ useUpdateProjectAutomations: () => ({ mutateAsync: m.update }) }),
);
vi.mock("@/lib/toast", () => ({
  toast: { success: m.success, error: vi.fn() },
}));

function automations(
  overrides: {
    autoArchive?: Automations;
    autoClose?: Automations;
    cycleRollover?: Automations;
    flowAlerts?: Automations;
  } = {},
): Automations {
  return {
    projectId: "p1",
    autoArchive: {
      enabled: false,
      months: 3,
      lastArchivedAt: null,
      lastArchivedCount: 0,
      ...overrides.autoArchive,
    },
    autoClose: {
      enabled: false,
      months: 3,
      columnId: null,
      column: null,
      state: "off",
      pausedReason: null,
      lastClosedAt: null,
      lastClosedCount: 0,
      ...overrides.autoClose,
    },
    cycleRollover: {
      enabled: false,
      since: null,
      lastRolledOverAt: null,
      lastRolledOverCount: 0,
      ...overrides.cycleRollover,
    },
    flowAlerts: {
      enabled: false,
      lastCheckedOn: null,
      lastAlertAt: null,
      ...overrides.flowAlerts,
    },
    lastCheckedAt: null,
    updatedAt: null,
    updatedBy: null,
  };
}

const cancelledColumn = {
  id: "col-x",
  slug: "wont-do",
  name: "Won't do",
  icon: null,
  group: "cancelled",
  position: 4,
};

const archiveSwitch = () =>
  screen.getByRole("switch", {
    name: "settings:projectAutomations.autoArchive.title",
  });
const closeSwitch = () =>
  screen.getByRole("switch", {
    name: "settings:projectAutomations.autoClose.title",
  });

const rolloverSwitch = () =>
  screen.getByRole("switch", {
    name: "settings:projectAutomations.cycleRollover.title",
  });

beforeEach(() => {
  m.cyclesEnabled = true;
  m.leadUserId = "u-lead";
  m.canUpdate = true;
  m.automations = automations();
  m.columns = [cancelledColumn];
  m.update.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ScheduledAutomations", () => {
  it("disables the switches without project:update", () => {
    m.canUpdate = false;
    render(<ScheduledAutomations projectId="p1" />);
    expect(archiveSwitch()).toHaveAttribute("aria-disabled", "true");
    expect(closeSwitch()).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("settings:projectAutomations.noPermission"),
    ).toBeTruthy();
  });

  it("needs a Cancelled column for auto-close", () => {
    m.columns = [];
    render(<ScheduledAutomations projectId="p1" />);
    expect(closeSwitch()).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText(
        "settings:projectAutomations.autoClose.noCancelledColumn",
      ),
    ).toBeTruthy();
  });

  it("turns a rule on at once when no task matches", async () => {
    m.preview.mockResolvedValue({ count: 0, capped: false });
    render(<ScheduledAutomations projectId="p1" />);
    fireEvent.click(archiveSwitch());
    await waitFor(() =>
      expect(m.update).toHaveBeenCalledWith({
        workspaceId: "w1",
        projectId: "p1",
        patch: { autoArchive: { enabled: true } },
      }),
    );
    expect(m.preview).toHaveBeenCalledWith("archive", 3);
    expect(m.success).toHaveBeenCalledWith(
      "settings:projectAutomations.toast.archiveOn",
    );
  });

  it("asks first when tasks already match, and saves only on confirm", async () => {
    m.preview.mockResolvedValue({ count: 12, capped: false });
    render(<ScheduledAutomations projectId="p1" />);
    fireEvent.click(closeSwitch());
    expect(
      await screen.findByText(
        "settings:projectAutomations.confirmClose.titleOn",
      ),
    ).toBeTruthy();
    expect(m.update).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByText("settings:projectAutomations.confirm.turnOn"),
    );
    await waitFor(() =>
      expect(m.update).toHaveBeenCalledWith({
        workspaceId: "w1",
        projectId: "p1",
        patch: { autoClose: { enabled: true, columnId: "col-x" } },
      }),
    );
  });

  it("turns a rule off without asking", async () => {
    m.automations = automations({ autoArchive: { enabled: true } });
    render(<ScheduledAutomations projectId="p1" />);
    fireEvent.click(archiveSwitch());
    await waitFor(() =>
      expect(m.update).toHaveBeenCalledWith({
        workspaceId: "w1",
        projectId: "p1",
        patch: { autoArchive: { enabled: false } },
      }),
    );
    expect(m.preview).not.toHaveBeenCalled();
  });

  it("warns while auto-close is paused", () => {
    m.automations = automations({
      autoClose: { enabled: true, state: "paused", pausedReason: "no_column" },
    });
    render(<ScheduledAutomations projectId="p1" />);
    expect(
      screen.getByText("settings:projectAutomations.autoClose.paused"),
    ).toBeTruthy();
  });

  it("shows what each rule that is on did last", () => {
    m.automations = automations({ autoArchive: { enabled: true } });
    render(<ScheduledAutomations projectId="p1" />);
    expect(
      screen.getByText("settings:projectAutomations.neverArchived"),
    ).toBeTruthy();
    expect(
      screen.getByText("settings:projectAutomations.preview.none"),
    ).toBeTruthy();
  });

  it("turns cycle rollover on with one patch, and blocks it while cycles are off", async () => {
    render(<ScheduledAutomations projectId="p1" />);
    fireEvent.click(rolloverSwitch());
    await waitFor(() =>
      expect(m.update).toHaveBeenCalledWith({
        workspaceId: "w1",
        projectId: "p1",
        patch: { cycleRollover: { enabled: true } },
      }),
    );
    expect(m.success).toHaveBeenCalledWith(
      "settings:projectAutomations.toast.rolloverOn",
    );
    cleanup();

    m.cyclesEnabled = false;
    render(<ScheduledAutomations projectId="p1" />);
    expect(rolloverSwitch()).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("settings:projectAutomations.cycleRollover.cyclesOff"),
    ).toBeTruthy();
  });

  it("turns flow alerts on, and warns when the project has no lead", async () => {
    const flowSwitch = () =>
      screen.getByRole("switch", {
        name: "settings:projectAutomations.flowAlerts.title",
      });
    render(<ScheduledAutomations projectId="p1" />);
    expect(
      screen.queryByText("settings:projectAutomations.flowAlerts.noLead"),
    ).toBeNull();
    fireEvent.click(flowSwitch());
    await waitFor(() =>
      expect(m.update).toHaveBeenCalledWith({
        workspaceId: "w1",
        projectId: "p1",
        patch: { flowAlerts: { enabled: true } },
      }),
    );
    expect(m.success).toHaveBeenCalledWith(
      "settings:projectAutomations.toast.flowAlertsOn",
    );
    cleanup();

    m.leadUserId = null;
    m.automations = automations({ flowAlerts: { enabled: true } });
    render(<ScheduledAutomations projectId="p1" />);
    expect(
      screen.getByText("settings:projectAutomations.flowAlerts.noLead"),
    ).toBeTruthy();
    expect(
      screen.getByText("settings:projectAutomations.flowAlerts.never"),
    ).toBeTruthy();
  });
});

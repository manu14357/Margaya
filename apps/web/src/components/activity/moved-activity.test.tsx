import enUS from "@i18n/en-US.json";
import { cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Timeline } from "@/components/ui/timeline";
import Activity from "./index";

const i18n = i18next.createInstance();

beforeAll(async () => {
  await i18n.init({
    lng: "en-US",
    resources: { "en-US": enUS },
    defaultNS: "common",
    interpolation: { escapeValue: false },
  });
});

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(i18n.t(key, options as never)),
  }),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));

vi.mock("@/hooks/queries/workspace-users/use-get-workspace-users", () => ({
  default: () => ({
    data: [{ user: { id: "user-1", name: "Ada", image: null } }],
  }),
}));

afterEach(() => cleanup());

function renderMoved(eventData: Record<string, unknown>) {
  render(
    <Timeline>
      <Activity
        step={1}
        activity={{
          id: "activity-1",
          type: "moved",
          content: null,
          eventData,
          createdAt: "2026-03-01T10:00:00.000Z",
          userId: "user-1",
          taskId: "task-1",
        }}
      />
    </Timeline>,
  );
}

function renderRow(type: string, eventData: Record<string, unknown>) {
  render(
    <Timeline>
      <Activity
        step={1}
        activity={{
          id: "activity-1",
          type,
          content: null,
          eventData,
          createdAt: "2026-03-01T10:00:00.000Z",
          userId: "user-1",
          taskId: "task-1",
        }}
      />
    </Timeline>,
  );
}

describe.each([
  [
    "cycle_changed",
    {
      oldCycleId: null,
      oldCycleName: null,
      oldCycleHidden: true,
      newCycleId: null,
      newCycleName: null,
    },
    "removed the task from a cycle",
  ],
  [
    "cycle_changed",
    {
      oldCycleId: null,
      oldCycleName: null,
      newCycleId: null,
      newCycleName: null,
      newCycleHidden: true,
    },
    "added the task to a cycle",
  ],
  [
    "cycle_changed",
    {
      oldCycleId: null,
      oldCycleName: null,
      oldCycleHidden: true,
      newCycleId: "c2",
      newCycleName: "Sprint 2",
    },
    "moved the task from another cycle to Sprint 2",
  ],
  [
    "cycle_changed",
    {
      oldCycleId: "c1",
      oldCycleName: "Sprint 1",
      newCycleId: null,
      newCycleName: null,
      newCycleHidden: true,
    },
    "moved the task from cycle Sprint 1 to another cycle",
  ],
  [
    "cycle_changed",
    {
      oldCycleId: null,
      oldCycleName: null,
      oldCycleHidden: true,
      newCycleId: null,
      newCycleName: null,
      newCycleHidden: true,
    },
    "moved the task between cycles",
  ],
  [
    "module_added",
    { moduleId: null, moduleName: null, moduleHidden: true },
    "added the task to a module",
  ],
  [
    "module_removed",
    { moduleId: null, moduleName: null, moduleHidden: true },
    "removed the task from a module",
  ],
  [
    "status_changed",
    { oldStatus: null, newStatus: null, statusHidden: true },
    "changed status in another project",
  ],
  [
    "intake_accepted",
    { columnName: null, status: null, columnHidden: true },
    "accepted this request into another project",
  ],
  [
    "intake_duplicate",
    { duplicateKey: null, duplicateHidden: true },
    "marked this request as a duplicate of a task in another project",
  ],
] as const)("a redacted %s row", (type, eventData, copy) => {
  it(`reads "${copy}"`, () => {
    renderRow(type, eventData);
    expect(screen.getByText(copy)).toBeInTheDocument();
  });
});

describe("moved activity entries", () => {
  it("names both projects when the reader can see them", () => {
    renderMoved({ fromProjectName: "Web", toProjectName: "Ops" });
    expect(
      screen.getByText('moved task from "Web" to "Ops"'),
    ).toBeInTheDocument();
  });

  it("says another project for the side the API won't name", () => {
    renderMoved({
      fromProjectName: null,
      fromProjectHidden: true,
      toProjectName: "Ops",
    });
    expect(
      screen.getByText('moved task from another project to "Ops"'),
    ).toBeInTheDocument();
    cleanup();

    renderMoved({
      fromProjectName: "Web",
      toProjectName: null,
      toProjectHidden: true,
    });
    expect(
      screen.getByText('moved task from "Web" to another project'),
    ).toBeInTheDocument();
    cleanup();

    renderMoved({
      fromProjectName: null,
      fromProjectHidden: true,
      toProjectName: null,
      toProjectHidden: true,
    });
    expect(
      screen.getByText("moved task between other projects"),
    ).toBeInTheDocument();
  });
});

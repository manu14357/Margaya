import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useOpenTaskStore from "@/components/task/task-shortcuts/open-task-store";
import CommandPalette from "./index";
import { openCommandPalette } from "./palette-store";

type Handlers = Record<string, Record<string, () => void>>;
const m = vi.hoisted(() => ({
  navigate: vi.fn(),
  modifierShortcuts: {} as Handlers,
  openView: vi.fn(),
  searchQueries: [] as Array<{ q: string; type?: string }>,
  setWeekStart: vi.fn(),
  lockPage: vi.fn(),
  openAsk: vi.fn(),
  openBuild: vi.fn(),
}));

vi.mock("./use-view-commands", () => ({
  useViewCommands: () => ({
    label: "Views",
    items: [{ value: "view:v1", label: "Sprint board", onRun: m.openView }],
    dialog: null,
  }),
}));

vi.mock("../page/use-page-commands", () => ({
  usePageCommands: () => [],
}));

vi.mock("../ai/ask/use-ask-commands", () => ({
  useAskCommands: ({ term }: { term: string }) => ({
    items: [{ value: "ask-ai", label: "Ask AI…", onRun: m.openAsk }],
    askItems: term
      ? [
          {
            value: `ask-ai:${term}`,
            label: `Ask AI: ${term}`,
            onRun: m.openAsk,
          },
        ]
      : [],
  }),
}));

vi.mock("../ai-build/use-build-with-ai-command", () => ({
  useBuildWithAiCommand: (projectId: string | undefined) => ({
    items: [
      {
        value: "build-with-ai",
        label: "Build with AI…",
        onRun: () => m.openBuild(projectId),
      },
    ],
    dialog: null,
  }),
}));

vi.mock("./use-preference-commands", () => ({
  usePreferenceCommands: () => [
    {
      value: "preference-week-start",
      label: "First day of week",
      hint: "Sunday",
      onRun: () => {},
      submenu: () => ({
        label: "First day of week",
        items: [
          { value: "week-start:0", label: "Sunday", onRun: () => {} },
          {
            value: "week-start:1",
            label: "Monday",
            onRun: () => m.setWeekStart(1),
          },
        ],
      }),
    },
  ],
}));

vi.mock("../feedback/use-feedback-command", () => ({
  useFeedbackCommand: () => [],
}));

vi.mock("./entity-commands", async () => {
  const { useEffect } = await import("react");
  return {
    EntityCommandsSource: ({
      onGroup,
    }: {
      onGroup: (group: unknown) => void;
    }) => {
      useEffect(() => {
        onGroup({
          value: "this-page",
          label: "Roadmap notes",
          items: [{ value: "page:lock", label: "Lock", onRun: m.lockPage }],
        });
      }, [onGroup]);
      return null;
    },
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => m.navigate,
  useLocation: () => ({ pathname: "/dashboard/workspace/w1" }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));
vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  useRegisterShortcuts: (options: { modifierShortcuts?: Handlers }) => {
    m.modifierShortcuts = options.modifierShortcuts ?? {};
  },
  getModifierKeyText: () => "Ctrl",
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: {} }),
}));
vi.mock("@/hooks/use-project-features", () => ({
  useProjectFeatures: () => ({ isEnabled: () => false }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateIntake: () => false,
    canReadAnalytics: () => true,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: null }) },
}));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: () => ({ setTheme: vi.fn() }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({
    data: [{ id: "p1", name: "Website relaunch", slug: "WEB", icon: null }],
  }),
}));
vi.mock("@/hooks/queries/recent-visit/use-get-recent-visits", () => ({
  default: () => ({ data: [] }),
}));
vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: (workspaceId: string) => ({
      data: workspaceId
        ? {
            members: [
              {
                id: "m1",
                user: { name: "Ana Ruiz", email: "ana@example.com" },
              },
              {
                id: "m2",
                user: { name: "Ravi Iyer", email: "ravi@example.com" },
              },
            ],
          }
        : undefined,
    }),
  }),
);
vi.mock("@/hooks/queries/search/use-global-search", () => ({
  default: ({ q, type }: { q: string; type?: string }) => {
    m.searchQueries.push({ q, type });
    return {
      data: q
        ? {
            results: [
              {
                id: "t2",
                title: "Fix login redirect loop",
                type: "task",
                projectId: "p1",
                projectSlug: "WEB",
                taskNumber: 2,
              },
              {
                id: "c9",
                title: "Login sprint",
                type: "cycle",
                projectId: "p1",
                projectName: "Website relaunch",
              },
            ],
          }
        : undefined,
    };
  },
}));
vi.mock("@/components/search-command-menu", () => ({ default: () => null }));
vi.mock("@/components/shared/modals/create-task-modal", () => ({
  default: () => null,
}));
vi.mock("@/components/shared/modals/create-workspace-modal", () => ({
  default: () => null,
}));
vi.mock("@/components/intake/create-intake-dialog", () => ({
  default: () => null,
}));
vi.mock("../shared/modals/create-project-modal", () => ({
  default: () => null,
}));

afterEach(() => {
  cleanup();
  m.navigate.mockClear();
  m.searchQueries = [];
  useOpenTaskStore.setState({ taskId: null, title: null, commands: [] });
});

function openPalette() {
  act(() => {
    for (const group of Object.values(m.modifierShortcuts)) {
      for (const open of Object.values(group)) open();
    }
  });
}

function typeQuery(value: string) {
  const input = screen.getByPlaceholderText(
    "navigation:commandPalette.inputPlaceholder",
  );
  fireEvent.change(input, { target: { value } });
}

describe("CommandPalette", () => {
  it("offers Ask AI, and asks AI about the typed text", async () => {
    render(<CommandPalette />);
    openPalette();
    expect(screen.getByRole("option", { name: "Ask AI…" })).toBeTruthy();

    typeQuery("why did we drop sso");
    fireEvent.click(
      await screen.findByRole("option", {
        name: "Ask AI: why did we drop sso",
      }),
    );
    await waitFor(() => expect(m.openAsk).toHaveBeenCalled());
  });

  it("offers Build with AI among the actions", async () => {
    render(<CommandPalette />);
    openPalette();
    fireEvent.click(screen.getByRole("option", { name: "Build with AI…" }));
    await waitFor(() => expect(m.openBuild).toHaveBeenCalled());
  });

  it("opens the workspace members page from the Members command", () => {
    render(<CommandPalette />);
    act(() => {
      for (const group of Object.values(m.modifierShortcuts)) {
        for (const open of Object.values(group)) open();
      }
    });

    fireEvent.click(screen.getByRole("option", { name: "Members" }));

    expect(m.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/members",
      params: { workspaceId: "w1" },
    });
  });

  it("opens workspace analytics for people who can read it", () => {
    render(<CommandPalette />);
    act(() => {
      for (const group of Object.values(m.modifierShortcuts)) {
        for (const open of Object.values(group)) open();
      }
    });

    fireEvent.click(
      screen.getByRole("option", {
        name: "navigation:commandPalette.goToAnalytics",
      }),
    );

    expect(m.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/analytics",
      params: { workspaceId: "w1" },
    });
  });

  it("lists saved views in their own group and opens one", () => {
    render(<CommandPalette />);
    act(() => {
      for (const group of Object.values(m.modifierShortcuts)) {
        for (const open of Object.values(group)) open();
      }
    });

    expect(screen.getByText("Views")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Sprint board" }));
    expect(m.openView).toHaveBeenCalledTimes(1);
  });

  it("narrows to actions with the > prefix", () => {
    render(<CommandPalette />);
    openPalette();
    typeQuery(">create");

    expect(
      screen.getByRole("option", {
        name: /navigation:commandPalette.createTask/,
      }),
    ).toBeInTheDocument();
    // Places are not actions.
    expect(screen.queryByRole("option", { name: "Members" })).toBeNull();
  });

  it("jumps to places and projects with the / prefix", () => {
    render(<CommandPalette />);
    openPalette();
    typeQuery("/web");

    fireEvent.click(screen.getByRole("option", { name: /Website relaunch/ }));
    expect(m.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
      params: { workspaceId: "w1", projectId: "p1" },
    });
  });

  it("finds people with the @ prefix", () => {
    render(<CommandPalette />);
    openPalette();
    typeQuery("@ravi");

    expect(
      screen.getByRole("option", { name: /Ravi Iyer/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Ana Ruiz/ })).toBeNull();
  });

  it("searches tasks only with the # prefix and opens one", () => {
    render(<CommandPalette />);
    openPalette();
    typeQuery("#WEB-2");

    expect(m.searchQueries.at(-1)).toEqual({ q: "WEB-2", type: "tasks" });
    fireEvent.click(
      screen.getByRole("option", { name: /Fix login redirect loop/ }),
    );
    expect(m.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
      params: { workspaceId: "w1", projectId: "p1", taskId: "t2" },
    });
  });

  it("opens from the shell's command field, pre-filled", () => {
    render(<CommandPalette />);
    act(() => openCommandPalette("#"));

    expect(
      screen.getByPlaceholderText(
        "navigation:commandPalette.placeholders.tasks",
      ),
    ).toHaveValue("#");
  });

  it("stays as it was with no task open", () => {
    render(<CommandPalette />);
    openPalette();

    expect(screen.queryByText("tasks:commands.group")).toBeNull();
    expect(screen.queryByRole("option", { name: /Copy title/ })).toBeNull();
  });

  it("puts the open task's commands first", () => {
    const copyTitle = vi.fn();
    useOpenTaskStore.setState({
      taskId: "t1",
      title: "WEB-1 Fix login",
      commands: [
        { id: "copyTitle", label: "Copy title", run: copyTitle },
        {
          id: "estimate",
          label: "Change estimate",
          picker: true,
          // Its picker is not on screen (feature off or no system).
          isAvailable: () => false,
          run: vi.fn(),
        },
      ],
    });
    render(<CommandPalette />);
    openPalette();

    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Copy title");
    expect(screen.getByText("tasks:commands.group")).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Change estimate/ }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("option", { name: /Copy title/ }));
    expect(copyTitle).toHaveBeenCalledTimes(1);
  });

  it("filters the open task's commands with the rest", () => {
    useOpenTaskStore.setState({
      taskId: "t1",
      title: "WEB-1 Fix login",
      commands: [
        { id: "copyTitle", label: "Copy title", run: vi.fn() },
        { id: "copyLink", label: "Copy link", run: vi.fn() },
      ],
    });
    render(<CommandPalette />);
    openPalette();
    typeQuery(">link");

    expect(
      screen.getByRole("option", { name: /Copy link/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Copy title/ })).toBeNull();
  });

  it("opens a picker only once the palette is gone, keeping its focus", async () => {
    // A slow close (a busy page): the palette stays mounted for 200 ms.
    const slowClose = () => [
      { finished: new Promise<void>((resolve) => setTimeout(resolve, 200)) },
    ];
    Object.defineProperty(HTMLElement.prototype, "getAnimations", {
      value: slowClose,
      configurable: true,
    });
    const picker = document.createElement("button");
    const before = document.createElement("button");
    document.body.append(before, picker);
    let paletteGoneAtRun = false;
    const openStatus = vi.fn(() => {
      paletteGoneAtRun =
        document.querySelector("[data-slot='command-dialog-popup']") === null;
      picker.focus();
    });
    useOpenTaskStore.setState({
      taskId: "t1",
      title: "WEB-1 Fix login",
      commands: [
        { id: "status", label: "Change status", picker: true, run: openStatus },
      ],
    });
    render(<CommandPalette />);
    before.focus();
    openPalette();

    fireEvent.click(screen.getByRole("option", { name: /Change status/ }));
    expect(openStatus).not.toHaveBeenCalled();

    await waitFor(() => expect(openStatus).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    expect(paletteGoneAtRun).toBe(true);
    // The palette's focus return must not pull focus off the picker.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.activeElement).toBe(picker);
    before.remove();
    picker.remove();
    Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
  });

  it("opens a preference list in place and runs a choice", () => {
    render(<CommandPalette />);
    openPalette();

    fireEvent.click(screen.getByRole("option", { name: /First day of week/ }));
    expect(
      screen.getByPlaceholderText("First day of week"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Members" })).toBeNull();

    fireEvent.click(screen.getByRole("option", { name: "Monday" }));
    expect(m.setWeekStart).toHaveBeenCalledWith(1);
  });

  it("goes back from a preference list with Backspace in an empty field", () => {
    render(<CommandPalette />);
    openPalette();

    fireEvent.click(screen.getByRole("option", { name: /First day of week/ }));
    fireEvent.keyDown(document, { key: "Backspace" });
    expect(screen.getByRole("option", { name: "Members" })).toBeInTheDocument();
  });

  it("lists the open page's commands first", () => {
    render(<CommandPalette />);
    openPalette();

    expect(screen.getByText("Roadmap notes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Lock" }));
    expect(m.lockPage).toHaveBeenCalledTimes(1);
  });

  it("opens cycles found by search", () => {
    render(<CommandPalette />);
    openPalette();
    typeQuery("login");

    fireEvent.click(screen.getByRole("option", { name: /Login sprint/ }));
    expect(m.navigate).toHaveBeenCalledWith({
      href: "/dashboard/workspace/w1/project/p1/cycles/c9",
    });
  });
});

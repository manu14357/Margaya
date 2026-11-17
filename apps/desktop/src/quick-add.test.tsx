import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickAdd } from "./quick-add";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

let draftListener: (() => void) | null = null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_event: string, handler: () => void) => {
    draftListener = handler;
    return () => {
      draftListener = null;
    };
  },
}));

const server = (id: string, signedIn: boolean) => ({
  id,
  label: `Server ${id}`,
  webUrl: `https://${id}.example`,
  apiUrl: `https://${id}.example`,
  serverVersion: "1.0.0",
  signedIn,
  unread: 0,
  insecure: false,
  lastUsedAt: null,
});

const targets = [
  {
    workspaceId: "w1",
    workspaceName: "Team",
    projects: [
      { id: "p1", name: "Web" },
      { id: "p2", name: "Mobile" },
    ],
  },
];

const emptyDraft = {
  revision: 0,
  title: null,
  description: null,
  attachments: [],
  notices: [],
};

type Overrides = Record<string, unknown>;

function mockCommands(overrides: Overrides = {}) {
  const answers: Overrides = {
    list_servers: [server("a", false), server("b", true)],
    quick_add_targets: targets,
    quick_add_members: [
      { id: "u1", name: "Ada Lovelace", handle: "ada" },
      { id: "u2", name: "Grace Hopper", handle: "grace" },
    ],
    quick_add_prefs: { serverId: null, workspaceId: null, projectId: null },
    quick_add_draft: emptyDraft,
    quick_add_create: { taskId: "t1", url: "https://b.example/task" },
    ...overrides,
  };
  invoke.mockImplementation(async (command: string) => {
    const answer = answers[command];
    return typeof answer === "function" ? answer() : answer;
  });
}

function titleBox() {
  return screen.getByRole("textbox", {
    name: "quickAdd.taskTitle",
  }) as HTMLInputElement;
}

function createCall() {
  return invoke.mock.calls.find(([command]) => command === "quick_add_create");
}

async function ready() {
  await screen.findByRole("option", { name: "Web" });
  // Members load after the project is chosen.
  await vi.waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("quick_add_members", {
      serverId: "b",
      workspaceId: "w1",
    }),
  );
}

describe("QuickAdd", () => {
  beforeEach(() => {
    invoke.mockReset();
    draftListener = null;
  });
  afterEach(cleanup);

  it("creates a task in the chosen project of a signed-in server", async () => {
    mockCommands();
    render(<QuickAdd initialServerId="a" />);

    // Server "a" is signed out, so the only signed-in server is used.
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("quick_add_targets", {
        serverId: "b",
      }),
    );
    await ready();
    fireEvent.change(titleBox(), { target: { value: "  Ship the release  " } });
    fireEvent.click(screen.getByRole("button", { name: "quickAdd.create" }));

    expect(await screen.findByText(/quickAdd\.created/)).toBeTruthy();
    expect(createCall()?.[1]).toEqual({
      serverId: "b",
      workspaceId: "w1",
      projectId: "p1",
      title: "Ship the release",
      details: undefined,
      attachmentIds: undefined,
    });
  });

  it("asks to sign in when no server is signed in", async () => {
    mockCommands({ list_servers: [server("a", false)] });
    render(<QuickAdd initialServerId={null} />);
    expect(await screen.findByText("quickAdd.noServers")).toBeTruthy();
  });

  it("reads a date, priority and assignee from the title", async () => {
    mockCommands();
    render(<QuickAdd initialServerId={null} />);
    await ready();
    fireEvent.change(titleBox(), {
      target: { value: "Ship it !high @ada tomorrow" },
    });

    await vi.waitFor(() =>
      expect(
        within(
          screen.getByRole("list", { name: "quickAdd.detected" }),
        ).getAllByRole("listitem"),
      ).toHaveLength(3),
    );
    const chips = screen.getByRole("list", { name: "quickAdd.detected" });
    expect(within(chips).getByText("quickAdd.priorityChip")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "quickAdd.create" }));
    await screen.findByText(/quickAdd\.created/);
    const tomorrow = new Date();
    const expected = new Date(
      tomorrow.getFullYear(),
      tomorrow.getMonth(),
      tomorrow.getDate() + 1,
    );
    expect(createCall()?.[1]).toEqual({
      serverId: "b",
      workspaceId: "w1",
      projectId: "p1",
      title: "Ship it",
      details: {
        priority: "high",
        assigneeIds: ["u1"],
        dueDate: expected.toISOString(),
      },
      attachmentIds: undefined,
    });
    // The form is empty again for the next task.
    expect(titleBox().value).toBe("");
  });

  it("keeps the words of a removed chip in the title", async () => {
    mockCommands();
    render(<QuickAdd initialServerId={null} />);
    await ready();
    fireEvent.change(titleBox(), { target: { value: "Fix !high" } });
    fireEvent.click(
      await screen.findByRole("button", { name: "quickAdd.removeChip" }),
    );
    expect(
      screen.queryByRole("list", { name: "quickAdd.detected" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "quickAdd.create" }));
    await screen.findByText(/quickAdd\.created/);
    expect(createCall()?.[1]).toMatchObject({
      title: "Fix !high",
      details: undefined,
    });
  });

  it("warns about an unknown name and leaves it in the title", async () => {
    mockCommands();
    render(<QuickAdd initialServerId={null} />);
    await ready();
    fireEvent.change(titleBox(), { target: { value: "Ask @nobody" } });
    expect(await screen.findByText("quickAdd.unknownAssignee")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "quickAdd.create" }));
    await screen.findByText(/quickAdd\.created/);
    expect(createCall()?.[1]).toMatchObject({ title: "Ask @nobody" });
  });

  it("can't create a task whose title is only tokens", async () => {
    mockCommands();
    render(<QuickAdd initialServerId={null} />);
    await ready();
    fireEvent.change(titleBox(), { target: { value: "tomorrow !1" } });
    const create = screen.getByRole("button", {
      name: "quickAdd.create",
    }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
  });

  it("opens with a draft from a screenshot or the clipboard", async () => {
    mockCommands({
      quick_add_draft: {
        revision: 3,
        title: "From the clipboard",
        description: "More lines",
        attachments: [
          {
            id: "a1",
            name: "Screenshot.png",
            size: 2048,
            image: true,
            preview: "data:image/png;base64,AAAA",
          },
          { id: "a2", name: "notes.txt", size: 10, image: false },
        ],
        notices: [{ kind: "tooLarge", name: "big.bin" }],
      },
    });
    render(<QuickAdd initialServerId={null} />);
    await ready();
    await vi.waitFor(() => expect(titleBox().value).toBe("From the clipboard"));
    const description = screen.getByRole("textbox", {
      name: "quickAdd.description",
    }) as HTMLTextAreaElement;
    expect(description.value).toBe("More lines");
    expect(
      screen.getByRole("img", { name: "quickAdd.previewAlt" }),
    ).toBeTruthy();
    expect(screen.getByText("notes.txt")).toBeTruthy();
    expect(screen.getByText("quickAdd.notices.tooLarge")).toBeTruthy();
    expect(screen.getByText("quickAdd.uploadHint")).toBeTruthy();

    const removeButtons = screen.getAllByRole("button", {
      name: "quickAdd.removeAttachment",
    });
    fireEvent.click(removeButtons[1] as HTMLElement);
    expect(invoke).toHaveBeenCalledWith("quick_add_remove_attachment", {
      id: "a2",
    });
    expect(screen.queryByText("notes.txt")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "quickAdd.create" }));
    await screen.findByText(/quickAdd\.created/);
    expect(createCall()?.[1]).toMatchObject({
      title: "From the clipboard",
      details: { description: "More lines" },
      attachmentIds: ["a1"],
    });
    expect(screen.queryByText("Screenshot.png")).toBeNull();
  });

  it("picks up a new draft while open", async () => {
    let draft: unknown = emptyDraft;
    mockCommands({ quick_add_draft: () => draft });
    render(<QuickAdd initialServerId={null} />);
    await ready();
    expect(titleBox().value).toBe("");
    draft = {
      revision: 7,
      title: null,
      description: null,
      attachments: [],
      notices: [{ kind: "screenPermission" }],
    };
    await act(async () => {
      draftListener?.();
    });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "quickAdd.notices.screenPermission",
    );
  });

  it("reports files that weren't attached", async () => {
    mockCommands({
      quick_add_draft: {
        revision: 1,
        title: "With files",
        description: null,
        attachments: [{ id: "a1", name: "a.pdf", size: 10, image: false }],
        notices: [],
      },
      quick_add_create: {
        taskId: "t1",
        url: "https://b.example/task",
        failedAttachments: ["a.pdf"],
      },
    });
    render(<QuickAdd initialServerId={null} />);
    await ready();
    await vi.waitFor(() => expect(titleBox().value).toBe("With files"));
    fireEvent.click(screen.getByRole("button", { name: "quickAdd.create" }));
    expect(await screen.findByText("quickAdd.attachmentsFailed")).toBeTruthy();
  });

  it("starts in the project used last", async () => {
    mockCommands({
      quick_add_prefs: { serverId: "b", workspaceId: "w1", projectId: "p2" },
    });
    render(<QuickAdd initialServerId={null} />);
    await ready();
    const project = screen.getByRole("combobox", {
      name: "quickAdd.project",
    }) as HTMLSelectElement;
    await vi.waitFor(() => expect(project.value).toBe("w1/p2"));
  });

  it("falls back to the first project when the remembered one is gone", async () => {
    mockCommands({
      quick_add_prefs: { serverId: "b", workspaceId: "w1", projectId: "gone" },
    });
    render(<QuickAdd initialServerId={null} />);
    await ready();
    const project = screen.getByRole("combobox", {
      name: "quickAdd.project",
    }) as HTMLSelectElement;
    expect(project.value).toBe("w1/p1");
  });
});

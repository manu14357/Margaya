import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickAdd } from "./quick-add";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
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

describe("QuickAdd", () => {
  beforeEach(() => {
    invoke.mockReset();
  });
  afterEach(cleanup);

  it("creates a task in the chosen project of a signed-in server", async () => {
    invoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "list_servers":
          return [server("a", false), server("b", true)];
        case "quick_add_targets":
          return [
            {
              workspaceId: "w1",
              workspaceName: "Team",
              projects: [{ id: "p1", name: "Web" }],
            },
          ];
        case "quick_add_create":
          return { taskId: "t1", url: "https://b.example/task" };
        default:
          return undefined;
      }
    });
    render(<QuickAdd initialServerId="a" />);

    // Server "a" is signed out, so the only signed-in server is used.
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("quick_add_targets", {
        serverId: "b",
      }),
    );
    await screen.findByRole("option", { name: "Web" });
    fireEvent.change(
      screen.getByRole("textbox", { name: "quickAdd.taskTitle" }),
      {
        target: { value: "  Ship the release  " },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "quickAdd.create" }));

    expect(await screen.findByText(/quickAdd\.created/)).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("quick_add_create", {
      serverId: "b",
      workspaceId: "w1",
      projectId: "p1",
      title: "Ship the release",
    });
  });

  it("asks to sign in when no server is signed in", async () => {
    invoke.mockResolvedValue([server("a", false)]);
    render(<QuickAdd initialServerId={null} />);
    expect(await screen.findByText("quickAdd.noServers")).toBeTruthy();
  });
});

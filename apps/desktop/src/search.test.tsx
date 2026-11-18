import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Search } from "./search";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
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

const item = (kind: string, id: string, title: string) => ({
  kind,
  id,
  title,
  key: kind === "task" ? `WEB-${id}` : null,
  context: "Web",
  path: `/dashboard/workspace/w1/${kind}/${id}`,
});

const recent = {
  groups: [
    {
      serverId: "a",
      serverLabel: "Server a",
      workspaceId: "w1",
      workspaceName: "Team",
      sections: [{ kind: "task", items: [item("task", "1", "Recent task")] }],
    },
  ],
  unavailable: [],
};

const found = {
  groups: [
    {
      serverId: "a",
      serverLabel: "Server a",
      workspaceId: "w1",
      workspaceName: "Team",
      sections: [
        { kind: "task", items: [item("task", "2", "Ship it")] },
        { kind: "page", items: [item("page", "p", "Shipping notes")] },
      ],
    },
  ],
  unavailable: ["Server b"],
};

function field() {
  return screen.getByRole("combobox", { name: "search.label" });
}

describe("Search", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "list_servers":
          return [server("a", true), server("c", false)];
        case "search_recent":
          return recent;
        case "search_query":
          return found;
        default:
          return undefined;
      }
    });
  });
  afterEach(cleanup);

  it("lists recently opened items before anything is typed", async () => {
    render(<Search />);
    expect(
      await screen.findByRole("option", { name: /Recent task/ }),
    ).toBeTruthy();
    expect(screen.getByText("search.recent", { selector: "p" })).toBeTruthy();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(invoke).toHaveBeenCalledWith("search_open", {
      serverId: "a",
      path: "/dashboard/workspace/w1/task/1",
    });
  });

  it("searches after typing stops, groups by kind and opens with the keyboard", async () => {
    render(<Search />);
    await screen.findByRole("option", { name: /Recent task/ });
    fireEvent.change(field(), { target: { value: "s" } });
    fireEvent.change(field(), { target: { value: "  ship " } });

    expect(await screen.findByRole("option", { name: /Ship it/ })).toBeTruthy();
    const queries = invoke.mock.calls.filter(
      ([name]) => name === "search_query",
    );
    expect(queries).toEqual([
      ["search_query", { query: "ship", searchId: expect.any(Number) }],
    ]);
    expect(invoke).not.toHaveBeenCalledWith("search_cancel", expect.anything());
    expect(
      screen.getByRole("group", { name: "search.kinds.task" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("group", { name: "search.kinds.page" }),
    ).toBeTruthy();
    expect(screen.getByText("search.unavailable")).toBeTruthy();

    // The first option starts selected; down moves to the page.
    expect(
      screen
        .getByRole("option", { name: /Ship it/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    const page = screen.getByRole("option", { name: /Shipping notes/ });
    expect(page.getAttribute("aria-selected")).toBe("true");
    expect(field().getAttribute("aria-activedescendant")).toBe(page.id);
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(
      screen
        .getByRole("option", { name: /Ship it/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(invoke).toHaveBeenCalledWith("search_open", {
      serverId: "a",
      path: "/dashboard/workspace/w1/page/p",
    });
  });

  it("says when nothing matches", async () => {
    invoke.mockImplementation(async (command: string) =>
      command === "list_servers"
        ? [server("a", true)]
        : { groups: [], unavailable: [] },
    );
    render(<Search />);
    expect(await screen.findByText("search.noRecent")).toBeTruthy();
    fireEvent.change(field(), { target: { value: "zzz" } });
    expect(await screen.findByText("search.noResults")).toBeTruthy();
  });

  it("asks to sign in when no server is signed in", async () => {
    invoke.mockImplementation(async (command: string) =>
      command === "list_servers" ? [server("a", false)] : undefined,
    );
    render(<Search />);
    expect(await screen.findByText("search.noServers")).toBeTruthy();
    expect((field() as HTMLInputElement).disabled).toBe(true);
    expect(invoke).not.toHaveBeenCalledWith("search_recent");
  });

  it("stops a search still running when the query changes", async () => {
    invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "list_servers") return [server("a", true)];
      if (command === "search_recent") return recent;
      if (command === "search_query") {
        const { query } = args as { query: string };
        // The first search never answers on its own.
        return query === "slow" ? new Promise(() => {}) : found;
      }
      return undefined;
    });
    render(<Search />);
    await screen.findByRole("option", { name: /Recent task/ });
    fireEvent.change(field(), { target: { value: "slow" } });
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("search_query", {
        query: "slow",
        searchId: expect.any(Number),
      }),
    );
    const slow = invoke.mock.calls.find(
      ([name, args]) =>
        name === "search_query" && (args as { query: string }).query === "slow",
    )?.[1] as { searchId: number };

    fireEvent.change(field(), { target: { value: "ship" } });
    expect(invoke).toHaveBeenCalledWith("search_cancel", {
      searchId: slow.searchId,
    });
    expect(await screen.findByRole("option", { name: /Ship it/ })).toBeTruthy();
    // Only the superseded search was stopped.
    expect(
      invoke.mock.calls.filter(([name]) => name === "search_cancel"),
    ).toHaveLength(1);
  });

  it("closes on Escape", async () => {
    render(<Search />);
    await screen.findByRole("option", { name: /Recent task/ });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(invoke).toHaveBeenCalledWith("close_search");
  });
});

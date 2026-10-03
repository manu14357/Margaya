import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveBoardView } from "@/lib/public-board/search-params";
import type { PublicBoard } from "@/types/public-board";
import PublicBoardHeader from "./public-board-header";
import PublicBoardToolbar from "./public-board-toolbar";
import PublicSortSelect from "./public-sort-select";

// The real menu primitives are mounted here on purpose: a Base UI group
// part outside its group throws only when the menu opens.

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ href: "/public-project/tok" }),
  Link: ({ children }: { children?: ReactNode }) => (
    <a href="/auth/sign-in">{children}</a>
  ),
}));

vi.mock("@/hooks/mutations/public-board/use-public-board-session", () => ({
  usePublicBoardSession: () => ({
    signOut: { mutate: vi.fn() },
    continueAsGuest: { mutate: vi.fn(), isPending: false },
  }),
}));

afterEach(cleanup);

const board: PublicBoard = {
  project: {
    name: "Website",
    slug: "WEB",
    icon: null,
    description: null,
    descriptionDeferred: false,
  },
  board: {
    layouts: ["board", "list"],
    defaultLayout: "board",
    comments: true,
    reactions: true,
    votes: true,
    requests: false,
    guestsAllowed: false,
    showAssignees: false,
    showBacklog: false,
  },
  participation: true,
  columns: [
    {
      slug: "to-do",
      name: "To Do",
      icon: null,
      group: "unstarted",
      isFinal: false,
    },
  ],
  labels: [{ name: "ui", color: "#22c55e" }],
  sorts: ["manual", "newest", "votes"],
  reactionSet: [],
  viewer: {
    kind: "visitor",
    name: null,
    image: null,
    isMember: false,
    blocked: false,
    can: { comment: false, react: false, vote: false, request: false },
  },
  instance: {
    name: "Margaya",
    guestSignInAvailable: false,
    signUpAvailable: true,
  },
};

function withQueries(node: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
  );
}

describe("PublicSortSelect", () => {
  it("opens its menu and picks a sort", async () => {
    const onChange = vi.fn();
    render(
      <PublicSortSelect
        sorts={["manual", "newest", "votes"]}
        value="manual"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).getByText("publicProject:board.sort.label"),
    ).toBeInTheDocument();
    fireEvent.click(
      within(menu).getByRole("menuitemradio", {
        name: "publicProject:board.sort.votes",
      }),
    );
    expect(onChange).toHaveBeenCalledWith("votes");
  });
});

describe("PublicBoardHeader", () => {
  it("renders the place and the viewer's sign-in", () => {
    render(
      withQueries(
        <PublicBoardHeader
          token="tok"
          board={board}
          view={resolveBoardView({}, board)}
          onChange={vi.fn()}
          onOpenRequest={vi.fn()}
          onOpenMyRequests={vi.fn()}
        />,
      ),
    );
    expect(
      screen.getByRole("heading", { name: "Website" }),
    ).toBeInTheDocument();
    expect(screen.getByText("publicProject:viewer.signIn")).toBeInTheDocument();
  });
});

describe("PublicBoardToolbar", () => {
  it("renders the layout tabs and opens the sort and filter menus", async () => {
    const onChange = vi.fn();
    render(
      <PublicBoardToolbar
        board={board}
        view={resolveBoardView({}, board)}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "tasks:view.list" }));
    expect(onChange).toHaveBeenCalledWith({ layout: "list" });

    const sortButtons = screen.getAllByRole("button", {
      name: /publicProject:board\.sort\.label/,
    });
    fireEvent.click(sortButtons[0] as HTMLElement);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    const filterButtons = screen.getAllByRole("button", {
      name: /publicProject:board\.filter$/,
    });
    fireEvent.click(filterButtons[0] as HTMLElement);
    expect(
      await screen.findByText("publicProject:board.sections.status"),
    ).toBeInTheDocument();
  });
});

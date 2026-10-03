import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicBoard } from "@/types/public-board";
import PublicCommentComposer from "./public-comment-composer";

const createComment = vi.fn();
const continueAsGuest = vi.fn();

vi.mock("@/hooks/mutations/public-board/use-public-board-comments", () => ({
  usePublicBoardCommentMutations: () => ({
    create: { mutate: createComment, isPending: false },
  }),
}));

vi.mock("@/hooks/mutations/public-board/use-public-board-session", () => ({
  usePublicBoardSession: () => ({
    continueAsGuest: { mutate: continueAsGuest, isPending: false },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ href: "/public-project/tok?task=5" }),
  Link: ({
    children,
    search,
    ...props
  }: {
    children?: ReactNode;
    search?: { redirect?: string };
  }) => (
    <a {...props} href={`/auth/sign-in?redirect=${search?.redirect ?? ""}`}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/activity/comment-editor", () => ({
  default: ({
    value,
    onChange,
    onSubmitShortcut,
    placeholder,
  }: {
    value: string;
    onChange?: (value: string) => void;
    onSubmitShortcut?: () => void;
    placeholder?: string;
  }) => (
    <textarea
      aria-label={placeholder}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          onSubmitShortcut?.();
        }
      }}
    />
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);
beforeEach(() => {
  createComment.mockReset();
  continueAsGuest.mockReset();
});

type Kind = "visitor" | "guest" | "account";

function boardFor(
  kind: Kind,
  { canComment = false, guestsAllowed = false, blocked = false } = {},
): PublicBoard {
  return {
    project: {
      name: "Website",
      slug: "WEB",
      icon: null,
      description: null,
      descriptionDeferred: false,
    },
    board: {
      layouts: ["board"],
      defaultLayout: "board",
      comments: true,
      reactions: true,
      votes: false,
      requests: false,
      guestsAllowed,
      showAssignees: false,
      showBacklog: false,
    },
    participation: true,
    columns: [],
    labels: [],
    sorts: ["manual"],
    reactionSet: [],
    viewer: {
      kind,
      name: kind === "visitor" ? null : "Ana",
      image: null,
      isMember: false,
      blocked,
      can: {
        comment: canComment,
        react: canComment,
        vote: false,
        request: false,
      },
    },
    instance: {
      name: "Margaya",
      guestSignInAvailable: true,
      signUpAvailable: true,
    },
  };
}

function renderComposer(board: PublicBoard) {
  render(<PublicCommentComposer token="tok" number={5} board={board} />);
}

describe("PublicCommentComposer", () => {
  it("lets an account comment and posts with Ctrl+Enter", () => {
    renderComposer(boardFor("account", { canComment: true }));
    const editor = screen.getByLabelText("publicProject:comments.placeholder");
    fireEvent.change(editor, { target: { value: "Looks great" } });
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(createComment).toHaveBeenCalledWith(
      "Looks great",
      expect.any(Object),
    );
  });

  it("doesn't post an empty comment", () => {
    renderComposer(boardFor("account", { canComment: true }));
    const submit = screen.getByRole("button", {
      name: "publicProject:comments.submit",
    });
    expect(submit).toBeDisabled();
    fireEvent.keyDown(
      screen.getByLabelText("publicProject:comments.placeholder"),
      { key: "Enter", ctrlKey: true },
    );
    expect(createComment).not.toHaveBeenCalled();
  });

  it("asks a visitor to sign in, coming back to the same view", () => {
    renderComposer(boardFor("visitor"));
    expect(
      screen.queryByLabelText("publicProject:comments.placeholder"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("publicProject:participation.signInTitle"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "publicProject:participation.signIn" }),
    ).toHaveAttribute(
      "href",
      "/auth/sign-in?redirect=/public-project/tok?task=5",
    );
    expect(
      screen.queryByRole("button", {
        name: "publicProject:participation.continueAsGuest",
      }),
    ).not.toBeInTheDocument();
  });

  it("offers Continue as guest only when the board allows guests", () => {
    renderComposer(boardFor("visitor", { guestsAllowed: true }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "publicProject:participation.continueAsGuest",
      }),
    );
    expect(continueAsGuest).toHaveBeenCalledWith(null, expect.any(Object));
  });

  it("tells a guest the board needs an account", () => {
    renderComposer(boardFor("guest"));
    expect(
      screen.getByText("publicProject:participation.accountRequired"),
    ).toBeInTheDocument();
  });

  it("tells blocked people they can't take part", () => {
    renderComposer(boardFor("account", { blocked: true }));
    expect(
      screen.getByText("publicProject:participation.blocked"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

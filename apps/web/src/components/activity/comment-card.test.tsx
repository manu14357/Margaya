import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { cloneElement, isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commentPublicActions } from "@/components/publication/comment-public-actions";
import CommentCard from "./comment-card";

afterEach(cleanup);

vi.mock("@/components/activity/comment-editor", () => ({
  default: ({ value }: { value: string }) => <div>{value}</div>,
}));

// Translate-on-read needs the router and AI availability; shown untranslated.
vi.mock("@/components/ai/translate/translatable-content", () => ({
  default: ({
    text,
    children,
  }: {
    text: string;
    children: (text: string, translated: boolean) => ReactNode;
  }) => <>{children(text, false)}</>,
}));

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
}));

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({ user: authState.user }),
}));

vi.mock("@/hooks/mutations/comment/use-update-comment", () => ({
  default: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      `${key}${values ? ` ${Object.values(values).join(" ")}` : ""}`,
  }),
}));

vi.mock("@/lib/format", () => ({
  formatRelativeTime: () => "2 hours ago",
  formatDateTime: () => "Apr 5, 2026, 11:38 AM",
}));

vi.mock("@/components/ui/tooltip", async () => {
  const React = await import("react");

  function Tooltip({ children }: { children: ReactNode }) {
    const [open, setOpen] = React.useState(false);
    return (
      <div data-testid="tooltip-root">
        {React.Children.map(children, (child) =>
          isValidElement(child)
            ? cloneElement(
                child as ReactElement<{
                  open?: boolean;
                  setOpen?: (open: boolean) => void;
                }>,
                {
                  open,
                  setOpen,
                },
              )
            : child,
        )}
      </div>
    );
  }

  function TooltipTrigger({
    children,
    setOpen,
  }: {
    children: ReactElement;
    setOpen?: (open: boolean) => void;
  }) {
    return cloneElement(children as ReactElement<Record<string, unknown>>, {
      onMouseEnter: () => setOpen?.(true),
      onMouseLeave: () => setOpen?.(false),
      onFocus: () => setOpen?.(true),
      onBlur: () => setOpen?.(false),
    });
  }

  function TooltipContent({
    children,
    open,
  }: {
    children: ReactNode;
    open?: boolean;
  }) {
    return open ? <div role="tooltip">{children}</div> : null;
  }

  function TooltipProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }

  return {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
  };
});

function renderCommentCard(externalSource?: string, importedBy?: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <CommentCard
        externalSource={externalSource}
        importedBy={importedBy}
        commentId="comment-1"
        taskId="task-1"
        content="Test comment"
        createdAt="2026-04-05T09:38:50.000Z"
        user={{
          id: "user-1",
          name: "Tin",
          email: "tin@example.com",
          image: null,
        }}
      />
    </QueryClientProvider>,
  );
}

describe("CommentCard", () => {
  it.each(["trello", "jira", "github"])(
    "visibly identifies %s authors as imported without hovering",
    (source) => {
      renderCommentCard(source, "Actual Importer");
      expect(screen.getByText(/activity:comment.importedFrom/)).toBeVisible();
      expect(
        screen.getByText(/activity:comment.importedBy Actual Importer/),
      ).toBeVisible();
    },
  );

  it("does not label ordinary comments as imports", () => {
    renderCommentCard();
    expect(
      screen.queryByText(/activity:comment.importedFrom/),
    ).not.toBeInTheDocument();
  });

  it("shows full date+short time in tooltip on hover/focus", async () => {
    renderCommentCard();

    const trigger = screen.getByRole("button", {
      name: "Apr 5, 2026, 11:38 AM",
    });

    fireEvent.mouseEnter(trigger);
    expect(await screen.findByText("Apr 5, 2026, 11:38 AM")).toBeVisible();

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByText("Apr 5, 2026, 11:38 AM")).not.toBeInTheDocument();

    fireEvent.focus(trigger);
    expect(await screen.findByText("Apr 5, 2026, 11:38 AM")).toBeVisible();
  });
});

describe("CommentCard on a project with a public board", () => {
  afterEach(() => {
    authState.user = null;
  });

  function renderPublic(
    props: Partial<ComponentProps<typeof CommentCard>> = {},
  ) {
    const queryClient = new QueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <CommentCard
          commentId="comment-1"
          taskId="task-1"
          content="From the board"
          createdAt="2026-04-05T09:38:50.000Z"
          user={{ id: "outsider-1", name: "Olga", image: null }}
          visibility="public"
          authorKind="external"
          publicBoard={{ projectId: "p1", open: true, canModerate: true }}
          {...props}
        />
      </QueryClientProvider>,
    );
  }

  it("marks public comments and outside authors", () => {
    renderPublic();
    expect(
      screen.getByText("activity:commentVisibility.badgePublic"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("activity:commentVisibility.badgeExternal"),
    ).toBeInTheDocument();
  });

  it("marks guest authors, and no badge for internal member comments", () => {
    renderPublic({ authorKind: "guest" });
    expect(
      screen.getByText("activity:commentVisibility.badgeGuest"),
    ).toBeInTheDocument();
    cleanup();
    renderPublic({ visibility: "internal", authorKind: "member" });
    expect(
      screen.queryByText(/activity:commentVisibility\.badge/),
    ).not.toBeInTheDocument();
  });

  it("gives moderators a menu on others' public comments", () => {
    renderPublic();
    expect(
      screen.getByRole("button", {
        name: "activity:commentVisibility.moreActions",
      }),
    ).toBeInTheDocument();
  });

  it("gives no menu to members without moderation on others' comments", () => {
    renderPublic({
      publicBoard: { projectId: "p1", open: true, canModerate: false },
    });
    expect(
      screen.queryByRole("button", {
        name: "activity:commentVisibility.moreActions",
      }),
    ).not.toBeInTheDocument();
  });
});

describe("commentPublicActions", () => {
  const board = { projectId: "p1", open: true, canModerate: true };

  it("lets the author make an internal comment public while the board is open", () => {
    expect(
      commentPublicActions({
        visibility: "internal",
        isAuthor: true,
        imported: false,
        publicBoard: board,
      }),
    ).toEqual({
      makePublic: true,
      makeInternal: false,
      hide: false,
      remove: false,
      block: false,
    });
    expect(
      commentPublicActions({
        visibility: "internal",
        isAuthor: true,
        imported: false,
        publicBoard: { ...board, open: false },
      }).makePublic,
    ).toBe(false);
  });

  it("lets the author make a public comment internal at any time", () => {
    expect(
      commentPublicActions({
        visibility: "public",
        isAuthor: true,
        imported: false,
        publicBoard: { ...board, open: false, canModerate: false },
      }).makeInternal,
    ).toBe(true);
  });

  it("lets moderators hide, delete and block outsiders on public comments", () => {
    expect(
      commentPublicActions({
        visibility: "public",
        isAuthor: false,
        authorKind: "guest",
        authorId: "g1",
        imported: false,
        publicBoard: board,
      }),
    ).toEqual({
      makePublic: false,
      makeInternal: false,
      hide: true,
      remove: true,
      block: true,
    });
    // Members are not blocked from comment menus; a hidden (internal)
    // outsider comment can't be hidden or deleted again, only blocked.
    expect(
      commentPublicActions({
        visibility: "public",
        isAuthor: false,
        authorKind: "member",
        authorId: "m1",
        imported: false,
        publicBoard: board,
      }).block,
    ).toBe(false);
    expect(
      commentPublicActions({
        visibility: "internal",
        isAuthor: false,
        authorKind: "external",
        authorId: "x1",
        imported: false,
        publicBoard: board,
      }),
    ).toEqual({
      makePublic: false,
      makeInternal: false,
      hide: false,
      remove: false,
      block: true,
    });
  });

  it("never offers public actions on imported comments", () => {
    expect(
      commentPublicActions({
        visibility: "internal",
        isAuthor: true,
        imported: true,
        publicBoard: board,
      }).makePublic,
    ).toBe(false);
  });
});

describe("CommentCard edited marker", () => {
  function renderWithTimes(createdAt: string, updatedAt?: string) {
    const queryClient = new QueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <CommentCard
          commentId="comment-2"
          taskId="task-1"
          content="Changed my mind"
          createdAt={createdAt}
          updatedAt={updatedAt}
          user={{ id: "user-1", name: "Tin", email: null, image: null }}
        />
      </QueryClientProvider>,
    );
  }

  it("marks a comment edited more than a minute after posting", () => {
    renderWithTimes("2026-04-05T09:38:50.000Z", "2026-04-05T10:15:00.000Z");
    const marker = screen.getByTestId("comment-edited");
    expect(marker).toHaveTextContent("activity:comment.edited");
    fireEvent.mouseEnter(marker);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "activity:comment.editedAt Apr 5, 2026, 11:38 AM",
    );
  });

  it("leaves quick fixes and unedited comments unmarked", () => {
    renderWithTimes("2026-04-05T09:38:50.000Z", "2026-04-05T09:39:20.000Z");
    expect(screen.queryByTestId("comment-edited")).toBeNull();
    cleanup();
    renderWithTimes("2026-04-05T09:38:50.000Z");
    expect(screen.queryByTestId("comment-edited")).toBeNull();
  });
});

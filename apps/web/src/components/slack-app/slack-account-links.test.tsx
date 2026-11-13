import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlackAccountLinks } from "./slack-account-links";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    preview: {
      isLoading: false,
      isError: false,
      error: null as unknown,
      data: null as unknown,
    },
    links: {
      isLoading: false,
      isError: false,
      data: [] as unknown[],
    },
    confirm: vi.fn(async () => ({})),
    remove: vi.fn(async () => ({})),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/settings-layout", async () => {
  const actual = await vi.importActual<object>("@/components/settings-layout");
  return {
    ...actual,
    SettingsPage: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
  };
});

vi.mock("@/hooks/queries/slack-app/use-slack-link-preview", () => ({
  default: () => mocks.preview,
}));
vi.mock("@/hooks/queries/slack-app/use-slack-links", () => ({
  default: () => mocks.links,
}));
vi.mock("@/hooks/mutations/slack-app/use-slack-app-mutations", () => ({
  useConfirmSlackLink: () => ({
    mutateAsync: mocks.confirm,
    isPending: false,
  }),
  useDeleteSlackLink: () => ({
    mutateAsync: mocks.remove,
    isPending: false,
    variables: undefined,
  }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  mocks.preview = { isLoading: false, isError: false, error: null, data: null };
  mocks.links = { isLoading: false, isError: false, data: [] };
  mocks.confirm.mockClear();
  mocks.remove.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("SlackAccountLinks", () => {
  it("shows the empty state without a pending link", () => {
    render(<SlackAccountLinks onLinkHandled={() => {}} />);
    expect(screen.getByText("settings:slackApp.noLinks")).toBeTruthy();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("links only after the person confirms", async () => {
    mocks.preview.data = {
      workspaceId: "ws-1",
      workspaceName: "Studio",
      teamName: "Team",
      slackUserName: "ana",
      linkedToYou: false,
      linkedToSomeoneElse: false,
    };
    const done = vi.fn();
    render(<SlackAccountLinks linkToken="tok" onLinkHandled={done} />);
    expect(mocks.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("settings:slackApp.link.confirm"));
    await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith("tok"));
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
  });

  it("explains an expired link", () => {
    mocks.preview.isError = true;
    render(<SlackAccountLinks linkToken="old" onLinkHandled={() => {}} />);
    expect(
      screen.getByText("settings:slackApp.link.invalidTitle"),
    ).toBeTruthy();
  });

  it("unlinks a linked account", async () => {
    mocks.links.data = [
      {
        id: "l-1",
        workspaceId: "ws-1",
        workspaceName: "Studio",
        slackTeamId: "T1",
        teamName: "Team",
        slackUserId: "U1",
        slackUserName: "ana",
        createdAt: "2026-11-13T00:00:00.000Z",
      },
    ];
    render(<SlackAccountLinks onLinkHandled={() => {}} />);
    expect(screen.getByText("ana")).toBeTruthy();
    fireEvent.click(screen.getByText("settings:slackApp.unlink"));
    await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("l-1"));
  });
});

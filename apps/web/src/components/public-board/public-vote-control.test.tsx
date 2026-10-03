import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicBoardKeys } from "@/hooks/queries/public-board/public-board-keys";
import type { ParticipationState } from "@/lib/public-board/participation";
import type { PublicTaskDetail } from "@/types/public-board";
import PublicVoteControl from "./public-vote-control";

const setVote = vi.fn();
const toastError = vi.fn();

vi.mock("@/fetchers/public-board/public-board-participation", () => ({
  setPublicBoardVote: (...args: unknown[]) => setVote(...args),
}));

vi.mock("@/lib/toast", () => ({
  toast: { error: (message: string) => toastError(message), success: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));

afterEach(cleanup);
beforeEach(() => {
  setVote.mockReset();
  toastError.mockReset();
});

const allowed: ParticipationState = { prompt: "allowed", guestOption: false };

function renderControl(
  votes: PublicTaskDetail["votes"],
  participation: ParticipationState = allowed,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  queryClient.setQueryData(publicBoardKeys.task("tok", 5), {
    id: "t5",
    number: 5,
    votes,
  });
  render(
    <QueryClientProvider client={queryClient}>
      <PublicVoteControl token="tok" number={5} participation={participation} />
    </QueryClientProvider>,
  );
  return queryClient;
}

const up = () => screen.getByRole("button", { name: /votes\.upvote/ });
const down = () => screen.getByRole("button", { name: /votes\.downvote/ });

describe("PublicVoteControl", () => {
  it("upvotes optimistically and keeps the server's answer", async () => {
    setVote.mockResolvedValue({ up: 3, down: 1, mine: 1 });
    renderControl({ up: 2, down: 1, mine: null });
    fireEvent.click(up());
    await waitFor(() => expect(setVote).toHaveBeenCalledWith("tok", 5, 1));
    await waitFor(() => expect(up()).toHaveAttribute("aria-pressed", "true"));
    expect(up()).toHaveTextContent("3");
  });

  it("switches an upvote to a downvote", async () => {
    setVote.mockResolvedValue({ up: 1, down: 2, mine: -1 });
    renderControl({ up: 2, down: 1, mine: 1 });
    fireEvent.click(down());
    await waitFor(() => expect(setVote).toHaveBeenCalledWith("tok", 5, -1));
    await waitFor(() => expect(down()).toHaveAttribute("aria-pressed", "true"));
    expect(up()).toHaveAttribute("aria-pressed", "false");
  });

  it("removes my vote when I click it again", async () => {
    setVote.mockResolvedValue({ up: 1, down: 1, mine: null });
    renderControl({ up: 2, down: 1, mine: 1 });
    fireEvent.click(up());
    await waitFor(() => expect(setVote).toHaveBeenCalledWith("tok", 5, null));
    await waitFor(() => expect(up()).toHaveAttribute("aria-pressed", "false"));
  });

  it("rolls back and shows the server message on failure", async () => {
    let reject: (error: Error) => void = () => {};
    setVote.mockReturnValue(
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
    );
    renderControl({ up: 2, down: 1, mine: null });
    fireEvent.click(up());
    await waitFor(() => expect(up()).toHaveTextContent("3"));
    await act(async () => reject(new Error("Votes are turned off")));
    await waitFor(() => expect(up()).toHaveTextContent("2"));
    expect(up()).toHaveAttribute("aria-pressed", "false");
    expect(toastError).toHaveBeenCalledWith("Votes are turned off");
  });

  it("is disabled with a sign-in hint for visitors and guests", () => {
    for (const prompt of ["signIn", "accountForAction"] as const) {
      renderControl(
        { up: 2, down: 0, mine: null },
        { prompt, guestOption: false },
      );
      expect(up()).toBeDisabled();
      expect(down()).toBeDisabled();
      expect(
        screen.getByText("publicProject:votes.signInToVote"),
      ).toBeInTheDocument();
      fireEvent.click(up());
      expect(setVote).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("renders nothing when votes are hidden", () => {
    renderControl(
      { up: 2, down: 0, mine: null },
      { prompt: "hidden", guestOption: false },
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

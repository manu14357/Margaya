import type { PublicBoard } from "@/types/public-board";

// What a public board viewer sees in place of a participation control
// (B12 §1.4). The server decides; this only picks the prompt.

export type ParticipationAction = "comment" | "react" | "vote" | "request";

export type ParticipationPrompt =
  /** The viewer may do it. */
  | "allowed"
  /** The feature is off, or the server's participation is off: show nothing. */
  | "hidden"
  /** A visitor: "Sign in to take part". */
  | "signIn"
  /** A guest on a board without guests: "This board needs an account". */
  | "accountRequired"
  /** A guest, for votes and requests: sign in with an account. */
  | "accountForAction"
  /** Blocked on this board, or banned. */
  | "blocked";

export type ParticipationState = {
  prompt: ParticipationPrompt;
  /** Offer "Continue as guest" next to Sign in. */
  guestOption: boolean;
};

type BoardFacts = Pick<
  PublicBoard,
  "board" | "participation" | "viewer" | "instance"
>;

const GUEST_ACTIONS: readonly ParticipationAction[] = ["comment", "react"];

export function featureOn(board: BoardFacts, action: ParticipationAction) {
  switch (action) {
    case "comment":
      return board.board.comments;
    case "react":
      return board.board.reactions;
    case "vote":
      return board.board.votes;
    case "request":
      return board.board.requests;
  }
}

export function participationState(
  board: BoardFacts,
  action: ParticipationAction,
): ParticipationState {
  const none = { guestOption: false };
  if (!board.participation || !featureOn(board, action)) {
    return { prompt: "hidden", ...none };
  }
  const { viewer } = board;
  if (viewer.can[action]) return { prompt: "allowed", ...none };
  if (viewer.blocked) return { prompt: "blocked", ...none };
  if (viewer.kind === "visitor") {
    return {
      prompt: "signIn",
      guestOption:
        GUEST_ACTIONS.includes(action) &&
        board.board.guestsAllowed &&
        board.instance.guestSignInAvailable,
    };
  }
  if (viewer.kind === "guest") {
    return {
      prompt: GUEST_ACTIONS.includes(action)
        ? "accountRequired"
        : "accountForAction",
      ...none,
    };
  }
  // An account the server still refuses (an instance ban).
  return { prompt: "blocked", ...none };
}

/** Nobody can take part: the footer says "Read-only". */
export function isReadOnlyBoard(board: BoardFacts): boolean {
  if (!board.participation) return true;
  return !(
    board.board.comments ||
    board.board.reactions ||
    board.board.votes ||
    board.board.requests
  );
}

/** The sign-in page, coming back to this exact board view afterwards. */
export function signInHref(currentPath: string): string {
  return `/auth/sign-in?redirect=${encodeURIComponent(currentPath)}`;
}

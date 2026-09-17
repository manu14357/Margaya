import type { PublicViewer, ResolvedBoard } from "./types";

// Who may take part on a public board (B12 K8, K9, §3.8). Pure: the gate
// middleware in ./gate.ts adds the rate limits.

export type ParticipationAction =
  | "comment"
  | "react"
  | "vote"
  | "request"
  | "manageOwnComment"
  | "manageOwnRequest";

export type ParticipationDecision =
  | { ok: true }
  | { ok: false; status: 401 | 403; message: string };

export const PARTICIPATION_MESSAGES = {
  participationOff: "Public participation is turned off on this server",
  commentsOff: "Comments are turned off for this board",
  reactionsOff: "Reactions are turned off for this board",
  votesOff: "Votes are turned off for this board",
  requestsOff: "Requests are turned off for this board",
  apiKey: "Use a signed-in session to take part",
  signIn: "Sign in to take part",
  needsAccount: "Sign in with an account to do this",
  needsAccountBoard: "This board needs an account to take part",
  blocked: "You can't take part on this board",
} as const;

type BoardFacts = Pick<
  ResolvedBoard,
  "settings" | "intakeEnabled" | "viewerBlocked" | "instance"
>;

/** The board's switch for an action is on (requests also need Intake). */
export function featureOn(board: BoardFacts, action: ParticipationAction) {
  switch (action) {
    case "comment":
    case "manageOwnComment":
      return board.settings.commentsEnabled;
    case "react":
      return board.settings.reactionsEnabled;
    case "vote":
      return board.settings.votesEnabled;
    case "request":
    case "manageOwnRequest":
      return board.settings.requestsEnabled && board.intakeEnabled;
  }
}

const FEATURE_OFF: Record<ParticipationAction, string> = {
  comment: PARTICIPATION_MESSAGES.commentsOff,
  manageOwnComment: PARTICIPATION_MESSAGES.commentsOff,
  react: PARTICIPATION_MESSAGES.reactionsOff,
  vote: PARTICIPATION_MESSAGES.votesOff,
  request: PARTICIPATION_MESSAGES.requestsOff,
  manageOwnRequest: PARTICIPATION_MESSAGES.requestsOff,
};

function refuse(status: 401 | 403, message: string): ParticipationDecision {
  return { ok: false, status, message };
}

/** Guests may comment and react where the board and the server allow it. */
export function guestsAllowed(board: BoardFacts) {
  return board.settings.allowGuests && board.instance.guestAccessActive;
}

/** The §3.8 checks 1-6, in order; the first failure answers. */
export function participationDecision(
  viewer: PublicViewer,
  board: BoardFacts,
  action: ParticipationAction,
): ParticipationDecision {
  if (!board.instance.participation) {
    return refuse(403, PARTICIPATION_MESSAGES.participationOff);
  }
  if (!featureOn(board, action)) return refuse(403, FEATURE_OFF[action]);
  if (viewer.apiKey) return refuse(403, PARTICIPATION_MESSAGES.apiKey);
  if (viewer.kind === "visitor")
    return refuse(401, PARTICIPATION_MESSAGES.signIn);
  // An author can always manage their own comment, guest or not.
  if (viewer.kind === "guest" && action !== "manageOwnComment") {
    if (
      action === "vote" ||
      action === "request" ||
      action === "manageOwnRequest"
    ) {
      return refuse(403, PARTICIPATION_MESSAGES.needsAccount);
    }
    if (!guestsAllowed(board)) {
      return refuse(403, PARTICIPATION_MESSAGES.needsAccountBoard);
    }
  }
  if (viewer.banned || board.viewerBlocked) {
    return refuse(403, PARTICIPATION_MESSAGES.blocked);
  }
  return { ok: true };
}

/** What the viewer may do, for the board and task payloads. */
export function viewerCan(viewer: PublicViewer, board: BoardFacts) {
  const can = (action: ParticipationAction) =>
    participationDecision(viewer, board, action).ok;
  return {
    comment: can("comment"),
    react: can("react"),
    vote: can("vote"),
    request: can("request"),
  };
}

import { describe, expect, it } from "vitest";
import {
  isReadOnlyBoard,
  participationState,
  signInHref,
} from "./participation";

type Kind = "visitor" | "guest" | "account";

function boardFor(
  kind: Kind,
  {
    can = false,
    blocked = false,
    guestsAllowed = false,
    guestSignIn = true,
    participation = true,
    features = true,
  }: {
    can?: boolean;
    blocked?: boolean;
    guestsAllowed?: boolean;
    guestSignIn?: boolean;
    participation?: boolean;
    features?: boolean;
  } = {},
) {
  return {
    board: {
      layouts: ["board" as const],
      defaultLayout: "board" as const,
      comments: features,
      reactions: features,
      votes: features,
      requests: features,
      guestsAllowed,
      showAssignees: false,
      showBacklog: false,
    },
    participation,
    viewer: {
      kind,
      name: kind === "visitor" ? null : "Ana",
      image: null,
      isMember: false,
      blocked,
      can: { comment: can, react: can, vote: can, request: can },
    },
    instance: {
      name: "Margaya",
      guestSignInAvailable: guestSignIn,
      signUpAvailable: true,
    },
  };
}

describe("participationState", () => {
  it("lets an allowed account take part", () => {
    for (const action of ["comment", "react", "vote", "request"] as const) {
      expect(
        participationState(boardFor("account", { can: true }), action),
      ).toEqual({ prompt: "allowed", guestOption: false });
    }
  });

  it("asks a visitor to sign in, offering guests only for comments and reactions", () => {
    const board = boardFor("visitor", { guestsAllowed: true });
    expect(participationState(board, "comment")).toEqual({
      prompt: "signIn",
      guestOption: true,
    });
    expect(participationState(board, "react").guestOption).toBe(true);
    expect(participationState(board, "vote")).toEqual({
      prompt: "signIn",
      guestOption: false,
    });
    expect(participationState(board, "request").guestOption).toBe(false);
  });

  it("offers no guest option when the board or the server refuses guests", () => {
    expect(participationState(boardFor("visitor"), "comment").guestOption).toBe(
      false,
    );
    expect(
      participationState(
        boardFor("visitor", { guestsAllowed: true, guestSignIn: false }),
        "comment",
      ).guestOption,
    ).toBe(false);
  });

  it("tells a guest when the board needs an account", () => {
    expect(participationState(boardFor("guest"), "comment").prompt).toBe(
      "accountRequired",
    );
    expect(participationState(boardFor("guest"), "react").prompt).toBe(
      "accountRequired",
    );
  });

  it("tells a guest that votes and requests need an account", () => {
    const board = boardFor("guest", { guestsAllowed: true });
    expect(participationState(board, "vote").prompt).toBe("accountForAction");
    expect(participationState(board, "request").prompt).toBe(
      "accountForAction",
    );
  });

  it("shows the blocked message to blocked people", () => {
    expect(
      participationState(boardFor("account", { blocked: true }), "comment")
        .prompt,
    ).toBe("blocked");
    expect(
      participationState(boardFor("guest", { blocked: true }), "vote").prompt,
    ).toBe("blocked");
    // An account the server still refuses (an instance ban).
    expect(participationState(boardFor("account"), "vote").prompt).toBe(
      "blocked",
    );
  });

  it("hides everything when participation or the feature is off", () => {
    expect(
      participationState(
        boardFor("visitor", { participation: false }),
        "comment",
      ).prompt,
    ).toBe("hidden");
    expect(
      participationState(boardFor("account", { features: false }), "vote")
        .prompt,
    ).toBe("hidden");
  });
});

describe("isReadOnlyBoard", () => {
  it("is read-only when nothing can be done", () => {
    expect(isReadOnlyBoard(boardFor("visitor"))).toBe(false);
    expect(isReadOnlyBoard(boardFor("visitor", { features: false }))).toBe(
      true,
    );
    expect(isReadOnlyBoard(boardFor("visitor", { participation: false }))).toBe(
      true,
    );
  });
});

describe("signInHref", () => {
  it("returns to the exact board view after signing in", () => {
    expect(signInHref("/public-project/abc?task=12")).toBe(
      "/auth/sign-in?redirect=%2Fpublic-project%2Fabc%3Ftask%3D12",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  PARTICIPATION_MESSAGES as M,
  type ParticipationAction,
  participationDecision,
  viewerCan,
} from "../../../apps/api/src/public-board/participation";
import type { PublicViewer } from "../../../apps/api/src/public-board/types";
import { DEFAULT_PUBLICATION_SETTINGS } from "../../../apps/api/src/publication/settings";

const ACTIONS: ParticipationAction[] = [
  "comment",
  "react",
  "vote",
  "request",
  "manageOwnComment",
  "manageOwnRequest",
];

function viewer(
  kind: PublicViewer["kind"],
  extra: Partial<PublicViewer> = {},
): PublicViewer {
  return {
    kind,
    userId: kind === "visitor" ? null : "u1",
    name: kind === "visitor" ? null : "Ada",
    image: null,
    banned: false,
    apiKey: false,
    malformedAuth: false,
    ...extra,
  };
}

function board(
  overrides: {
    settings?: Partial<typeof DEFAULT_PUBLICATION_SETTINGS>;
    intakeEnabled?: boolean;
    viewerBlocked?: boolean;
    participation?: boolean;
    guestAccessActive?: boolean;
  } = {},
) {
  return {
    settings: {
      ...DEFAULT_PUBLICATION_SETTINGS,
      commentsEnabled: true,
      reactionsEnabled: true,
      votesEnabled: true,
      requestsEnabled: true,
      allowGuests: true,
      ...overrides.settings,
    },
    intakeEnabled: overrides.intakeEnabled ?? true,
    viewerBlocked: overrides.viewerBlocked ?? false,
    instance: {
      publicBoards: true,
      participation: overrides.participation ?? true,
      guestAccessActive: overrides.guestAccessActive ?? true,
      instanceName: "Margaya",
      signUpAvailable: true,
    },
  };
}

describe("participation gate", () => {
  it("lets accounts do everything on a fully open board", () => {
    for (const action of ACTIONS) {
      expect(participationDecision(viewer("account"), board(), action)).toEqual(
        { ok: true },
      );
    }
  });

  it("checks in order: participation, feature, API key, visitor, guest, block", () => {
    const account = viewer("account", { apiKey: true, banned: true });
    expect(
      participationDecision(account, board({ participation: false }), "vote"),
    ).toEqual({ ok: false, status: 403, message: M.participationOff });
    expect(
      participationDecision(
        account,
        board({ settings: { votesEnabled: false } }),
        "vote",
      ),
    ).toEqual({ ok: false, status: 403, message: M.votesOff });
    expect(participationDecision(account, board(), "vote")).toEqual({
      ok: false,
      status: 403,
      message: M.apiKey,
    });
    expect(
      participationDecision(viewer("visitor"), board(), "comment"),
    ).toEqual({ ok: false, status: 401, message: M.signIn });
    expect(
      participationDecision(
        viewer("visitor", { malformedAuth: true }),
        board(),
        "react",
      ),
    ).toMatchObject({ status: 401 });
    expect(
      participationDecision(
        viewer("account", { banned: true }),
        board(),
        "vote",
      ),
    ).toEqual({ ok: false, status: 403, message: M.blocked });
    expect(
      participationDecision(
        viewer("account"),
        board({ viewerBlocked: true }),
        "comment",
      ),
    ).toEqual({ ok: false, status: 403, message: M.blocked });
  });

  it("names the switched-off feature", () => {
    const off = board({
      settings: {
        commentsEnabled: false,
        reactionsEnabled: false,
        votesEnabled: false,
        requestsEnabled: false,
      },
    });
    const messages = ACTIONS.map((action) => {
      const decision = participationDecision(viewer("account"), off, action);
      return decision.ok ? null : decision.message;
    });
    expect(messages).toEqual([
      M.commentsOff,
      M.reactionsOff,
      M.votesOff,
      M.requestsOff,
      M.commentsOff,
      M.requestsOff,
    ]);
  });

  it("needs the project's intake feature for requests", () => {
    expect(
      participationDecision(
        viewer("account"),
        board({ intakeEnabled: false }),
        "request",
      ),
    ).toEqual({ ok: false, status: 403, message: M.requestsOff });
  });

  it("keeps guests to comments and reactions where allowed", () => {
    const guest = viewer("guest");
    expect(participationDecision(guest, board(), "comment")).toEqual({
      ok: true,
    });
    expect(participationDecision(guest, board(), "react")).toEqual({
      ok: true,
    });
    for (const action of ["vote", "request", "manageOwnRequest"] as const) {
      expect(participationDecision(guest, board(), action)).toEqual({
        ok: false,
        status: 403,
        message: M.needsAccount,
      });
    }
    for (const closed of [
      board({ settings: { allowGuests: false } }),
      board({ guestAccessActive: false }),
    ]) {
      expect(participationDecision(guest, closed, "comment")).toEqual({
        ok: false,
        status: 403,
        message: M.needsAccountBoard,
      });
    }
  });

  it("lets a guest author manage their comment after guests are turned off", () => {
    const closed = board({ settings: { allowGuests: false } });
    expect(
      participationDecision(viewer("guest"), closed, "manageOwnComment"),
    ).toEqual({ ok: true });
    expect(
      participationDecision(
        viewer("guest", { banned: true }),
        closed,
        "manageOwnComment",
      ),
    ).toMatchObject({ ok: false, message: M.blocked });
  });

  it("summarizes what the viewer can do", () => {
    expect(viewerCan(viewer("visitor"), board())).toEqual({
      comment: false,
      react: false,
      vote: false,
      request: false,
    });
    expect(viewerCan(viewer("guest"), board())).toEqual({
      comment: true,
      react: true,
      vote: false,
      request: false,
    });
    expect(viewerCan(viewer("account"), board())).toEqual({
      comment: true,
      react: true,
      vote: true,
      request: true,
    });
  });
});

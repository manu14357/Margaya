import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf } from "../../demo";
import { createPublicBoardScene } from "./public-board-scene";
import { initialPublicBoardState, publicBoardReducer } from "./state";

const demo = messages.landing.demo;

describe("public board scene", () => {
  it("ends with the votes counted, the request sent and the toast up", () => {
    const final = finalStateOf(createPublicBoardScene(demo));
    expect(final.votes.export).toBe(initialPublicBoardState.votes.export + 2);
    expect(final.votes.sso).toBe(initialPublicBoardState.votes.sso + 1);
    expect(final.votes.offline).toBe(initialPublicBoardState.votes.offline + 1);
    expect(final.mine).toBe("offline");
    expect(final.peek).toBeNull();
    expect(final.request.open).toBe(false);
    expect(final.sent).toBe(1);
    expect(final.toast).toBe(true);
  });

  it("toggles and moves the visitor's single upvote", () => {
    const up = publicBoardReducer(initialPublicBoardState, {
      type: "upvote",
      id: "sso",
    });
    expect(up.votes.sso).toBe(42);
    const moved = publicBoardReducer(up, { type: "upvote", id: "search" });
    expect(moved.votes.sso).toBe(41);
    expect(moved.votes.search).toBe(24);
    expect(moved.mine).toBe("search");
    const removed = publicBoardReducer(moved, { type: "upvote", id: "search" });
    expect(removed.votes.search).toBe(23);
    expect(removed.mine).toBeNull();
  });

  it("does not send an empty request", () => {
    const open = publicBoardReducer(initialPublicBoardState, {
      type: "openRequest",
    });
    expect(publicBoardReducer(open, { type: "sendRequest" })).toBe(open);
  });
});

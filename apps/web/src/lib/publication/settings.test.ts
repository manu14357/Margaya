import { describe, expect, it } from "vitest";
import type { ProjectPublication } from "@/types/publication";
import {
  applyPublicationPatch,
  layoutPatch,
  publicBoardUrl,
  publicCommentsOpen,
} from "./settings";

const publication: ProjectPublication = {
  projectId: "p1",
  published: true,
  publishedAt: "2026-10-01T00:00:00.000Z",
  publishedBy: null,
  linkToken: "abcdefghijklmnopqrstuv",
  path: "/public-project/abcdefghijklmnopqrstuv",
  layouts: ["board", "list"],
  defaultLayout: "list",
  commentsEnabled: false,
  reactionsEnabled: false,
  votesEnabled: false,
  requestsEnabled: false,
  allowGuests: false,
  showAssignees: false,
  showBacklog: false,
  availability: {
    publicBoards: true,
    participation: true,
    requests: false,
    guests: true,
  },
  canManage: true,
  updatedAt: "2026-10-01T00:00:00.000Z",
};

describe("layoutPatch", () => {
  it("adds and removes layouts in board, list order", () => {
    expect(layoutPatch(["list"], "board", true)).toEqual({
      layouts: ["board", "list"],
    });
    expect(layoutPatch(["board", "list"], "board", false)).toEqual({
      layouts: ["list"],
    });
  });

  it("keeps at least one layout and ignores no-ops", () => {
    expect(layoutPatch(["board"], "board", false)).toBeNull();
    expect(layoutPatch(["board"], "board", true)).toBeNull();
    expect(layoutPatch(["board"], "list", false)).toBeNull();
  });
});

describe("applyPublicationPatch", () => {
  it("moves the default layout when it is removed", () => {
    expect(
      applyPublicationPatch(publication, { layouts: ["board"] }).defaultLayout,
    ).toBe("board");
    expect(
      applyPublicationPatch(publication, { commentsEnabled: true })
        .commentsEnabled,
    ).toBe(true);
  });
});

describe("publicBoardUrl and publicCommentsOpen", () => {
  it("builds the public URL from the path", () => {
    expect(publicBoardUrl(publication.path, "https://pm.example")).toBe(
      "https://pm.example/public-project/abcdefghijklmnopqrstuv",
    );
    expect(publicBoardUrl(null, "https://pm.example")).toBe("");
  });

  it("opens public comments only on a published board with comments on", () => {
    expect(publicCommentsOpen(publication)).toBe(false);
    expect(publicCommentsOpen({ ...publication, commentsEnabled: true })).toBe(
      true,
    );
    expect(
      publicCommentsOpen({
        ...publication,
        commentsEnabled: true,
        published: false,
      }),
    ).toBe(false);
    expect(publicCommentsOpen(null)).toBe(false);
  });
});

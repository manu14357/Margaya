import { describe, expect, it } from "vitest";
import type { WhiteboardSummary } from "@/types/whiteboard";
import { isSafeCssColor, presenceFromBoardStates } from "./board-presence";
import { boardFileName } from "./export-file-name";
import {
  DEFAULT_WHITEBOARD_SORT,
  isWhiteboardSort,
  sortWhiteboards,
} from "./sort-whiteboards";
import {
  summaryCapabilities,
  whiteboardMenuItemIds,
} from "./whiteboard-capabilities";

type Board = Pick<
  WhiteboardSummary,
  "id" | "title" | "createdAt" | "updatedAt"
>;

const boards: Board[] = [
  {
    id: "a",
    title: "Roadmap",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-03-01T00:00:00Z",
  },
  {
    id: "b",
    title: "",
    createdAt: "2026-02-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "c",
    title: "brainstorm",
    createdAt: "2026-03-01T00:00:00Z",
    updatedAt: "2026-02-01T00:00:00Z",
  },
];

describe("sortWhiteboards", () => {
  it("puts the most recently edited first by default", () => {
    expect(
      sortWhiteboards(boards, DEFAULT_WHITEBOARD_SORT, "Untitled").map(
        (board) => board.id,
      ),
    ).toEqual(["a", "c", "b"]);
  });

  it("sorts by name with untitled boards under their label", () => {
    expect(
      sortWhiteboards(
        boards,
        { field: "title", direction: "asc" },
        "Untitled",
      ).map((board) => board.id),
    ).toEqual(["c", "a", "b"]);
  });

  it("accepts only known stored sorts", () => {
    expect(isWhiteboardSort({ field: "createdAt", direction: "asc" })).toBe(
      true,
    );
    expect(isWhiteboardSort({ field: "order", direction: "asc" })).toBe(false);
    expect(isWhiteboardSort(null)).toBe(false);
  });
});

describe("summaryCapabilities", () => {
  const board = { isLocked: false, archivedAt: null, createdBy: null };
  const rights = {
    userId: "me",
    canCreate: false,
    canUpdate: false,
    canDelete: false,
  };

  it("gives a viewer nothing to change", () => {
    expect(summaryCapabilities(board, rights)).toEqual({
      canEdit: false,
      canManage: false,
      canPublish: false,
      canDuplicate: false,
    });
  });

  it("lets a member manage only their own boards", () => {
    const member = { ...rights, canCreate: true, canUpdate: true };
    expect(summaryCapabilities(board, member).canManage).toBe(false);
    expect(
      summaryCapabilities(
        { ...board, createdBy: { id: "me", name: "Me", image: null } },
        member,
      ).canManage,
    ).toBe(true);
  });

  it("keeps locked and archived boards read-only and unpublishable", () => {
    const admin = {
      ...rights,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
    };
    expect(
      summaryCapabilities({ ...board, isLocked: true }, admin).canEdit,
    ).toBe(false);
    const archived = summaryCapabilities(
      { ...board, archivedAt: "2026-11-01T00:00:00Z" },
      admin,
    );
    expect(archived).toMatchObject({ canEdit: false, canPublish: false });
  });
});

describe("whiteboardMenuItemIds", () => {
  const all = {
    canEdit: true,
    canManage: true,
    canPublish: true,
    canDuplicate: true,
  };

  it("offers trash only for archived boards", () => {
    expect(whiteboardMenuItemIds({ archivedAt: null }, all)).toEqual([
      "copyLink",
      "rename",
      "icon",
      "duplicate",
      "share",
      "lock",
      "archive",
    ]);
    expect(
      whiteboardMenuItemIds({ archivedAt: "2026-11-01T00:00:00Z" }, all),
    ).toContain("delete");
  });

  it("shows a viewer only the safe items", () => {
    expect(
      whiteboardMenuItemIds(
        { archivedAt: null },
        {
          canEdit: false,
          canManage: false,
          canPublish: false,
          canDuplicate: false,
        },
        { withOpen: true },
      ),
    ).toEqual(["open", "openInNewTab", "copyLink"]);
  });
});

describe("presenceFromBoardStates", () => {
  const members: Record<string, { name: string; image: string | null }> = {
    ann: { name: "Ann", image: null },
    bo: { name: "Bo", image: "bo.png" },
  };
  const getMember = (id: string) => members[id] ?? null;

  it("lists other members once, with names from the member list", () => {
    const states = new Map<number, Record<string, unknown>>([
      [1, { user: { id: "me", name: "Me" } }],
      [2, { user: { id: "ann", name: "Mallory", color: "#ff0000" } }],
      [3, { user: { id: "ann", color: "#00ff00" } }],
      [4, { user: { id: "stranger" } }],
      [5, { user: { id: "bo", color: "url(javascript:alert(1))" } }],
    ]);
    const presence = presenceFromBoardStates(states, 1, getMember);
    expect(presence.map((entry) => [entry.userId, entry.name])).toEqual([
      ["ann", "Ann"],
      ["bo", "Bo"],
    ]);
    expect(presence[0]?.color).toBe("#ff0000");
    expect(isSafeCssColor(presence[1]?.color)).toBe(true);
    expect(presence[1]?.color.startsWith("#")).toBe(true);
  });
});

describe("boardFileName", () => {
  it("drops characters file systems refuse", () => {
    expect(boardFileName('Q1: plan / "draft"', "png", "Untitled")).toBe(
      "Q1 plan draft.png",
    );
  });

  it("falls back for empty or dot-only names", () => {
    expect(boardFileName("  ...  ", "svg", "Untitled board")).toBe(
      "Untitled board.svg",
    );
    expect(boardFileName("", "margaya-board", "Board")).toBe(
      "Board.margaya-board",
    );
  });
});

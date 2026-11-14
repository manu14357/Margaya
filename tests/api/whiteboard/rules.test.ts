import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/database", () => ({ default: {} }));

const {
  canEditBoard,
  canManageBoard,
  editableStateError,
  whiteboardCapabilities,
  WHITEBOARD_MESSAGES,
} = await import("../../../apps/api/src/whiteboard/rules");

const viewer = {
  userId: "viewer",
  canRead: true,
  canCreate: false,
  canUpdate: false,
  isManager: false,
};
const member = {
  userId: "member",
  canRead: true,
  canCreate: true,
  canUpdate: true,
  isManager: false,
};
const admin = {
  userId: "admin",
  canRead: true,
  canCreate: true,
  canUpdate: true,
  isManager: true,
};

const board = (overrides = {}) => ({
  createdById: "member",
  isLocked: false,
  archivedAt: null as Date | null,
  deletedAt: null as Date | null,
  ...overrides,
});

describe("whiteboard rules", () => {
  it("lets members edit and viewers only read", () => {
    expect(canEditBoard(board(), member)).toBe(true);
    expect(canEditBoard(board(), viewer)).toBe(false);
  });

  it("makes locked, archived and trashed boards read-only for everyone", () => {
    for (const state of [
      { isLocked: true },
      { archivedAt: new Date() },
      { deletedAt: new Date() },
    ]) {
      expect(canEditBoard(board(state), admin)).toBe(false);
      expect(canEditBoard(board(state), member)).toBe(false);
    }
    expect(editableStateError(board({ isLocked: true }))).toBe(
      WHITEBOARD_MESSAGES.locked,
    );
    expect(
      editableStateError(board({ isLocked: true, archivedAt: new Date() })),
    ).toBe(WHITEBOARD_MESSAGES.archived);
  });

  it("lets the creator manage their own board and managers any board", () => {
    expect(canManageBoard(board(), member)).toBe(true);
    expect(canManageBoard(board({ createdById: "someone" }), member)).toBe(
      false,
    );
    expect(canManageBoard(board({ createdById: "someone" }), admin)).toBe(true);
    expect(canManageBoard(board({ createdById: null }), member)).toBe(false);
    // A viewer who created a board before losing update rights can't manage it.
    expect(canManageBoard(board({ createdById: "viewer" }), viewer)).toBe(
      false,
    );
  });

  it("reports capabilities, with publishing for managers only", () => {
    expect(whiteboardCapabilities(board(), member)).toEqual({
      canEdit: true,
      canManage: true,
      canPublish: false,
      canDuplicate: true,
    });
    expect(whiteboardCapabilities(board(), admin).canPublish).toBe(true);
    expect(
      whiteboardCapabilities(board({ archivedAt: new Date() }), admin)
        .canPublish,
    ).toBe(false);
    expect(whiteboardCapabilities(board(), viewer)).toEqual({
      canEdit: false,
      canManage: false,
      canPublish: false,
      canDuplicate: false,
    });
  });
});

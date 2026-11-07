import { describe, expect, it } from "vitest";
import {
  canSeePage,
  duplicateTitle,
  editableStateError,
  isSingleEmoji,
  isValidLogo,
  type PageCaller,
  type PageState,
  pageCapabilities,
} from "../../../apps/api/src/page/rules";

const OWNER = "owner-1";

const callers = {
  owner: {
    userId: OWNER,
    canRead: true,
    canCreate: true,
    canUpdate: true,
    isManager: false,
  },
  member: {
    userId: "member-2",
    canRead: true,
    canCreate: true,
    canUpdate: true,
    isManager: false,
  },
  viewer: {
    userId: "viewer-3",
    canRead: true,
    canCreate: false,
    canUpdate: false,
    isManager: false,
  },
  manager: {
    userId: "admin-4",
    canRead: true,
    canCreate: true,
    canUpdate: true,
    isManager: true,
  },
} satisfies Record<string, PageCaller>;

function page(
  overrides: Partial<PageState> = {},
): PageState & { depth: number } {
  return {
    access: "public",
    ownerId: OWNER,
    isLocked: false,
    archivedAt: null,
    depth: 1,
    ...overrides,
  };
}

const LOCKED = { isLocked: true };
const ARCHIVED = { archivedAt: new Date("2026-01-01") };

describe("page visibility", () => {
  it("shows public pages to readers and private ones to their owner only", () => {
    for (const caller of Object.values(callers)) {
      expect(canSeePage(page(), caller)).toBe(true);
      expect(canSeePage(page({ access: "private" }), caller)).toBe(
        caller.userId === OWNER,
      );
    }
    expect(canSeePage(page(), { ...callers.member, canRead: false })).toBe(
      false,
    );
  });

  it("shows an ownerless private page to managers only", () => {
    const orphan = page({ access: "private", ownerId: null });
    expect(canSeePage(orphan, callers.manager)).toBe(true);
    expect(canSeePage(orphan, callers.member)).toBe(false);
    expect(canSeePage(orphan, callers.owner)).toBe(false);
  });
});

describe("page capabilities", () => {
  it("gives the owner everything but delete on an active public page", () => {
    expect(pageCapabilities(page(), callers.owner)).toEqual({
      canEdit: true,
      canLock: true,
      canChangeAccess: true,
      canArchive: true,
      canDelete: false,
      canDuplicate: true,
      canMove: true,
      canCreateSubpage: true,
      canRestoreVersion: true,
      canComment: true,
    });
  });

  it("lets other members edit public pages but not manage them", () => {
    expect(pageCapabilities(page(), callers.member)).toEqual({
      canEdit: true,
      canLock: false,
      canChangeAccess: false,
      canArchive: false,
      canDelete: false,
      canDuplicate: true,
      canMove: false,
      canCreateSubpage: true,
      canRestoreVersion: true,
      canComment: true,
    });
  });

  it("gives viewers nothing", () => {
    for (const state of [{}, LOCKED, ARCHIVED, { ...LOCKED, ...ARCHIVED }]) {
      const caps = pageCapabilities(page(state), callers.viewer);
      expect(Object.values(caps).every((value) => !value)).toBe(true);
    }
  });

  it("lets managers manage any visible page, but not change its access", () => {
    const caps = pageCapabilities(page(), callers.manager);
    expect(caps).toMatchObject({
      canEdit: true,
      canLock: true,
      canArchive: true,
      canMove: true,
      canChangeAccess: false,
      canDelete: false,
    });
    expect(pageCapabilities(page(ARCHIVED), callers.manager).canDelete).toBe(
      true,
    );
  });

  it("blocks editing and moving while locked, keeps lock and archive", () => {
    for (const caller of [callers.owner, callers.manager]) {
      const caps = pageCapabilities(page(LOCKED), caller);
      expect(caps).toMatchObject({
        canEdit: false,
        canRestoreVersion: false,
        canMove: false,
        canLock: true,
        canArchive: true,
        canDuplicate: true,
        canCreateSubpage: true,
        canComment: true,
      });
    }
    expect(pageCapabilities(page(LOCKED), callers.owner).canChangeAccess).toBe(
      true,
    );
  });

  it("allows only restore, lock, duplicate and delete while archived", () => {
    const owner = pageCapabilities(page(ARCHIVED), callers.owner);
    expect(owner).toEqual({
      canEdit: false,
      canLock: true,
      canChangeAccess: false,
      canArchive: true,
      canDelete: true,
      canDuplicate: true,
      canMove: false,
      canCreateSubpage: false,
      canRestoreVersion: false,
      canComment: false,
    });
    expect(pageCapabilities(page(ARCHIVED), callers.member).canDelete).toBe(
      false,
    );
    const both = pageCapabilities(
      page({ ...LOCKED, ...ARCHIVED }),
      callers.owner,
    );
    expect(both.canEdit).toBe(false);
    expect(both.canDelete).toBe(true);
  });

  it("gives nothing on someone else's private page, and owner rights on one's own", () => {
    const secret = page({ access: "private" });
    for (const caller of [callers.member, callers.viewer, callers.manager]) {
      expect(
        Object.values(pageCapabilities(secret, caller)).every((v) => !v),
      ).toBe(true);
    }
    expect(pageCapabilities(secret, callers.owner).canEdit).toBe(true);
  });

  it("lets managers manage an ownerless private page without editing it", () => {
    const orphan = page({ access: "private", ownerId: null });
    expect(pageCapabilities(orphan, callers.manager)).toMatchObject({
      canEdit: false,
      canLock: true,
      canArchive: true,
      canChangeAccess: false,
      canCreateSubpage: false,
    });
    expect(
      pageCapabilities({ ...orphan, ...ARCHIVED }, callers.manager).canDelete,
    ).toBe(true);
    const publicOrphan = page({ ownerId: null });
    expect(pageCapabilities(publicOrphan, callers.member)).toMatchObject({
      canEdit: true,
      canLock: false,
    });
  });

  it("stops sub-pages at depth 5", () => {
    expect(
      pageCapabilities({ ...page(), depth: 4 }, callers.owner).canCreateSubpage,
    ).toBe(true);
    expect(
      pageCapabilities({ ...page(), depth: 5 }, callers.owner).canCreateSubpage,
    ).toBe(false);
  });
});

describe("guards and values", () => {
  it("reports archived before locked", () => {
    expect(editableStateError(page())).toBeNull();
    expect(editableStateError(page(LOCKED))).toBe(
      "This page is locked. Unlock it to make changes.",
    );
    expect(editableStateError(page({ ...LOCKED, ...ARCHIVED }))).toBe(
      "This page is archived. Restore it to make changes.",
    );
  });

  it("validates logos", () => {
    const icons = new Set(["FileText"]);
    expect(isValidLogo(null, null, icons)).toBe(true);
    expect(isValidLogo("icon", "FileText", icons)).toBe(true);
    expect(isValidLogo("icon", "Nope", icons)).toBe(false);
    expect(isValidLogo("emoji", null, icons)).toBe(false);
    expect(isValidLogo(null, "🚀", icons)).toBe(false);
    for (const emoji of ["🚀", "👩‍💻", "🇫🇷", "1️⃣", "❤️"]) {
      expect(isSingleEmoji(emoji), emoji).toBe(true);
    }
    for (const value of ["a", "🚀🚀", "", "ab🚀"]) {
      expect(isSingleEmoji(value), value).toBe(false);
    }
  });

  it("names duplicates within 255 characters", () => {
    expect(duplicateTitle("Spec")).toBe("Spec (copy)");
    expect(duplicateTitle("  ")).toBe("Untitled (copy)");
    const long = duplicateTitle("x".repeat(255));
    expect(long).toHaveLength(255);
    expect(long.endsWith(" (copy)")).toBe(true);
    const surrogate = duplicateTitle(`${"x".repeat(247)}🚀`);
    expect(surrogate).toBe(`${"x".repeat(247)} (copy)`);
  });
});

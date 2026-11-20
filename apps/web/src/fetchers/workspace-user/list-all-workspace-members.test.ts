import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listAllWorkspaceMembers,
  MEMBER_PAGE_SIZE,
} from "./list-all-workspace-members";

const listMembers = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-client", () => ({
  AUTH_READ: { disableSignal: true },
  authClient: { organization: { listMembers } },
}));

function members(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `member-${index}`,
    userId: `user-${index}`,
  }));
}

beforeEach(() => listMembers.mockReset());

describe("listAllWorkspaceMembers", () => {
  it("makes one request, with an explicit limit, for a usual workspace", async () => {
    listMembers.mockResolvedValue({
      data: { members: members(12), total: 12 },
      error: null,
    });

    const result = await listAllWorkspaceMembers("ws-1");

    expect(result?.members).toHaveLength(12);
    expect(listMembers).toHaveBeenCalledTimes(1);
    expect(listMembers).toHaveBeenCalledWith({
      query: { organizationId: "ws-1", limit: MEMBER_PAGE_SIZE },
      fetchOptions: { disableSignal: true },
    });
  });

  it("asks once more for every member when the first page falls short", async () => {
    const total = MEMBER_PAGE_SIZE + 140;
    listMembers
      .mockResolvedValueOnce({
        data: { members: members(MEMBER_PAGE_SIZE), total },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { members: members(total), total },
        error: null,
      });

    const result = await listAllWorkspaceMembers("ws-1");

    expect(result?.members).toHaveLength(total);
    expect(listMembers).toHaveBeenCalledTimes(2);
    expect(listMembers).toHaveBeenLastCalledWith({
      query: { organizationId: "ws-1", limit: total },
      fetchOptions: { disableSignal: true },
    });
  });

  it("throws the server's error", async () => {
    listMembers.mockResolvedValue({
      data: null,
      error: { message: "Forbidden" },
    });
    await expect(listAllWorkspaceMembers("ws-1")).rejects.toThrow("Forbidden");
  });
});

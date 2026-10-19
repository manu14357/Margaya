import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCreatedTaskCheck } from "./use-created-task-check";

const toastInfo = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: { info: toastInfo } }));

afterEach(() => vi.clearAllMocks());

function result(
  taskIds: string[],
  nextCursor: string | null = null,
): { data: unknown } {
  return {
    data: {
      hasMoreGroups: false,
      groups: [{ key: "all", taskIds, nextCursor }],
      tasks: Object.fromEntries(taskIds.map((id) => [id, { id }])),
    },
  };
}

async function check(refetched: { data: unknown }) {
  const refetch = vi.fn().mockResolvedValue(refetched);
  const { result: hook } = renderHook(() =>
    useCreatedTaskCheck({ refetch } as never, "w1"),
  );
  await hook.current({ id: "new", projectId: "p1" });
  expect(refetch).toHaveBeenCalledTimes(1);
}

describe("useCreatedTaskCheck", () => {
  it("stays quiet when the new task shows in the list", async () => {
    await check(result(["a", "new"]));
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("says so when the view's filters leave the new task out", async () => {
    await check(result(["a"]));
    expect(toastInfo).toHaveBeenCalledWith(
      "tasks:capture.notInView",
      expect.objectContaining({
        action: expect.objectContaining({ label: "tasks:capture.open" }),
      }),
    );
  });

  it("stays quiet while a group has more pages that may hold it", async () => {
    await check(result(["a"], "cursor"));
    expect(toastInfo).not.toHaveBeenCalled();
  });
});

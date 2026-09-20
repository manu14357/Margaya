import { describe, expect, it, vi } from "vitest";
import { handleHomeUserMessage } from "./home-realtime";

function client() {
  return { invalidateQueries: vi.fn() };
}

describe("handleHomeUserMessage", () => {
  it.each([
    ["STICKIES_UPDATED", "stickies"],
    ["QUICK_LINKS_UPDATED", "quick-links"],
    ["HOME_PREFERENCES_UPDATED", "home-preferences"],
  ])("%s from another window invalidates the %s prefix", (type, root) => {
    const queryClient = client();
    const handled = handleHomeUserMessage(
      queryClient,
      { type, workspaceId: "ws-1", originWindowId: "other-tab" },
      "this-tab",
    );
    expect(handled).toBe(true);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: [root, "ws-1"],
    });
  });

  it("does nothing for this window's own change", () => {
    const queryClient = client();
    expect(
      handleHomeUserMessage(
        queryClient,
        {
          type: "STICKIES_UPDATED",
          workspaceId: "ws-1",
          originWindowId: "this-tab",
        },
        "this-tab",
      ),
    ).toBe(true);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it("refetches when the change came from outside a browser tab", () => {
    const queryClient = client();
    handleHomeUserMessage(
      queryClient,
      {
        type: "QUICK_LINKS_UPDATED",
        workspaceId: "ws-1",
        originWindowId: null,
      },
      "this-tab",
    );
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["quick-links", "ws-1"],
    });
  });

  it("ignores other message types", () => {
    const queryClient = client();
    expect(
      handleHomeUserMessage(
        queryClient,
        { type: "FAVORITES_UPDATED", workspaceId: "ws-1" },
        "this-tab",
      ),
    ).toBe(false);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });
});

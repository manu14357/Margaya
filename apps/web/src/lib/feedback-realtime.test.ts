import { describe, expect, it, vi } from "vitest";
import { handleFeedbackUserMessage } from "./feedback-realtime";

describe("handleFeedbackUserMessage", () => {
  it("refreshes the admin feedback views on FEEDBACK_UPDATED", () => {
    const invalidateQueries = vi.fn();
    expect(
      handleFeedbackUserMessage(
        { invalidateQueries },
        { type: "FEEDBACK_UPDATED" },
      ),
    ).toBe(true);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["feedback", "admin"],
    });
  });

  it("ignores other messages", () => {
    const invalidateQueries = vi.fn();
    expect(
      handleFeedbackUserMessage(
        { invalidateQueries },
        { type: "NOTIFICATION_CREATED" },
      ),
    ).toBe(false);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});

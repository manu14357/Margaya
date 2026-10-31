import { describe, expect, it } from "vitest";
import { notificationCreatedEvent } from "../../../apps/api/src/notification/created-event";

describe("notificationCreatedEvent", () => {
  it("carries ids, the type and the reply and question flags, no content", () => {
    expect(
      notificationCreatedEvent({
        id: "n1",
        userId: "u1",
        type: "task_comment",
        eventData: {
          parentCommentId: "c0",
          commentPreview: "Secret words",
        },
      }),
    ).toEqual({
      notificationId: "n1",
      userId: "u1",
      notificationType: "task_comment",
      reply: true,
      needsInput: false,
    });
  });

  it("flags an agent's question", () => {
    expect(
      notificationCreatedEvent({
        id: "n2",
        userId: "u1",
        type: "ai_agent_reply",
        eventData: { runId: "r1", needsInput: true },
      }),
    ).toMatchObject({ reply: false, needsInput: true });
  });

  it("treats missing or odd event data as no flags", () => {
    for (const eventData of [null, "text", 3, { needsInput: "yes" }]) {
      expect(
        notificationCreatedEvent({
          id: "n3",
          userId: "u1",
          type: "info",
          eventData,
        }),
      ).toMatchObject({ reply: false, needsInput: false });
    }
  });
});

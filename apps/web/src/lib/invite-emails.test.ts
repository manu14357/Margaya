import { describe, expect, it, vi } from "vitest";
import { HttpError } from "./http-error";
import { parseEmailList, sendInvitesInSequence } from "./invite-emails";

describe("parseEmailList", () => {
  it("splits on commas, semicolons, spaces and new lines", () => {
    expect(
      parseEmailList("a@x.io, b@x.io\nc@x.io;d@x.io  e@x.io").valid,
    ).toEqual(["a@x.io", "b@x.io", "c@x.io", "d@x.io", "e@x.io"]);
  });

  it("drops duplicates ignoring case and reports invalid entries", () => {
    expect(parseEmailList("A@x.io a@x.io nope, b@x.io")).toEqual({
      valid: ["A@x.io", "b@x.io"],
      invalid: ["nope"],
    });
    expect(parseEmailList("  \n ,")).toEqual({ valid: [], invalid: [] });
  });
});

describe("sendInvitesInSequence", () => {
  const messages = { fallbackMessage: "failed", rateLimitedMessage: "slow" };

  it("sends one at a time and reports each failure with its reason", async () => {
    let inFlight = 0;
    const send = vi.fn(async (email: string) => {
      inFlight += 1;
      expect(inFlight).toBe(1);
      await Promise.resolve();
      inFlight -= 1;
      if (email === "b@x.io") throw new Error("Already invited");
      return { id: `id-${email}` };
    });
    const result = await sendInvitesInSequence(
      ["a@x.io", "b@x.io", "c@x.io"],
      send,
      messages,
    );
    expect(send).toHaveBeenCalledTimes(3);
    expect(result.sent).toEqual([
      { email: "a@x.io", id: "id-a@x.io" },
      { email: "c@x.io", id: "id-c@x.io" },
    ]);
    expect(result.failed).toEqual([
      { email: "b@x.io", message: "Already invited" },
    ]);
  });

  it("stops at a rate limit and marks the rest as not sent", async () => {
    const send = vi.fn(async (email: string) => {
      if (email === "b@x.io") throw new HttpError(429, "Too many requests");
      return { id: email };
    });
    const progress: number[] = [];
    const result = await sendInvitesInSequence(
      ["a@x.io", "b@x.io", "c@x.io"],
      send,
      { ...messages, onProgress: (done) => progress.push(done) },
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.sent.map((entry) => entry.email)).toEqual(["a@x.io"]);
    expect(result.failed).toEqual([
      { email: "b@x.io", message: "slow" },
      { email: "c@x.io", message: "slow" },
    ]);
    expect(progress.at(-1)).toBe(3);
  });
});

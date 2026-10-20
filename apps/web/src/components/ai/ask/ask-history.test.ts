import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AskConversation,
  clearAllAskHistory,
  conversationMarkdown,
  conversationTitle,
  historyKey,
  MAX_CONVERSATIONS,
  readHistory,
  readTurn,
  writeHistory,
} from "./ask-history";

const KEY = historyKey("u1", "w1");

function conversation(index: number): AskConversation {
  return {
    id: `c${index}`,
    projectId: null,
    createdAt: index,
    updatedAt: index,
    title: null,
    pinned: false,
    turns: [
      {
        question: `Question ${index}`,
        answer: "Answer",
        sources: [],
        citations: [],
        noResults: false,
        status: "done",
        errorKey: null,
        followUps: [],
        context: [],
        reasoningMs: null,
        meta: null,
      },
    ],
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("Ask history storage", () => {
  it("keeps one entry per person and workspace", () => {
    expect(historyKey("u1", "w1")).not.toBe(historyKey("u2", "w1"));
    expect(historyKey("u1", "w1")).not.toBe(historyKey("u1", "w2"));
  });

  it("round-trips, newest first, and caps the number kept", () => {
    const all = Array.from({ length: MAX_CONVERSATIONS + 5 }, (_, index) =>
      conversation(index),
    );
    writeHistory(KEY, { conversations: all, currentId: "c54" });
    const history = readHistory(KEY);
    expect(history.conversations).toHaveLength(MAX_CONVERSATIONS);
    expect(history.conversations[0]?.id).toBe("c54");
    expect(history.conversations.at(-1)?.id).toBe("c5");
    expect(history.currentId).toBe("c54");
  });

  it("ignores malformed or foreign data", () => {
    localStorage.setItem(KEY, "{not json");
    expect(readHistory(KEY)).toEqual({ conversations: [], currentId: null });

    localStorage.setItem(
      KEY,
      JSON.stringify({
        currentId: "gone",
        conversations: [
          { id: "ok", updatedAt: 1, turns: [{ question: "Hi", status: "x" }] },
          { id: "empty", updatedAt: 2, turns: [] },
          "junk",
        ],
      }),
    );
    const history = readHistory(KEY);
    expect(history.currentId).toBeNull();
    expect(history.conversations).toHaveLength(1);
    expect(history.conversations[0]?.turns[0]).toMatchObject({
      question: "Hi",
      answer: "",
      status: "done",
    });
  });

  it("drops older conversations when the quota is full, and never throws", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value) {
        if (value.length > 600) throw new Error("QuotaExceededError");
        Storage.prototype.removeItem.call(this, key);
      });
    const result = writeHistory(KEY, {
      conversations: [1, 2, 3, 4, 5, 6, 7, 8].map(conversation),
      currentId: "c8",
    });
    expect(setItem).toHaveBeenCalled();
    expect(result.conversations.length).toBeLessThan(8);
    expect(result.conversations[0]?.id).toBe("c8");

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readHistory(KEY)).toEqual({ conversations: [], currentId: null });
  });

  it("clears every saved conversation on this browser and nothing else", () => {
    writeHistory(KEY, { conversations: [conversation(1)], currentId: null });
    writeHistory(historyKey("u2", "w9"), {
      conversations: [conversation(2)],
      currentId: null,
    });
    localStorage.setItem("other", "1");
    clearAllAskHistory();
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem("other")).toBe("1");
  });
});

describe("Ask history titles, pins and richer turns", () => {
  it("keeps a renamed title and the pin, and falls back to the first question", () => {
    const renamed = {
      ...conversation(1),
      title: "Release notes",
      pinned: true,
    };
    writeHistory(KEY, {
      conversations: [renamed, conversation(2)],
      currentId: null,
    });
    const read = readHistory(KEY).conversations;
    const one = read.find((item) => item.id === "c1");
    expect(one?.title).toBe("Release notes");
    expect(one?.pinned).toBe(true);
    expect(conversationTitle(one as AskConversation)).toBe("Release notes");
    const two = read.find((item) => item.id === "c2");
    expect(two?.title).toBeNull();
    expect(conversationTitle(two as AskConversation)).toBe("Question 2");
  });

  it("reads follow-ups, context and the model but never trusts bad data", () => {
    const turn = readTurn({
      question: "Q",
      answer: "A",
      followUps: ["Chart it", 3, "Who owns these?"],
      context: [
        { kind: "task", id: "t1", label: "WEB-1 Fix" },
        { kind: "nope", id: "x", label: "bad" },
      ],
      reasoningMs: 2400,
      meta: {
        provider: "openai_compatible",
        model: "m1",
        destination: "local",
      },
      reasoning: "never kept",
    });
    expect(turn).toMatchObject({
      followUps: ["Chart it", "Who owns these?"],
      context: [{ kind: "task", id: "t1", label: "WEB-1 Fix" }],
      reasoningMs: 2400,
      meta: { model: "m1", destination: "local" },
    });
    expect(turn && "reasoning" in turn).toBe(false);
    expect(
      readTurn({ question: "Q", reasoningMs: -5 })?.reasoningMs,
    ).toBeNull();
  });

  it("exports a conversation as Markdown", () => {
    expect(
      conversationMarkdown(
        "Title",
        [{ question: "What?\nNow", answer: " Done. " }],
        {
          you: "You",
          answer: "Answer",
        },
      ),
    ).toBe("# Title\n\n---\n\n**You:** What? Now\n\n**Answer:**\n\nDone.");
  });
});

import { describe, expect, it } from "vitest";
import {
  confirmIntent,
  createSilenceDetector,
  speakableText,
  speechChunks,
} from "./voice-reply";

const notes = {
  chartNote: "A chart is on screen.",
  moreNote: "More is on screen.",
};

describe("silence detection", () => {
  // Feeds a level every 50 ms from `from` to `to` (ms).
  const feed = (
    detector: ReturnType<typeof createSilenceDetector>,
    from: number,
    to: number,
    level: number,
  ) => {
    let event = null;
    for (let now = from; now <= to && !event; now += 50) {
      event = detector.update(level, now);
      if (event) return { event, at: now };
    }
    return { event, at: to };
  };

  it("ends after speech and a pause, following the room's level", () => {
    const detector = createSilenceDetector();
    feed(detector, 0, 250, 0.03); // a noisy room: threshold becomes 0.09
    expect(feed(detector, 300, 1_000, 0.05).event).toBeNull(); // not speech here
    expect(feed(detector, 1_050, 2_000, 0.3).event).toBeNull(); // speaking
    expect(detector.heard).toBe(true);
    const { event, at } = feed(detector, 2_050, 5_000, 0.04);
    expect(event).toBe("end");
    expect(at).toBeGreaterThanOrEqual(3_150);
    expect(at).toBeLessThan(3_300);
  });

  it("ignores a short noise and gives up when nothing is said", () => {
    const detector = createSilenceDetector();
    feed(detector, 0, 250, 0);
    feed(detector, 300, 450, 0.5); // a click: shorter than 400 ms
    const { event, at } = feed(detector, 500, 10_000, 0);
    expect(event).toBe("no-speech");
    expect(at).toBe(8_000);
  });

  it("stops at the length limit", () => {
    const detector = createSilenceDetector({ maxMs: 2_000 });
    expect(feed(detector, 0, 3_000, 0.5).event).toBe("max");
  });
});

describe("speakable text", () => {
  it("drops citations, Markdown, tables and follow-ups", () => {
    const answer = [
      "## Blockers",
      "Two tasks are blocked [T:WEB-5] [T:WEB-6]:",
      "- **WEB-5** waits on a page inventory [C:WEB-5/abc]",
      "- WEB-6 waits on [pricing](https://x.test/p)",
      "| Task | Status |",
      "| --- | --- |",
      "",
      "```followups",
      '["Who owns them?"]',
      "```",
    ].join("\n");
    expect(speakableText(answer, notes)).toBe(
      "Blockers. Two tasks are blocked: WEB-5 waits on a page inventory. WEB-6 waits on pricing.",
    );
  });

  it("tidies the punctuation citations leave behind", () => {
    expect(
      speakableText(
        "Sprint 1: WEB-1 [T:WEB-1], WEB-2 [T:WEB-2], [T:WEB-3], and Sprint 2 ([T:WEB-5]). WEB-2 has no due date [T:WEB-2],.",
        notes,
      ),
    ).toBe("Sprint 1: WEB-1, WEB-2, and Sprint 2. WEB-2 has no due date.");
  });

  it("says a chart is on screen and shortens long answers", () => {
    const chart = 'Here it is.\n```chart\n{"type":"bar"}\n```';
    expect(speakableText(chart, notes)).toBe(
      "Here it is. A chart is on screen.",
    );
    const long = "This is one sentence about the work. ".repeat(30);
    const spoken = speakableText(long, notes);
    expect(spoken.length).toBeLessThan(650);
    expect(spoken.endsWith("More is on screen.")).toBe(true);
  });
});

describe("speech chunks", () => {
  it("keeps whole sentences under the limit", () => {
    const chunks = speechChunks(
      `One short. Two short. ${"A long sentence, with commas, ".repeat(12)}`,
      120,
    );
    expect(chunks[0]).toBe("One short. Two short.");
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(120);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toContain("with commas");
  });
});

describe("confirm intent", () => {
  const words = {
    confirm: "confirm, yes, go ahead, do it",
    cancel: "cancel, no, stop",
  };
  it("reads short replies", () => {
    expect(confirmIntent("Yes!", words)).toBe("confirm");
    expect(confirmIntent("Go ahead please.", words)).toBe("confirm");
    expect(confirmIntent("No, cancel that", words)).toBe("cancel");
  });
  it("leaves long or mixed replies to be a new request", () => {
    expect(
      confirmIntent(
        "yes and also create a task for the launch checklist please",
        words,
      ),
    ).toBeNull();
    expect(confirmIntent("yes no", words)).toBeNull();
    expect(confirmIntent("nothing", words)).toBeNull();
  });
});

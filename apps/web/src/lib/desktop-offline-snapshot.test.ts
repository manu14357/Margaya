import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOfflineSnapshot,
  capUtf8,
  createOfflineSnapshotSender,
  OFFLINE_BODY_MAX_BYTES,
  offlineTextFromMarkdown,
} from "./desktop-offline-snapshot";

const bytes = (text: string) => new TextEncoder().encode(text).length;

function fakeWindow(bridge?: unknown) {
  return { __MARGAYA_DESKTOP__: bridge } as unknown as Window;
}

const base = {
  kind: "task" as const,
  id: "task-1",
  path: "/dashboard/workspace/w/project/p/task/task-1",
  title: "Fix the login",
};

describe("offlineTextFromMarkdown", () => {
  it("keeps readable text and simple structure, drops markup", () => {
    const text = offlineTextFromMarkdown(
      [
        "# Plan",
        "Read **the docs** at [the guide](https://example.com/guide).",
        "<p>Para<br>graph</p><script>alert(1)</script>",
        "![diagram](https://example.com/a.png)",
        "> quoted",
        "```ts",
        "const a = 1;",
        "```",
        "- [ ] open",
        "- [x] done",
        "Fish &amp; chips &lt;3 &#x1F600;",
        "",
        "",
        "",
        "End",
      ].join("\r\n"),
    );
    expect(text).toBe(
      [
        "# Plan",
        "Read the docs at the guide.",
        "Para",
        "graph",
        "alert(1)",
        "diagram",
        "quoted",
        "const a = 1;",
        "- [ ] open",
        "- [x] done",
        "Fish & chips <3 😀",
        "",
        "End",
      ].join("\n"),
    );
    expect(text).not.toMatch(/<[a-z/]/i);
  });

  it("removes control characters but keeps tabs and line breaks", () => {
    expect(offlineTextFromMarkdown("a\u0000b\u0007c\td\ne\u009f")).toBe(
      "abc\td\ne",
    );
    expect(offlineTextFromMarkdown(null)).toBe("");
  });

  it("caps the body in UTF-8 bytes without splitting a character", () => {
    const long = "é".repeat(OFFLINE_BODY_MAX_BYTES);
    const text = offlineTextFromMarkdown(long);
    expect(bytes(text)).toBeLessThanOrEqual(OFFLINE_BODY_MAX_BYTES);
    expect(text.endsWith("é")).toBe(true);
    expect(capUtf8("a😀b", 4)).toBe("a");
    expect(capUtf8("a😀b", 5)).toBe("a😀");
  });
});

describe("buildOfflineSnapshot", () => {
  it("cleans and caps every field", () => {
    const snapshot = buildOfflineSnapshot({
      ...base,
      title: `  ${"t".repeat(2000)}\n`,
      workspaceName: "Acme",
      projectName: " ",
      status: "In\nprogress",
      priority: "High",
      dueDate: new Date(Date.UTC(2026, 10, 20)),
      assignees: ["Ada", null, " ", ...Array.from({ length: 60 }, () => "x")],
      markdown: "Body",
    });
    expect(snapshot).not.toBeNull();
    expect(bytes(snapshot?.title ?? "")).toBe(1000);
    expect(snapshot?.projectName).toBeNull();
    expect(snapshot?.status).toBe("In progress");
    expect(snapshot?.dueDate).toBe("2026-11-20T00:00:00.000Z");
    expect(snapshot?.assignees).toHaveLength(50);
    expect(snapshot?.assignees[0]).toBe("Ada");
    expect(snapshot?.bodyText).toBe("Body");
    expect(Object.keys(snapshot ?? {}).sort()).toEqual(
      [
        "assignees",
        "bodyText",
        "dueDate",
        "id",
        "kind",
        "path",
        "priority",
        "projectName",
        "status",
        "title",
        "updatedAt",
        "workspaceName",
      ].sort(),
    );
  });

  it("refuses ids and paths the app would refuse", () => {
    expect(buildOfflineSnapshot({ ...base, id: "../x" })).toBeNull();
    expect(buildOfflineSnapshot({ ...base, path: "/api/task/1" })).toBeNull();
    expect(
      buildOfflineSnapshot({ ...base, path: "//evil.example" }),
    ).toBeNull();
    expect(buildOfflineSnapshot({ ...base, path: "dashboard" })).toBeNull();
  });
});

describe("createOfflineSnapshotSender", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing without the bridge or an older app", () => {
    vi.useFakeTimers();
    const snapshot = buildOfflineSnapshot(base);
    for (const win of [fakeWindow(), fakeWindow({ version: "0.1.0" })]) {
      const sender = createOfflineSnapshotSender(win, 100);
      expect(() => sender.push(snapshot)).not.toThrow();
      vi.advanceTimersByTime(200);
    }
  });

  it("debounces, skips repeats and stops on cancel", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const sender = createOfflineSnapshotSender(
      fakeWindow({ saveOfflineSnapshot: save }),
      100,
    );
    const first = buildOfflineSnapshot(base);
    const second = buildOfflineSnapshot({ ...base, title: "Renamed" });
    sender.push(first);
    sender.push(first);
    vi.advanceTimersByTime(99);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith(first);
    // The same content again is not sent twice.
    sender.push(buildOfflineSnapshot(base));
    vi.advanceTimersByTime(100);
    expect(save).toHaveBeenCalledTimes(1);
    // A change is.
    sender.push(second);
    vi.advanceTimersByTime(100);
    expect(save).toHaveBeenLastCalledWith(second);
    // Leaving before the delay sends nothing.
    sender.push(buildOfflineSnapshot({ ...base, title: "Again" }));
    sender.cancel();
    vi.advanceTimersByTime(200);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("survives a bridge that throws", () => {
    vi.useFakeTimers();
    const sender = createOfflineSnapshotSender(
      fakeWindow({
        saveOfflineSnapshot: () => {
          throw new Error("refused");
        },
      }),
      10,
    );
    sender.push(buildOfflineSnapshot(base));
    expect(() => vi.advanceTimersByTime(20)).not.toThrow();
  });
});

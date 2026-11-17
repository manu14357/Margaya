import { afterEach, describe, expect, it, vi } from "vitest";
import { focusReplyComposer, isReplyHash } from "./focus-reply-composer";

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function composer() {
  const root = document.createElement("div");
  document.body.append(root);
  return root;
}

function editor() {
  const node = document.createElement("div");
  node.className = "ProseMirror";
  node.contentEditable = "true";
  node.tabIndex = 0;
  return node;
}

describe("focusReplyComposer", () => {
  it("reads the reply hash with or without its #", () => {
    expect(isReplyHash("reply")).toBe(true);
    expect(isReplyHash("#reply")).toBe(true);
    expect(isReplyHash("comment-1")).toBe(false);
    expect(isReplyHash("")).toBe(false);
  });

  it("focuses an editor that is already there", () => {
    const root = composer();
    const node = editor();
    root.append(node);
    focusReplyComposer(root);
    expect(document.activeElement).toBe(node);
  });

  it("waits for the editor to mount, and stops when asked", async () => {
    const root = composer();
    focusReplyComposer(root);
    const node = editor();
    root.append(node);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.activeElement).toBe(node);

    const other = composer();
    const stop = focusReplyComposer(other);
    stop();
    const late = editor();
    other.append(late);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.activeElement).not.toBe(late);
  });

  it("gives up after a while", async () => {
    let clock = 0;
    const root = composer();
    focusReplyComposer(root, { maxMs: 100, now: () => clock });
    clock = 200;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const node = editor();
    root.append(node);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.activeElement).not.toBe(node);
  });
});

import type { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import { promptForLink, registerLinkDialog } from "./page-editor-actions";

const editor = (isEditable = true) => ({ isEditable }) as unknown as Editor;

describe("promptForLink", () => {
  it("opens the link dialog the page editor registered, never a native prompt", () => {
    const nativePrompt = vi.spyOn(window, "prompt");
    const target = editor();
    const open = vi.fn();
    const unregister = registerLinkDialog(target, open);

    expect(promptForLink(target)).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(nativePrompt).not.toHaveBeenCalled();

    unregister();
    expect(promptForLink(target)).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    nativePrompt.mockRestore();
  });

  it("does nothing in a read-only editor", () => {
    const target = editor(false);
    const open = vi.fn();
    registerLinkDialog(target, open);

    expect(promptForLink(target)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});

import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KeyboardShortcutsProvider,
  useKeyboardShortcuts,
} from "./use-keyboard-shortcuts";

afterEach(cleanup);

describe("shortcut key normalization", () => {
  it("dispatches and unregisters mixed-case Enter registrations", () => {
    const handler = vi.fn();
    const { result } = renderHook(useKeyboardShortcuts, {
      wrapper: KeyboardShortcutsProvider,
    });
    act(() => result.current.registerShortcut("Enter", handler));
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(handler).toHaveBeenCalledOnce();
    act(() => result.current.unregisterShortcut("Enter"));
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("normalizes sequential shortcuts during registration and cleanup", () => {
    const handler = vi.fn();
    const { result } = renderHook(useKeyboardShortcuts, {
      wrapper: KeyboardShortcutsProvider,
    });
    act(() => result.current.registerSequentialShortcut("G", "Enter", handler));
    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(handler).toHaveBeenCalledOnce();
    act(() => result.current.unregisterSequentialShortcut("G", "Enter"));
    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not take Enter away from text inputs", () => {
    const handler = vi.fn();
    const { result } = renderHook(useKeyboardShortcuts, {
      wrapper: KeyboardShortcutsProvider,
    });
    act(() => result.current.registerShortcut("Enter", handler));
    const input = document.createElement("input");
    document.body.append(input);
    try {
      fireEvent.keyDown(input, { key: "Enter" });
    } finally {
      input.remove();
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("fires letter shortcuts on Cyrillic and Greek layouts by physical key", () => {
    const single = vi.fn();
    const sequence = vi.fn();
    const palette = vi.fn();
    const { result } = renderHook(useKeyboardShortcuts, {
      wrapper: KeyboardShortcutsProvider,
    });
    act(() => {
      result.current.registerShortcut("c", single);
      result.current.registerSequentialShortcut("g", "h", sequence);
      result.current.registerModifierShortcut("Ctrl", "k", palette);
    });
    // ru: C is "с", G is "п", H is "р", K is "л".
    fireEvent.keyDown(document.body, { key: "с", code: "KeyC" });
    fireEvent.keyDown(document.body, { key: "п", code: "KeyG" });
    fireEvent.keyDown(document.body, { key: "р", code: "KeyH" });
    fireEvent.keyDown(document.body, { key: "л", code: "KeyK", ctrlKey: true });
    // el: C is "ψ", G is "γ", H is "η".
    fireEvent.keyDown(document.body, { key: "ψ", code: "KeyC" });
    fireEvent.keyDown(document.body, { key: "γ", code: "KeyG" });
    fireEvent.keyDown(document.body, { key: "η", code: "KeyH" });
    expect(single).toHaveBeenCalledTimes(2);
    expect(sequence).toHaveBeenCalledTimes(2);
    expect(palette).toHaveBeenCalledOnce();
  });

  it("keeps Latin layouts and symbols matched by the typed key", () => {
    const azertyA = vi.fn();
    const help = vi.fn();
    const { result } = renderHook(useKeyboardShortcuts, {
      wrapper: KeyboardShortcutsProvider,
    });
    act(() => {
      result.current.registerShortcut("a", azertyA);
      result.current.registerShortcut("?", help);
    });
    // AZERTY types "a" on the Q key; it must stay "a", not "q".
    fireEvent.keyDown(document.body, { key: "a", code: "KeyQ" });
    fireEvent.keyDown(document.body, { key: "?", code: "Digit7" });
    expect(azertyA).toHaveBeenCalledOnce();
    expect(help).toHaveBeenCalledOnce();
  });

  it("never fires in fields, editors or during IME composition", () => {
    const handler = vi.fn();
    const { result } = renderHook(useKeyboardShortcuts, {
      wrapper: KeyboardShortcutsProvider,
    });
    act(() => result.current.registerShortcut("c", handler));
    const input = document.createElement("input");
    const editor = document.createElement("div");
    editor.className = "ProseMirror";
    editor.setAttribute("contenteditable", "true");
    const child = document.createElement("p");
    editor.append(child);
    document.body.append(input, editor);
    try {
      fireEvent.keyDown(input, { key: "с", code: "KeyC" });
      fireEvent.keyDown(child, { key: "ψ", code: "KeyC" });
      fireEvent.keyDown(document.body, {
        key: "с",
        code: "KeyC",
        isComposing: true,
      });
    } finally {
      input.remove();
      editor.remove();
    }
    expect(handler).not.toHaveBeenCalled();
  });
});

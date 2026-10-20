import { afterEach, describe, expect, it } from "vitest";
import {
  hasOpenOverlay,
  isTypingTarget,
  resolveTaskShortcut,
  shouldHandleTaskShortcut,
} from "./task-shortcut-keys";

type Init = Partial<{
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}>;

function press(init: Init) {
  return {
    key: "",
    code: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("resolveTaskShortcut", () => {
  it("maps the single keys to the pickers and self-assign", () => {
    expect(resolveTaskShortcut(press({ key: "s" }))).toBe("status");
    expect(resolveTaskShortcut(press({ key: "p" }))).toBe("priority");
    expect(resolveTaskShortcut(press({ key: "a" }))).toBe("assignees");
    expect(resolveTaskShortcut(press({ key: "l" }))).toBe("labels");
    expect(resolveTaskShortcut(press({ key: "d" }))).toBe("dueDate");
    expect(resolveTaskShortcut(press({ key: "i" }))).toBe("assignSelf");
    expect(resolveTaskShortcut(press({ key: "S" }))).toBe("status");
  });

  it("maps single keys by physical key on ru and el layouts", () => {
    // ru: S "ы", P "з", A "ф", L "д", D "в", I "ш".
    expect(resolveTaskShortcut(press({ key: "ы", code: "KeyS" }))).toBe(
      "status",
    );
    expect(resolveTaskShortcut(press({ key: "з", code: "KeyP" }))).toBe(
      "priority",
    );
    expect(resolveTaskShortcut(press({ key: "ф", code: "KeyA" }))).toBe(
      "assignees",
    );
    expect(resolveTaskShortcut(press({ key: "Ш", code: "KeyI" }))).toBe(
      "assignSelf",
    );
    // el: S "σ", P "π", L "λ", D "δ".
    expect(resolveTaskShortcut(press({ key: "σ", code: "KeyS" }))).toBe(
      "status",
    );
    expect(resolveTaskShortcut(press({ key: "π", code: "KeyP" }))).toBe(
      "priority",
    );
    expect(resolveTaskShortcut(press({ key: "λ", code: "KeyL" }))).toBe(
      "labels",
    );
    expect(resolveTaskShortcut(press({ key: "δ", code: "KeyD" }))).toBe(
      "dueDate",
    );
    // A Latin layout keeps the typed letter: AZERTY "a" sits on KeyQ.
    expect(resolveTaskShortcut(press({ key: "a", code: "KeyQ" }))).toBe(
      "assignees",
    );
  });

  it("ignores other keys and single keys with modifiers", () => {
    expect(resolveTaskShortcut(press({ key: "x" }))).toBeNull();
    expect(resolveTaskShortcut(press({ key: "Enter" }))).toBeNull();
    expect(resolveTaskShortcut(press({ key: "s", shiftKey: true }))).toBeNull();
    expect(resolveTaskShortcut(press({ key: "s", altKey: true }))).toBeNull();
    // Ctrl+S stays the browser's.
    expect(resolveTaskShortcut(press({ key: "s", ctrlKey: true }))).toBeNull();
  });

  it("maps the Ctrl/⌘ chords", () => {
    expect(
      resolveTaskShortcut(press({ key: ".", code: "Period", ctrlKey: true })),
    ).toBe("copyKey");
    expect(
      resolveTaskShortcut(press({ key: ".", code: "Period", metaKey: true })),
    ).toBe("copyKey");
    // Shift turns "," into "<" on many layouts: the physical key counts.
    expect(
      resolveTaskShortcut(
        press({ key: "<", code: "Comma", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe("copyLink");
    expect(
      resolveTaskShortcut(
        press({ key: "G", code: "KeyG", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe("copyBranch");
    expect(
      resolveTaskShortcut(press({ key: "Backspace", metaKey: true })),
    ).toBe("delete");
    expect(resolveTaskShortcut(press({ key: "Delete", ctrlKey: true }))).toBe(
      "delete",
    );
  });

  it("does not take the browser's own chords", () => {
    expect(
      resolveTaskShortcut(
        press({ key: "C", code: "KeyC", ctrlKey: true, shiftKey: true }),
      ),
    ).toBeNull();
    expect(
      resolveTaskShortcut(press({ key: ",", code: "Comma", ctrlKey: true })),
    ).toBeNull();
    // Ctrl+G (find next) stays the browser's.
    expect(
      resolveTaskShortcut(press({ key: "g", code: "KeyG", ctrlKey: true })),
    ).toBeNull();
    expect(
      resolveTaskShortcut(
        press({ key: "Backspace", ctrlKey: true, shiftKey: true }),
      ),
    ).toBeNull();
  });
});

describe("the typing guard", () => {
  it("treats fields, contenteditable and the editor as typing", () => {
    document.body.innerHTML = `
      <input id="input" />
      <textarea id="textarea"></textarea>
      <div contenteditable="true"><p id="rich">text</p></div>
      <div class="ProseMirror"><p id="editor">text</p></div>
      <button id="button">Close</button>
    `;
    const byId = (id: string) => document.getElementById(id);
    expect(isTypingTarget(byId("input"))).toBe(true);
    expect(isTypingTarget(byId("textarea"))).toBe(true);
    expect(isTypingTarget(byId("rich"))).toBe(true);
    expect(isTypingTarget(byId("editor"))).toBe(true);
    expect(isTypingTarget(byId("button"))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
  });

  it("stands aside while typing, mid-sequence, or once handled", () => {
    document.body.innerHTML = `<input id="input" /><button id="b"></button>`;
    const input = document.getElementById("input");
    const button = document.getElementById("b");
    const base = { ...press({ key: "s" }), defaultPrevented: false };

    expect(
      shouldHandleTaskShortcut(
        { ...base, target: button },
        { activePrefix: null },
      ),
    ).toBe(true);
    expect(
      shouldHandleTaskShortcut(
        { ...base, target: input },
        { activePrefix: null },
      ),
    ).toBe(false);
    expect(
      shouldHandleTaskShortcut(
        { ...base, target: button },
        { activePrefix: "g" },
      ),
    ).toBe(false);
    expect(
      shouldHandleTaskShortcut(
        { ...base, target: button, defaultPrevented: true },
        { activePrefix: null },
      ),
    ).toBe(false);
  });
});

describe("the overlay guard", () => {
  it("ignores the task's own sheet but not other popovers or dialogs", () => {
    document.body.innerHTML = `
      <div role="dialog" data-slot="sheet-popup">
        <div data-task-surface></div>
      </div>
    `;
    expect(hasOpenOverlay()).toBe(false);

    const popover = document.createElement("div");
    popover.setAttribute("data-slot", "popover-popup");
    document.body.append(popover);
    expect(hasOpenOverlay()).toBe(true);

    popover.remove();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "alertdialog");
    document.body.append(dialog);
    expect(hasOpenOverlay()).toBe(true);
  });

  it("blocks the keys while another overlay is open", () => {
    document.body.innerHTML = `<div role="menu"></div><button id="b"></button>`;
    expect(
      shouldHandleTaskShortcut(
        {
          ...press({ key: "p" }),
          defaultPrevented: false,
          target: document.getElementById("b"),
        },
        { activePrefix: null },
      ),
    ).toBe(false);
  });
});

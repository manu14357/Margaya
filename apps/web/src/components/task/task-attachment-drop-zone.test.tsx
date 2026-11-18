import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaskAttachmentDropZone from "./task-attachment-drop-zone";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

const files = () => [
  new File(["a"], "a.pdf", { type: "application/pdf" }),
  new File(["b"], "b.png", { type: "image/png" }),
];

describe("TaskAttachmentDropZone", () => {
  it("takes every dropped file", () => {
    const onFiles = vi.fn();
    render(
      <TaskAttachmentDropZone onFiles={onFiles}>
        <input aria-label="title" />
      </TaskAttachmentDropZone>,
    );
    const dropped = files();
    const over = fireEvent.dragOver(screen.getByLabelText("title"), {
      dataTransfer: { types: ["Files"], dropEffect: "none" },
    });
    // Claimed while hovering, so the drop reaches it (and the desktop
    // guard leaves it alone).
    expect(over).toBe(false);
    fireEvent.drop(screen.getByLabelText("title"), {
      dataTransfer: { files: dropped, types: ["Files"] },
    });
    expect(onFiles).toHaveBeenCalledWith(dropped);
  });

  it("leaves a drop an editor inside already took", () => {
    const onFiles = vi.fn();
    render(
      <TaskAttachmentDropZone onFiles={onFiles}>
        <div data-testid="editor" />
      </TaskAttachmentDropZone>,
    );
    const editor = screen.getByTestId("editor");
    // ProseMirror claims a drop natively, before React sees it.
    editor.addEventListener("drop", (event) => event.preventDefault());
    fireEvent.drop(editor, {
      dataTransfer: { files: files(), types: ["Files"] },
    });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("ignores drags that carry no files", () => {
    const onFiles = vi.fn();
    render(
      <TaskAttachmentDropZone onFiles={onFiles}>
        <span>card</span>
      </TaskAttachmentDropZone>,
    );
    fireEvent.drop(screen.getByText("card"), {
      dataTransfer: { files: [], types: ["text/plain"] },
    });
    expect(onFiles).not.toHaveBeenCalled();
  });
});

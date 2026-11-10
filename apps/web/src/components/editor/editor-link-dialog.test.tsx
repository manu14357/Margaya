import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEditorLinkDialog } from "./editor-link-dialog";

// The real module too: the dialog's close button loads the i18n setup.
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Enough of a TipTap editor to record what the dialog does to the link. */
function fakeEditor(currentHref?: string) {
  const calls: string[] = [];
  const chain = {
    focus: () => chain,
    extendMarkRange: () => chain,
    setLink: ({ href }: { href: string }) => {
      calls.push(`set ${href}`);
      return chain;
    },
    unsetLink: () => {
      calls.push("unset");
      return chain;
    },
    run: () => true,
  };
  const editor = {
    isEditable: true,
    isDestroyed: false,
    view: { dom: document.createElement("div") },
    getAttributes: () => (currentHref ? { href: currentHref } : {}),
    chain: () => chain,
  } as unknown as Editor;
  return { editor, calls };
}

function Harness({
  editor,
  prefilled,
}: {
  editor: Editor;
  prefilled?: string;
}) {
  const { openLinkDialog, linkDialog } = useEditorLinkDialog();
  return (
    <>
      <button type="button" onClick={() => openLinkDialog(editor, prefilled)}>
        open
      </button>
      {linkDialog}
    </>
  );
}

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "open" }));
  return (await screen.findByRole("dialog")) as HTMLElement;
}

function urlInput() {
  return screen.getByLabelText(
    "common:linkDialog.urlLabel",
  ) as HTMLInputElement;
}

describe("useEditorLinkDialog", () => {
  it("sets the link the user enters, with https assumed, on Enter", async () => {
    const nativePrompt = vi.spyOn(window, "prompt");
    const { editor, calls } = fakeEditor();
    render(<Harness editor={editor} />);
    const dialog = await openDialog();

    expect(dialog).toHaveTextContent("common:linkDialog.addTitle");
    expect(screen.queryByText("common:linkDialog.remove")).toBeNull();
    fireEvent.change(urlInput(), { target: { value: "example.com/docs" } });
    fireEvent.submit(urlInput().form as HTMLFormElement);

    expect(calls).toEqual(["set https://example.com/docs"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(nativePrompt).not.toHaveBeenCalled();
  });

  it("changes nothing when cancelled", async () => {
    const { editor, calls } = fakeEditor("https://example.com/old");
    render(<Harness editor={editor} />);
    await openDialog();

    fireEvent.change(urlInput(), { target: { value: "https://new.example" } });
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.cancel" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls).toEqual([]);
  });

  it("prefills the current link and can remove it", async () => {
    const { editor, calls } = fakeEditor("https://example.com/old");
    render(<Harness editor={editor} />);
    const dialog = await openDialog();

    expect(dialog).toHaveTextContent("common:linkDialog.editTitle");
    expect(urlInput().value).toBe("https://example.com/old");
    fireEvent.click(
      screen.getByRole("button", { name: "common:linkDialog.remove" }),
    );

    expect(calls).toEqual(["unset"]);
  });

  it("removes an existing link when the address is cleared", async () => {
    const { editor, calls } = fakeEditor("https://example.com/old");
    render(<Harness editor={editor} />);
    await openDialog();

    fireEvent.change(urlInput(), { target: { value: "  " } });
    fireEvent.submit(urlInput().form as HTMLFormElement);

    expect(calls).toEqual(["unset"]);
  });

  it("explains an address it can't use and keeps the dialog open", async () => {
    const { editor, calls } = fakeEditor();
    render(<Harness editor={editor} />);
    await openDialog();

    fireEvent.change(urlInput(), { target: { value: "javascript:alert(1)" } });
    fireEvent.submit(urlInput().form as HTMLFormElement);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "common:linkDialog.invalid",
    );
    expect(urlInput()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("uses a prefilled address passed by the editor", async () => {
    const { editor } = fakeEditor("https://example.com/old");
    render(<Harness editor={editor} prefilled="https://pasted.example" />);
    await openDialog();

    expect(urlInput().value).toBe("https://pasted.example");
  });

  it("does not submit a form the editor sits in", async () => {
    const outerSubmit = vi.fn((event: React.FormEvent) =>
      event.preventDefault(),
    );
    const { editor, calls } = fakeEditor();
    render(
      <form onSubmit={outerSubmit}>
        <Harness editor={editor} />
      </form>,
    );
    await openDialog();

    fireEvent.change(urlInput(), { target: { value: "https://example.com" } });
    fireEvent.submit(urlInput().form as HTMLFormElement);

    expect(calls).toEqual(["set https://example.com/"]);
    expect(outerSubmit).not.toHaveBeenCalled();
  });
});

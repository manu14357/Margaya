import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorImage } from "@/components/editor/extensions/editor-image";
import { AttachmentCard } from "./attachment-card";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));

afterEach(() => {
  cleanup();
  delete (window as { __MARGAYA_DESKTOP__?: unknown }).__MARGAYA_DESKTOP__;
});

const API = "http://localhost:1337/api/asset";

function Harness({
  content,
  editable,
  onEditor,
}: {
  content: string;
  editable: boolean;
  onEditor?: (editor: Editor) => void;
}) {
  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({ trailingNode: false }),
      Markdown,
      EditorImage.configure({
        HTMLAttributes: { class: "margaya-editor-image" },
      }),
      AttachmentCard,
    ],
    content,
    contentType: "markdown",
  });
  useEffect(() => {
    if (editor && onEditor) onEditor(editor);
  }, [editor, onEditor]);
  return <EditorContent editor={editor} />;
}

const card = (url: string, name: string, type: string) =>
  `<margaya-attachment url="${url}" filename="${name}" mime-type="${type}" size="12760" />`;

const doc = [
  "Files:",
  card(`${API}/pdf1`, "AI_Engineering_Notes.pdf", "application/pdf"),
  `![Diagram](${API}/img1)`,
  card("/api/asset/txt1", "notes.txt", "text/plain"),
].join("\n\n");

async function mount(content: string, editable: boolean) {
  const view = render(<Harness content={content} editable={editable} />);
  await waitFor(() =>
    expect(
      view.container.querySelectorAll(".margaya-attachment-card").length,
    ).toBeGreaterThan(0),
  );
  const cards = [
    ...view.container.querySelectorAll<HTMLAnchorElement>(
      ".margaya-attachment-card",
    ),
  ];
  return { view, cards };
}

const preview = () => document.querySelector("[data-testid=file-preview]");

describe("AttachmentCard", () => {
  for (const editable of [true, false]) {
    it(`opens the preview with the editor's files (${editable ? "editable" : "read-only"})`, async () => {
      const { cards } = await mount(doc, editable);
      expect(cards[0]?.getAttribute("href")).toBe(`${API}/pdf1`);
      // The type survives the Markdown round trip (mime-type attribute).
      expect(cards[0]?.dataset.filePreviewType).toBe("application/pdf");
      // Type and size, and the type's icon with its extension badge.
      expect(cards[0]?.textContent).toContain("PDF · 12.46 KB");
      const icon = cards[0]?.querySelector<HTMLElement>(".mfp-type-icon");
      expect(icon?.dataset.kind).toBe("pdf");
      expect(icon?.textContent).toBe("PDF");

      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      cards[1]?.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
      await waitFor(() => expect(preview()).not.toBeNull());
      expect(preview()?.querySelector("h2")?.textContent).toBe("notes.txt");
      expect(preview()?.textContent).toContain('"current":3,"total":3');
    });
  }

  it("keeps the browser's new-tab gestures", async () => {
    const { cards } = await mount(doc, false);
    for (const init of [{ ctrlKey: true }, { metaKey: true }]) {
      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      cards[0]?.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(false);
    }
    expect(cards[0]?.getAttribute("target")).toBe("_blank");
    expect(cards[0]?.getAttribute("rel")).toContain("noopener");
    expect(preview()).toBeNull();
  });

  it("previews every gesture in the desktop app, which has no tabs", async () => {
    (window as { __MARGAYA_DESKTOP__?: unknown }).__MARGAYA_DESKTOP__ = {};
    const { cards } = await mount(doc, true);
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    cards[0]?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    await waitFor(() => expect(preview()).not.toBeNull());
    fireEvent.keyDown(preview() as Element, { key: "Escape" });
    await waitFor(() => expect(preview()).toBeNull());

    const middle = new MouseEvent("auxclick", {
      bubbles: true,
      cancelable: true,
      button: 1,
    });
    cards[0]?.dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(true);
    await waitFor(() => expect(preview()).not.toBeNull());
  });

  for (const editable of [true, false]) {
    it(`downloads without opening the preview (${editable ? "editable" : "read-only"})`, async () => {
      const { view } = await mount(doc, editable);
      const links = [
        ...view.container.querySelectorAll<HTMLAnchorElement>(
          ".margaya-attachment-card-download",
        ),
      ];
      expect(links).toHaveLength(2);
      const [pdf, txt] = links;
      expect(pdf?.getAttribute("href")).toBe(`${API}/pdf1?download=1`);
      expect(pdf?.getAttribute("download")).toBe("AI_Engineering_Notes.pdf");
      expect(pdf?.hasAttribute("target")).toBe(false);
      expect(pdf?.getAttribute("aria-label")).toBe(
        'common:files.download {"name":"AI_Engineering_Notes.pdf"}',
      );
      // Not inside the card: links don't nest.
      expect(pdf?.closest(".margaya-attachment-card")).toBeNull();
      expect(txt?.getAttribute("href")).toBe(`${API}/txt1?download=1`);

      // jsdom doesn't navigate; what matters is that nothing stops the
      // link's own download and no preview opens.
      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      pdf?.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(preview()).toBeNull();
    });
  }

  it("downloads in the same window in the desktop app too", async () => {
    (window as { __MARGAYA_DESKTOP__?: unknown }).__MARGAYA_DESKTOP__ = {};
    const { view } = await mount(doc, false);
    const link = view.container.querySelector<HTMLAnchorElement>(
      ".margaya-attachment-card-download",
    );
    expect(link?.getAttribute("href")).toBe(`${API}/pdf1?download=1`);
    expect(link?.hasAttribute("download")).toBe(true);
    expect(link?.hasAttribute("target")).toBe(false);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(preview()).toBeNull();
  });

  it("opens a file elsewhere beside the page to download it", async () => {
    const { view } = await mount(
      card("https://files.example/report.pdf", "report.pdf", ""),
      false,
    );
    const link = view.container.querySelector<HTMLAnchorElement>(
      ".margaya-attachment-card-download",
    );
    expect(link?.getAttribute("href")).toBe("https://files.example/report.pdf");
    expect(link?.getAttribute("target")).toBe("_blank");
    // No MIME type stored: the name still tells the type.
    expect(
      view.container.querySelector<HTMLElement>(".mfp-type-icon")?.dataset.kind,
    ).toBe("pdf");
  });

  it("resolves this server's relative links and never links a script", async () => {
    const { view, cards } = await mount(
      [
        card("/api/asset/rel1", "relative.pdf", "application/pdf"),
        card("javascript:alert(1)", "evil.pdf", "application/pdf"),
      ].join("\n\n"),
      false,
    );
    expect(cards[0]?.getAttribute("href")).toBe(`${API}/rel1`);
    expect(cards[1]?.hasAttribute("href")).toBe(false);
    expect(cards[1]?.getAttribute("aria-disabled")).toBe("true");
    // No download for a link that isn't one.
    expect(
      view.container.querySelectorAll(".margaya-attachment-card-download"),
    ).toHaveLength(1);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    cards[1]?.dispatchEvent(click);
    expect(preview()).toBeNull();
  });
});

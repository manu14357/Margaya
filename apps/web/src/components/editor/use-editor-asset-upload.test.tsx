import { act, renderHook, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import type { DragEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type UploadedEditorAsset,
  useEditorAssetUpload,
} from "./use-editor-asset-upload";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const toast = vi.hoisted(() => ({
  loading: vi.fn(() => "toast-1"),
  update: vi.fn(),
  dismiss: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ toast }));

afterEach(() => vi.clearAllMocks());

/** An editor that records what gets inserted. */
function fakeEditor() {
  const inserted: string[] = [];
  const chain = {
    focus: () => chain,
    deleteRange: () => chain,
    setTextSelection: () => chain,
    setImage: ({ src }: { src: string }) => {
      inserted.push(src);
      return chain;
    },
    insertContent: (content: { attrs: { url: string } }) => {
      inserted.push(content.attrs.url);
      return chain;
    },
    run: () => true,
  };
  const editor = {
    isDestroyed: false,
    chain: () => chain,
    state: { selection: { empty: true, to: 0 } },
  } as unknown as Editor;
  return { editor, inserted };
}

const asset = (file: File): UploadedEditorAsset => ({
  url: `/asset/${file.name}`,
  alt: file.name,
  filename: file.name,
  kind: file.type.startsWith("image/") ? "image" : "attachment",
  mimeType: file.type,
  size: file.size,
});

const files = () => [
  new File(["%PDF"], "spec.pdf", { type: "application/pdf" }),
  new File(["png"], "shot.png", { type: "image/png" }),
  new File(["txt"], "notes.txt", { type: "text/plain" }),
];

describe("useEditorAssetUpload", () => {
  it("uploads and inserts every file, in order", async () => {
    const { editor, inserted } = fakeEditor();
    const upload = vi.fn(async (file: File) => asset(file));
    const { result } = renderHook(() =>
      useEditorAssetUpload({
        upload,
        canUpload: () => true,
        scopeId: "page-1",
        getEditor: () => editor,
      }),
    );

    await act(() => result.current.uploadFiles(files(), editor));

    expect(upload).toHaveBeenCalledTimes(3);
    expect(inserted).toEqual([
      "/asset/spec.pdf",
      "/asset/shot.png",
      "/asset/notes.txt",
    ]);
  });

  it("takes a file drop on the shell that the text didn't", async () => {
    const { editor, inserted } = fakeEditor();
    const upload = vi.fn(async (file: File) => asset(file));
    const { result } = renderHook(() =>
      useEditorAssetUpload({
        upload,
        canUpload: () => true,
        scopeId: "page-1",
        getEditor: () => editor,
      }),
    );
    const dropped = files();
    const preventDefault = vi.fn();
    act(() =>
      result.current.shellDragHandlers.onDrop({
        dataTransfer: {
          files: dropped,
          items: dropped.map(() => ({ kind: "file" })),
        },
        nativeEvent: { defaultPrevented: false },
        preventDefault,
      } as unknown as DragEvent<HTMLElement>),
    );

    expect(preventDefault).toHaveBeenCalled();
    await waitFor(() => expect(inserted).toHaveLength(3));
  });

  it("refuses files on a page that can't be edited", async () => {
    const { editor } = fakeEditor();
    const upload = vi.fn(async (file: File) => asset(file));
    const { result } = renderHook(() =>
      useEditorAssetUpload({
        upload,
        canUpload: () => false,
        scopeId: "page-1",
        getEditor: () => editor,
      }),
    );
    await act(() => result.current.uploadFiles(files(), editor));
    expect(upload).not.toHaveBeenCalled();
  });
});

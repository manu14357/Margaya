import { Callout, MargayaImage, MargayaTable } from "@margaya/editor-schema";
import type { JSONContent } from "@tiptap/core";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { TFunction } from "i18next";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

// The published page's body, read-only. The API sends an allowlisted
// document in which people, tasks, files and unpublished pages are
// `redacted` placeholders; they become plain words in the reader's language
// here, and a published page becomes a link to its public copy.

type Node = JSONContent & { attrs?: Record<string, unknown> };

function placeholder(text: string): JSONContent {
  return { type: "text", text, marks: [{ type: "italic" }] };
}

function toEditorNode(node: Node, t: TFunction): JSONContent | null {
  if (node.type === "redacted") {
    const kind = node.attrs?.kind;
    const token = typeof node.attrs?.token === "string" ? node.attrs.token : "";
    if (kind === "page" && token) {
      const title =
        typeof node.attrs?.title === "string" && node.attrs.title.trim()
          ? node.attrs.title
          : t("pages:list.untitled");
      return {
        type: "text",
        text: title,
        marks: [
          {
            type: "link",
            attrs: { href: `/public-page/${encodeURIComponent(token)}` },
          },
        ],
      };
    }
    if (kind === "mention") return placeholder(t("pages:publicView.mention"));
    if (kind === "task") return placeholder(t("pages:publicView.task"));
    if (kind === "attachment") return placeholder(t("pages:publicView.file"));
    return placeholder(t("pages:publicView.page"));
  }
  if (node.type === "embedBlock") {
    const url = typeof node.attrs?.url === "string" ? node.attrs.url : "";
    if (!url) return null;
    return {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: url,
          marks: [{ type: "link", attrs: { href: url } }],
        },
      ],
    };
  }
  if (!node.content) return node;
  return {
    ...node,
    content: node.content
      .map((child) => toEditorNode(child as Node, t))
      .filter((child): child is JSONContent => child !== null),
  };
}

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    trailingNode: false,
    undoRedo: false,
    link: {
      openOnClick: true,
      autolink: false,
      HTMLAttributes: { rel: "noopener noreferrer nofollow" },
    },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  MargayaImage,
  MargayaTable,
  TableRow,
  TableHeader,
  TableCell,
  Callout,
];

export default function PublicPageContent({
  content,
}: {
  content: Record<string, unknown>;
}) {
  const { t } = useTranslation();
  const doc = useMemo(() => toEditorNode(content as Node, t), [content, t]);
  const editor = useEditor(
    {
      editable: false,
      extensions,
      content: doc ?? { type: "doc", content: [] },
      editorProps: {
        attributes: {
          "aria-readonly": "true",
          class: "margaya-public-page-body",
        },
      },
    },
    [doc],
  );

  return (
    <div className="margaya-tiptap-shell margaya-page-editor">
      <EditorContent editor={editor} className="margaya-tiptap-content" />
    </div>
  );
}

import type { AnyExtension } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import type { Highlighter } from "shiki";
import type * as Y from "yjs";
import { BlockKeymap } from "@/components/editor/extensions/block-keymap";
import { Callout } from "@/components/editor/extensions/callout";
import { EditorImage } from "@/components/editor/extensions/editor-image";
import { AttachmentCard } from "@/components/task/extensions/attachment-card";
import { EmbedBlock } from "@/components/task/extensions/embed-block";
import { MargayaIssueLink } from "@/components/task/extensions/margaya-issue-link";
import { MargayaMention } from "@/components/task/extensions/margaya-mention";
import type { MentionMember } from "@/components/task/extensions/mention-list";
import { MentionSuggestion } from "@/components/task/extensions/mention-suggestion";
import { MermaidBlock } from "@/components/task/extensions/mermaid-block";
import { ShikiCodeBlock } from "@/components/task/extensions/shiki-code-block";
import { TaskItemWithCheckbox } from "@/components/task/extensions/task-item-with-checkbox";
import {
  type CaretAwareness,
  type CollabColorKey,
  caretColorValue,
  withCaretColors,
} from "@/lib/pages/collab-colors";
import { MargayaPageLink } from "./extensions/margaya-page-link";

/** The Yjs document field the page body lives in (the server's too). */
export const PAGE_FRAGMENT = "default";

export type PageCollaborationBinding = {
  doc: Y.Doc;
  /** The y-websocket provider (only its awareness is used here). */
  provider: unknown;
  user: { id: string; color: CollabColorKey };
  /** A member's display name by user id (never from awareness). */
  resolveName: (userId: string) => string;
};

export type PageEditorExtensionOptions = {
  placeholder: string;
  workspaceId: string;
  projectId: string;
  getMembers: () => MentionMember[];
  getHighlighter: () => Highlighter | null;
  toShikiLanguage: (language: string) => string;
  /** Live editing; without it the editor shows given content (previews). */
  collaboration?: PageCollaborationBinding;
  /** Opens the block menu for the cursor's block (Alt+Shift+M). */
  onOpenBlockMenu?: () => boolean;
};

// The stock extension's default `user` ({ name, color }) is merged into the
// configured one, which would send `name: null`; the page socket accepts
// exactly { id, color }, so the default is emptied.
const PageCollaborationCaret = CollaborationCaret.extend({
  addOptions() {
    return { ...(this.parent?.() ?? {}), user: {} } as ReturnType<
      NonNullable<typeof this.parent>
    >;
  },
});

// y-tiptap warns about any color that isn't 6-digit hex, so the caret
// extension reads awareness states with palette keys mapped to hex; its
// writes (user, cursor) still reach the live awareness, which keeps the key.
function caretProvider(provider: unknown) {
  const { awareness } = provider as { awareness: CaretAwareness };
  return { awareness: withCaretColors(awareness) };
}

/** The page editor's extensions, in the spec's order (§4.4). */
export function createPageEditorExtensions(
  options: PageEditorExtensionOptions,
): AnyExtension[] {
  const { collaboration } = options;
  const extensions: AnyExtension[] = [
    StarterKit.configure({
      codeBlock: { HTMLAttributes: { class: "margaya-tiptap-codeblock" } },
      trailingNode: false,
      heading: { levels: [1, 2, 3] },
      // The collaboration extension brings its own (per-user) undo.
      ...(collaboration ? { undoRedo: false } : {}),
    }),
  ];

  if (collaboration) {
    extensions.push(
      Collaboration.configure({
        document: collaboration.doc,
        field: PAGE_FRAGMENT,
      }),
      PageCollaborationCaret.configure({
        provider: caretProvider(collaboration.provider),
        user: collaboration.user,
        render: (user) => {
          const caret = document.createElement("span");
          caret.classList.add("margaya-collab-caret");
          caret.style.setProperty("--collab-color", caretColorValue(user));
          const label = document.createElement("span");
          label.classList.add("margaya-collab-caret-label");
          label.setAttribute("aria-hidden", "true");
          label.textContent = collaboration.resolveName(String(user.id ?? ""));
          caret.append(label);
          return caret;
        },
        selectionRender: (user) => ({
          nodeName: "span",
          class: "margaya-collab-selection",
          style: `--collab-color: ${caretColorValue(user)}`,
        }),
      }),
    );
  }

  extensions.push(
    Markdown.configure({ markedOptions: { breaks: true, gfm: true } }),
    ShikiCodeBlock.configure({
      highlighter: options.getHighlighter,
      resolveLanguage: options.toShikiLanguage,
      themeDark: "github-dark",
      themeLight: "github-light",
    }),
    MermaidBlock,
    EmbedBlock,
    AttachmentCard,
    MargayaIssueLink,
    MargayaMention,
    MentionSuggestion.configure({ getMembers: options.getMembers }),
    MargayaPageLink.configure({
      workspaceId: options.workspaceId,
      projectId: options.projectId,
    }),
    TaskList,
    TaskItemWithCheckbox.configure({ nested: true }),
    EditorImage.configure({
      HTMLAttributes: { class: "margaya-editor-image", loading: "lazy" },
    }),
    Callout,
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    Placeholder.configure({ placeholder: options.placeholder }),
    BlockKeymap.configure({ onOpenMenu: options.onOpenBlockMenu ?? null }),
  );

  return extensions;
}

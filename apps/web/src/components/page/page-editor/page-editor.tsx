import type { Editor, JSONContent } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";
import { Paperclip } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AiBlockPanel,
  aiBlockSlashCommand,
  useAiBlock,
} from "@/components/editor/ai/ai-block";
import EditorAiPreview from "@/components/editor/ai/editor-ai-preview";
import { useEditorAi } from "@/components/editor/ai/use-editor-ai";
import BlockHandle from "@/components/editor/block-handle";
import { useCodeBlockToolbar } from "@/components/editor/code-block-toolbar";
import EditorBubbleMenu from "@/components/editor/editor-bubble-menu";
import { useEmbedComposer } from "@/components/editor/embed-composer";
import { useImagePreview } from "@/components/editor/image-preview-dialog";
import SlashMenu from "@/components/editor/slash-menu";
import TableHandles from "@/components/editor/table-handles";
import {
  type EditorRange,
  useEditorAssetUpload,
} from "@/components/editor/use-editor-asset-upload";
import { useShiki, useShikiRefresh } from "@/components/editor/use-shiki";
import { useSlashMenu } from "@/components/editor/use-slash-menu";
import type { MentionMember } from "@/components/task/extensions/mention-list";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { useGetPages } from "@/hooks/queries/page/use-get-pages";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { cn } from "@/lib/cn";
import { parseTaskListMarkdownToNodes } from "@/lib/editor-task-list-paste";
import {
  extractIssueKeyFromUrl,
  extractTaskIdFromUrl,
  isYouTubeUrl,
  normalizeUrl,
} from "@/lib/editor-url-utils";
import { parsePageUrl } from "@/lib/pages/page-paths";
import { uploadPageAsset } from "@/lib/pages/upload-page-asset";
import type { PageSummary } from "@/types/page";
import { promptForLink, registerFilePicker } from "./page-editor-actions";
import {
  createPageEditorExtensions,
  type PageCollaborationBinding,
} from "./page-editor-extensions";
import PageLinkPicker from "./page-link-picker";
import { pageSlashCommands } from "./page-slash-commands";
import "./page-editor.css";
import "tippy.js/dist/tippy.css";

export type PageEditorContent =
  | { type: "markdown"; value: string }
  | { type: "json"; value: JSONContent };

type PageEditorProps = {
  pageId: string;
  workspaceId: string;
  projectId: string;
  editable: boolean;
  /** Live editing over the page socket. */
  collaboration?: PageCollaborationBinding;
  /** Without collaboration: what the editor shows (stored copy, preview). */
  content?: PageEditorContent;
  /** Without collaboration: the markdown after each local edit. */
  onMarkdownChange?: (markdown: string) => void;
  /** The editor instance, for the outline, stats and markdown export. */
  onEditorChange?: (editor: Editor | null) => void;
  className?: string;
};

/**
 * The page body editor: the task description editor's features (slash menu,
 * bubble menu, code blocks, mermaid, uploads, embeds, mentions, task links)
 * plus page links, bound to the page's Yjs document when collaborating.
 */
export default function PageEditor({
  pageId,
  workspaceId,
  projectId,
  editable,
  collaboration,
  content,
  onMarkdownChange,
  onEditorChange,
  className,
}: PageEditorProps) {
  const { t } = useTranslation();
  const { data: activeWorkspace } = useActiveWorkspace();
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(
    activeWorkspace?.id ?? "",
  );
  const membersRef = useRef<MentionMember[]>([]);
  membersRef.current = useMemo(
    () =>
      (workspaceUsers?.members ?? []).map((member) => ({
        id: member.userId,
        label: member.user?.name ?? member.user?.email ?? "",
        image: member.user?.image ?? null,
      })),
    [workspaceUsers],
  );
  const { data: pages } = useGetPages(projectId);
  const linkablePages = useMemo(
    () =>
      (pages ?? []).filter((page) => page.id !== pageId && !page.archivedAt),
    [pages, pageId],
  );
  const pagesRef = useRef<PageSummary[]>([]);
  pagesRef.current = pages ?? [];

  const editableRef = useRef(editable);
  editableRef.current = editable;
  const onMarkdownChangeRef = useRef(onMarkdownChange);
  onMarkdownChangeRef.current = onMarkdownChange;
  const shellRef = useRef<HTMLElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const openBlockMenuRef = useRef<() => boolean>(() => false);
  const [pageLinkPicker, setPageLinkPicker] = useState<{
    range: EditorRange;
    top: number;
    left: number;
  } | null>(null);

  const { highlighter, getHighlighter, toShikiLanguage, supportedLanguages } =
    useShiki();

  const positionAt = useCallback((view: EditorView, pos: number) => {
    const coords = view.coordsAtPos(pos);
    const shellRect = shellRef.current?.getBoundingClientRect();
    if (!shellRect) return { top: coords.bottom + 8, left: coords.left };
    return {
      top: coords.bottom - shellRect.top + 8,
      left: coords.left - shellRect.left,
    };
  }, []);

  const upload = useEditorAssetUpload({
    upload: (file) => uploadPageAsset(pageId, file),
    canUpload: () => editableRef.current,
    scopeId: pageId,
  });
  const { uploadFile, openFilePicker } = upload;

  // Handlers read through refs: the editor is built once per document (or
  // per mount without one; parents remount it with a key for new content).
  const offerEmbedRef = useRef<
    ReturnType<typeof useEmbedComposer>["offerEmbed"] | null
  >(null);

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: editableRef.current,
      extensions: createPageEditorExtensions({
        placeholder: t("pages:editor.placeholder"),
        emptyLinePlaceholder: t("pages:detail.emptyLinePlaceholder"),
        workspaceId,
        projectId,
        getMembers: () => membersRef.current,
        getHighlighter,
        toShikiLanguage,
        collaboration,
        onOpenBlockMenu: () => openBlockMenuRef.current(),
      }),
      // Never set content on a collaborative editor: the Yjs document is the
      // only source, and initial content would duplicate across clients.
      ...(collaboration || !content
        ? {}
        : content.type === "markdown"
          ? { content: content.value, contentType: "markdown" as const }
          : { content: content.value }),
      editorProps: {
        attributes: {
          class: "margaya-tiptap-prose",
          "aria-label": t("pages:editor.ariaLabel"),
        },
        handlePaste: (view, event) => {
          if (!editableRef.current) return false;
          const file = event.clipboardData?.files?.[0];
          if (file) {
            event.preventDefault();
            void uploadFile(file, editorRef.current);
            return true;
          }
          const plainText = event.clipboardData?.getData("text/plain") || "";
          const taskListNodes = parseTaskListMarkdownToNodes(plainText);
          if (taskListNodes) {
            event.preventDefault();
            const nodes = taskListNodes.map((node) =>
              view.state.schema.nodeFromJSON(node),
            );
            view.dispatch(
              view.state.tr
                .replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0))
                .scrollIntoView(),
            );
            return true;
          }
          const pasted = plainText.trim();
          if (!pasted || /\s/.test(pasted)) return false;
          const url = normalizeUrl(pasted);
          if (!url) return false;

          const pageLink = parsePageUrl(url);
          if (pageLink) {
            event.preventDefault();
            const linked = pagesRef.current.find(
              (page) => page.id === pageLink.pageId,
            );
            view.dispatch(
              view.state.tr.replaceSelectionWith(
                view.state.schema.nodes.margayaPageLink.create({
                  pageId: pageLink.pageId,
                  title: linked?.title ?? "",
                }),
              ),
            );
            return true;
          }

          const issueKey = extractIssueKeyFromUrl(url);
          const taskIdFromUrl = extractTaskIdFromUrl(url);
          if (issueKey || taskIdFromUrl) {
            event.preventDefault();
            view.dispatch(
              view.state.tr.replaceSelectionWith(
                view.state.schema.nodes.margayaIssueLink.create({
                  url,
                  issueKey: issueKey || "",
                  taskId: taskIdFromUrl || "",
                }),
              ),
            );
            return true;
          }

          if (!isYouTubeUrl(url)) return false;
          event.preventDefault();
          const { from } = view.state.selection;
          const linkMark = view.state.schema.marks.link?.create({ href: url });
          view.dispatch(
            view.state.tr
              .replaceSelectionWith(
                view.state.schema.text(url, linkMark ? [linkMark] : []),
                false,
              )
              .scrollIntoView(),
          );
          offerEmbedRef.current?.({
            url,
            ...positionAt(view, view.state.selection.from),
            linkRange: { from, to: from + url.length },
          });
          return true;
        },
        handleDrop: (view, event) => {
          const file = event.dataTransfer?.files?.[0];
          if (!file || !editableRef.current) return false;
          event.preventDefault();
          const coordinates = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          void uploadFile(
            file,
            editorRef.current,
            coordinates
              ? { from: coordinates.pos, to: coordinates.pos }
              : undefined,
          );
          return true;
        },
        handleTextInput: (view, _from, _to, text) => {
          // "```" at the start of a paragraph opens a code block.
          if (text !== "`") return false;
          const { state } = view;
          const { $from } = state.selection;
          if ($from.parent.type.name !== "paragraph") return false;
          const before = $from.parent.textBetween(
            0,
            $from.parentOffset,
            "\0",
            "\0",
          );
          if (!/^\s*``$/.test(before)) return false;
          const start = $from.before();
          const codeBlock = state.schema.nodes.codeBlock?.create();
          if (!codeBlock) return false;
          const tr = state.tr.replaceWith(
            start,
            start + $from.parent.nodeSize,
            codeBlock,
          );
          tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1)));
          view.dispatch(tr.scrollIntoView());
          return true;
        },
        handleKeyDown: (view, event) => {
          // Ctrl/Cmd+A inside a code block selects just that block.
          if (
            !(event.metaKey || event.ctrlKey) ||
            event.key.toLowerCase() !== "a"
          ) {
            return false;
          }
          const { $from } = view.state.selection;
          if ($from.parent.type.name !== "codeBlock") return false;
          event.preventDefault();
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(view.state.doc, $from.start(), $from.end()),
            ),
          );
          return true;
        },
      },
      onUpdate: ({ editor: active, transaction }) => {
        if (collaboration || !editableRef.current) return;
        if (!transaction.docChanged) return;
        onMarkdownChangeRef.current?.(active.getMarkdown());
      },
    },
    [collaboration?.doc, collaboration?.provider],
  );
  editorRef.current = editor;

  const { available: aiAvailable } = useAiAvailability(projectId || null);
  const aiTarget = useMemo(
    () => ({ kind: "page" as const, id: pageId }),
    [pageId],
  );
  const ai = useEditorAi({ editor, workspaceId, target: aiTarget });
  const aiEnabled = aiAvailable && editable;
  const aiBlock = useAiBlock({ editor, workspaceId, pageId });
  const openAiBlock = aiBlock.open;

  const embed = useEmbedComposer({
    editor,
    canEdit: () => editableRef.current,
  });
  offerEmbedRef.current = embed.offerEmbed;

  useShikiRefresh(editor, highlighter);

  useEffect(() => {
    onEditorChange?.(editor);
    return () => onEditorChange?.(null);
  }, [editor, onEditorChange]);

  // No update event: toggling editability is not an edit.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable, false);
    editor.view.dom.setAttribute("aria-readonly", String(!editable));
  }, [editor, editable]);

  const imagePreview = useImagePreview(
    editor,
    t("tasks:detail.editor.previewImage"),
  );

  const commands = useMemo(
    () => [
      ...pageSlashCommands(t, {
        onFile: (active) => openFilePicker(active),
        onPageLink: (active, range) =>
          setPageLinkPicker({ range, ...positionAt(active.view, range.to) }),
      }),
      ...(aiEnabled ? [aiBlockSlashCommand(t, openAiBlock)] : []),
    ],
    [openFilePicker, positionAt, t, aiEnabled, openAiBlock],
  );
  const slash = useSlashMenu({
    editor,
    commands,
    canEdit: () => editableRef.current,
    positionAt: (active, pos) => positionAt(active.view, pos),
  });

  const codeBlocks = useCodeBlockToolbar({
    editor,
    shellRef,
    canEdit: editable,
    supportedLanguages,
    toShikiLanguage,
  });

  const setLink = useCallback(() => {
    if (!editableRef.current || !editor) return;
    promptForLink(editor, t);
  }, [editor, t]);

  // The formatting toolbar above the canvas inserts images through this
  // editor's file input.
  useEffect(() => {
    if (!editor) return;
    return registerFilePicker(editor, () => {
      if (editableRef.current) openFilePicker(editor);
    });
  }, [editor, openFilePicker]);

  const insertPageLink = (page: PageSummary) => {
    const picker = pageLinkPicker;
    setPageLinkPicker(null);
    if (!editor || !picker || !editableRef.current) return;
    editor
      .chain()
      .focus()
      .deleteRange(picker.range)
      .insertContent({
        type: "margayaPageLink",
        attrs: { pageId: page.id, title: page.title },
      })
      .insertContent(" ")
      .run();
  };

  return (
    <section
      ref={shellRef}
      className={cn(
        "margaya-tiptap-shell margaya-page-editor group",
        upload.isDragActive && "is-drag-active",
        className,
      )}
      {...upload.shellDragHandlers}
    >
      <input
        ref={upload.fileInputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        onChange={upload.onFileInputChange}
      />
      {codeBlocks.toolbar}
      <BlockHandle
        editor={editor}
        shellRef={shellRef}
        editable={editable}
        openMenuRef={openBlockMenuRef}
        onAi={aiEnabled ? ai.begin : undefined}
      />
      {editor && editable && (
        <>
          <EditorBubbleMenu
            editor={editor}
            onSetLink={setLink}
            variant="page"
            ai={aiEnabled ? ai : undefined}
          />
          <TableHandles editor={editor} />
        </>
      )}
      {editor && editable && slash.menu && (
        <SlashMenu
          menu={slash.menu}
          filtered={slash.filtered}
          onRun={slash.run}
          onSelect={slash.select}
        />
      )}
      {editor && editable && pageLinkPicker && (
        <PageLinkPicker
          pages={linkablePages}
          top={pageLinkPicker.top}
          left={pageLinkPicker.left}
          onSelect={insertPageLink}
          onClose={() => setPageLinkPicker(null)}
        />
      )}
      {editor && aiEnabled && (
        <AiBlockPanel editor={editor} block={aiBlock} shellRef={shellRef} />
      )}
      {editor && aiEnabled && (
        <EditorAiPreview editor={editor} ai={ai} shellRef={shellRef} />
      )}
      {editable && embed.element}
      <EditorContent
        editor={editor}
        className="margaya-tiptap-content"
        onMouseMove={codeBlocks.onMouseMove}
        onMouseLeave={codeBlocks.onMouseLeave}
      />
      {editable && (
        <button
          type="button"
          className="margaya-editor-quick-attach"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => openFilePicker(editor)}
          aria-label={t("tasks:detail.editor.attachFile")}
        >
          <Paperclip className="size-3.5" />
        </button>
      )}
      {editable && upload.isDragActive && (
        <div className="margaya-editor-drop-indicator">
          <span>{t("tasks:detail.editor.dropToUpload")}</span>
        </div>
      )}
      {imagePreview.dialog}
    </section>
  );
}

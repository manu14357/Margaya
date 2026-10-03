import CommentEditor from "@/components/activity/comment-editor";

type MarkdownRendererProps = {
  content: string;
};

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <CommentEditor
      value={content}
      readOnly
      showBubbleMenu={false}
      proseClassName="margaya-tiptap-prose"
      contentClassName="margaya-tiptap-content"
      className="[&_.margaya-tiptap-content_.ProseMirror]:max-h-none [&_.margaya-tiptap-content_.ProseMirror]:overflow-visible [&_.margaya-tiptap-content_.ProseMirror]:px-0 [&_.margaya-tiptap-content_.ProseMirror]:py-0"
    />
  );
}

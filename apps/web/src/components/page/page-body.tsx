import type { Editor } from "@tiptap/core";
import { useCallback, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { collabColorKey } from "@/lib/pages/collab-colors";
import type { Page } from "@/types/page";
import type { PageCollaboration } from "./collab/use-page-collaboration";
import PageEditor from "./page-editor/page-editor";
import { useRestContentSave } from "./use-rest-content-save";

type PageBodyProps = {
  page: Page;
  workspaceId: string;
  userId: string | undefined;
  collab: PageCollaboration;
  /** The live editor's editability (capabilities, socket and lock). */
  editable: boolean;
  /** Edits of the stored copy, saved over REST while sync is down. */
  storedCopyEditable: boolean;
  resolveName: (userId: string) => string;
  onEditorChange: (editor: Editor | null) => void;
};

export function PageBodySkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {["w-full", "w-11/12", "w-full", "w-4/5", "w-full", "w-2/3"].map(
        (width, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
          <Skeleton key={index} className={cn("h-4", width)} />
        ),
      )}
    </div>
  );
}

function StoredCopyEditor({
  page,
  workspaceId,
  editable,
  onEditorChange,
}: {
  page: Page;
  workspaceId: string;
  editable: boolean;
  onEditorChange: (editor: Editor | null) => void;
}) {
  const save = useRestContentSave({ page, enabled: editable });
  return (
    <PageEditor
      key={`${page.id}:${save.reloadKey}`}
      pageId={page.id}
      workspaceId={workspaceId}
      projectId={page.projectId ?? ""}
      editable={editable}
      content={{ type: "markdown", value: page.contentMarkdown }}
      onMarkdownChange={save.schedule}
      onEditorChange={onEditorChange}
    />
  );
}

/**
 * The page body: the live editor once the page socket has synced, the
 * stored copy (saved over REST when allowed) while it can't, and skeletons
 * in between.
 */
export default function PageBody({
  page,
  workspaceId,
  userId,
  collab,
  editable,
  storedCopyEditable,
  resolveName,
  onEditorChange,
}: PageBodyProps) {
  // Carets are drawn by the editor built once per document; they look the
  // name up through this ref, so members loading later still show.
  const resolveNameRef = useRef(resolveName);
  resolveNameRef.current = resolveName;
  const stableResolveName = useCallback(
    (id: string) => resolveNameRef.current(id),
    [],
  );

  if (collab.fallback) {
    return (
      <StoredCopyEditor
        page={page}
        workspaceId={workspaceId}
        editable={storedCopyEditable}
        onEditorChange={onEditorChange}
      />
    );
  }

  // The editor binds to the document only once it holds the server's state:
  // bound to an empty document, it would add a paragraph of its own that
  // then merges into the page.
  if (!collab.doc || !collab.provider || !userId || !collab.hasSynced) {
    return <PageBodySkeleton />;
  }

  return (
    <PageEditor
      pageId={page.id}
      workspaceId={workspaceId}
      projectId={page.projectId ?? ""}
      editable={editable}
      collaboration={{
        doc: collab.doc,
        provider: collab.provider,
        user: { id: userId, color: collabColorKey(userId) },
        resolveName: stableResolveName,
      }}
      onEditorChange={onEditorChange}
    />
  );
}

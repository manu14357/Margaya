import { MessageSquare, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";
import TrashConfirmDialog from "@/components/trash/trash-confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCreatePageComment,
  useDeletePageComment,
  useUpdatePageComment,
} from "@/hooks/mutations/page/use-page-comment-mutations";
import { usePageComments } from "@/hooks/queries/page/use-page-comments";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import type { Page, PageComment } from "@/types/page";
import MemberAvatar from "./member-avatar";

const EDITOR_CLASS =
  "[&_.margaya-comment-editor-content_.ProseMirror]:min-h-[3rem] [&_.margaya-comment-editor-content_.ProseMirror]:px-2.5 [&_.margaya-comment-editor-content_.ProseMirror]:pt-2 [&_.margaya-comment-editor-content_.ProseMirror]:pb-1.5";
const VIEWER_CLASS =
  "margaya-comment-viewer [&_.margaya-comment-editor-content_.ProseMirror]:px-0 [&_.margaya-comment-editor-content_.ProseMirror]:pt-0.5 [&_.margaya-comment-editor-content_.ProseMirror]:pb-1";

function CommentItem({
  comment,
  pageId,
  onDelete,
}: {
  comment: PageComment;
  pageId: string;
  onDelete: (comment: PageComment) => void;
}) {
  const { t } = useTranslation();
  const update = useUpdatePageComment(pageId);
  const [draft, setDraft] = useState<string | null>(null);
  const name = comment.user?.name ?? t("pages:comments.deletedUser");
  const editing = draft !== null;

  const save = () => {
    const content = draft?.trim();
    if (!content) {
      toast.error(t("pages:comments.toasts.empty"));
      return;
    }
    update.mutate(
      { commentId: comment.id, content },
      {
        onSuccess: () => setDraft(null),
        onError: () => toast.error(t("pages:comments.toasts.saveError")),
      },
    );
  };

  return (
    <li className="space-y-1" data-slot="page-comment">
      <div className="flex min-h-6 items-center gap-2">
        <MemberAvatar
          name={name}
          image={comment.user?.image}
          className="size-5"
        />
        <span className="min-w-0 truncate font-medium text-[13px]">{name}</span>
        <span
          className="shrink-0 text-muted-foreground text-xs tabular-nums"
          title={formatDateTime(comment.createdAt)}
        >
          {formatRelativeTime(comment.createdAt)}
        </span>
        {comment.updatedAt !== comment.createdAt && (
          <span className="shrink-0 text-muted-foreground text-xs">
            {t("pages:comments.edited")}
          </span>
        )}
        {(comment.canEdit || comment.canDelete) && !editing && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("pages:comments.menuAria")}
                  className="ms-auto text-muted-foreground"
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {comment.canEdit && (
                <DropdownMenuItem onClick={() => setDraft(comment.content)}>
                  <Pencil />
                  {t("pages:comments.edit")}
                </DropdownMenuItem>
              )}
              {comment.canDelete && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onDelete(comment)}
                >
                  <Trash2 />
                  {t("pages:comments.delete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {editing ? (
        <div className="rounded-lg border border-border/80 bg-card/70">
          <CommentEditor
            value={draft}
            onChange={setDraft}
            placeholder={t("pages:comments.placeholder")}
            className={EDITOR_CLASS}
            allowFileUploads={false}
            showQuickAttachButton={false}
            slashMenuPosition="fixed"
            autoFocus
            onSubmitShortcut={save}
            onCancelShortcut={() => setDraft(null)}
          />
          <div className="flex justify-end gap-1 border-border/70 border-t p-1.5">
            <Button variant="ghost" size="xs" onClick={() => setDraft(null)}>
              {t("pages:comments.cancel")}
            </Button>
            <Button size="xs" loading={update.isPending} onClick={save}>
              {t("pages:comments.save")}
            </Button>
          </div>
        </div>
      ) : (
        <CommentEditor
          value={comment.content}
          className={VIEWER_CLASS}
          readOnly
        />
      )}
    </li>
  );
}

/** The Comments tab of the side panel: internal notes on the page. */
export default function PageComments({ page }: { page: Page }) {
  const { t } = useTranslation();
  const query = usePageComments(page.id);
  const create = useCreatePageComment(page.id);
  const remove = useDeletePageComment(page.id);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<PageComment | null>(null);

  const submit = () => {
    const content = draft.trim();
    if (!content) {
      toast.error(t("pages:comments.toasts.empty"));
      return;
    }
    create.mutate(content, {
      onSuccess: () => setDraft(""),
      onError: () => toast.error(t("pages:comments.toasts.addError")),
    });
  };

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onError: () => toast.error(t("pages:comments.toasts.deleteError")),
      onSettled: () => setDeleting(null),
    });
  };

  let list = null;
  if (query.isPending) {
    list = (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  } else if (query.isError) {
    list = (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <span>{t("pages:comments.loadError")}</span>
        <Button variant="outline" size="xs" onClick={() => query.refetch()}>
          {t("pages:comments.retry")}
        </Button>
      </div>
    );
  } else if (query.data.length === 0) {
    list = (
      <Empty className="py-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageSquare />
          </EmptyMedia>
          <EmptyTitle>{t("pages:comments.emptyTitle")}</EmptyTitle>
          <EmptyDescription>
            {t("pages:comments.emptyDescription")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else {
    list = (
      <ul className="space-y-3">
        {query.data.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            pageId={page.id}
            onDelete={setDeleting}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-4">
      {list}
      {page.capabilities.canComment ? (
        <div className="rounded-lg border border-border/80 bg-card/70 focus-within:border-ring/60">
          <CommentEditor
            value={draft}
            onChange={setDraft}
            placeholder={t("pages:comments.placeholder")}
            className={EDITOR_CLASS}
            allowFileUploads={false}
            showQuickAttachButton={false}
            slashMenuPosition="fixed"
            onSubmitShortcut={submit}
          />
          <div className="flex justify-end border-border/70 border-t p-1.5">
            <Button
              size="xs"
              loading={create.isPending}
              disabled={!draft.trim()}
              onClick={submit}
            >
              {t("pages:comments.add")}
            </Button>
          </div>
        </div>
      ) : (
        page.archivedAt && (
          <p className="text-muted-foreground text-xs">
            {t("pages:comments.archivedNote")}
          </p>
        )
      )}
      <TrashConfirmDialog
        open={deleting !== null}
        title={t("pages:comments.deleteTitle")}
        description={t("pages:comments.deleteDescription")}
        action={t("pages:comments.delete")}
        pending={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

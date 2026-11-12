import {
  Check,
  FolderKanban,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { MAX_TITLE_CHARS } from "./ask-history";
import type { AskConversationSummary } from "./use-ask-history";

/**
 * Past Ask conversations, pinned first, then newest: search them, reopen one
 * to continue it, rename, pin or delete one, or clear them all after a
 * confirmation. Saved in this browser, or on the server when the workspace
 * keeps chat history (`mode`).
 */
export function AskHistoryList({
  conversations,
  currentId,
  projectName,
  mode = "local",
  isLoading = false,
  localCount = 0,
  onOpen,
  onDelete,
  onClear,
  onRename,
  onPin,
  onImport,
  className,
}: {
  conversations: readonly AskConversationSummary[];
  currentId: string | null;
  projectName: (projectId: string) => string | undefined;
  mode?: "local" | "server";
  isLoading?: boolean;
  /** Server mode: conversations still only in this browser. */
  localCount?: number;
  onOpen: (conversation: AskConversationSummary) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onImport?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmId = useId();

  // Keep focus inside the panel when the confirmation replaces its trigger.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const term = query.trim().toLocaleLowerCase();
  const shown = useMemo(
    () =>
      term
        ? conversations.filter((item) =>
            item.title.toLocaleLowerCase().includes(term),
          )
        : conversations,
    [conversations, term],
  );

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      {conversations.length > 0 && (
        <div className="relative shrink-0 px-3 pt-2.5 pb-1">
          <Search
            aria-hidden
            className="-translate-y-1/2 pointer-events-none absolute start-5.5 top-[calc(50%+3px)] size-3.5 text-muted-foreground"
          />
          <Input
            type="search"
            size="sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("ai:ask.history.search")}
            aria-label={t("ai:ask.history.search")}
            className="[&_input]:ps-7"
          />
        </div>
      )}
      {mode === "server" && localCount > 0 && onImport && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs">
          <p className="min-w-0 flex-1 text-muted-foreground">
            {t("ai:ask.history.importHint", { total: localCount })}
          </p>
          <Button type="button" variant="outline" size="xs" onClick={onImport}>
            <Upload aria-hidden />
            {t("ai:ask.history.import")}
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        {isLoading ? (
          <p
            role="status"
            className="px-3 py-6 text-center text-muted-foreground text-sm"
          >
            {t("ai:ask.history.loading")}
          </p>
        ) : shown.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <MessageSquare
              aria-hidden
              className="size-5 text-muted-foreground"
            />
            <p className="text-muted-foreground text-sm">
              {term ? t("ai:ask.history.noMatches") : t("ai:ask.history.empty")}
            </p>
          </div>
        ) : (
          <ul
            className="flex flex-col gap-0.5"
            aria-label={t("ai:ask.history.title")}
          >
            {shown.map((conversation) => {
              const project = conversation.projectId
                ? projectName(conversation.projectId)
                : undefined;
              const current = conversation.id === currentId;
              if (renaming === conversation.id) {
                return (
                  <li key={conversation.id}>
                    <RenameRow
                      initial={conversation.title}
                      onSave={(title) => {
                        setRenaming(null);
                        if (title && title !== conversation.title) {
                          onRename(conversation.id, title);
                        }
                      }}
                      onCancel={() => setRenaming(null)}
                    />
                  </li>
                );
              }
              return (
                <li
                  key={conversation.id}
                  className={cn(
                    "group flex items-center gap-0.5 rounded-lg pe-1 hover:bg-accent/60 has-focus-visible:bg-accent/60",
                    current && "bg-accent/40",
                  )}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-current={current ? "true" : undefined}
                    onClick={() => onOpen(conversation)}
                  >
                    <span className="flex w-full min-w-0 items-center gap-1.5 text-sm">
                      {conversation.pinned && (
                        <Pin
                          aria-label={t("ai:ask.history.pinned")}
                          className="size-3 shrink-0 text-muted-foreground"
                        />
                      )}
                      <span className="truncate">{conversation.title}</span>
                    </span>
                    <span className="flex min-w-0 max-w-full items-center gap-1.5 text-muted-foreground text-xs">
                      <time
                        dateTime={new Date(
                          conversation.updatedAt,
                        ).toISOString()}
                        title={formatDateTime(conversation.updatedAt)}
                        className="shrink-0"
                      >
                        {formatRelativeTime(conversation.updatedAt)}
                      </time>
                      {project && (
                        <span className="inline-flex min-w-0 items-center gap-1 rounded-md border bg-muted px-1.5 py-px">
                          <FolderKanban
                            aria-hidden
                            className="size-3 shrink-0"
                          />
                          <span className="truncate">{project}</span>
                        </span>
                      )}
                    </span>
                  </button>
                  <RowAction
                    label={
                      conversation.pinned
                        ? t("ai:ask.history.unpin")
                        : t("ai:ask.history.pin")
                    }
                    onClick={() => onPin(conversation.id, !conversation.pinned)}
                  >
                    {conversation.pinned ? (
                      <PinOff aria-hidden />
                    ) : (
                      <Pin aria-hidden />
                    )}
                  </RowAction>
                  <RowAction
                    label={t("ai:ask.history.rename")}
                    onClick={() => setRenaming(conversation.id)}
                  >
                    <Pencil aria-hidden />
                  </RowAction>
                  <RowAction
                    label={t("ai:ask.history.delete")}
                    onClick={() => onDelete(conversation.id)}
                  >
                    <Trash2 aria-hidden />
                  </RowAction>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t px-4 py-3">
        {confirming ? (
          <div className="flex flex-col gap-2">
            <p id={confirmId} className="text-sm">
              {mode === "server"
                ? t("ai:ask.history.clearConfirmServer")
                : t("ai:ask.history.clearConfirm")}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                ref={cancelRef}
                aria-describedby={confirmId}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirming(false)}
              >
                {t("common:actions.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  setConfirming(false);
                  onClear();
                }}
              >
                {t("ai:ask.history.clear")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
              {mode === "server"
                ? t("ai:ask.history.serverNote")
                : t("ai:ask.history.localOnly")}
            </p>
            {conversations.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => setConfirming(true)}
              >
                <Trash2 aria-hidden />
                {t("ai:ask.history.clear")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** Renames a conversation in place: Enter saves, Escape cancels. */
function RenameRow({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (title: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onSave(value.trim());
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };
  return (
    <div className="flex items-center gap-1 rounded-lg bg-accent/40 px-1.5 py-1.5">
      <Input
        ref={inputRef}
        size="sm"
        value={value}
        maxLength={MAX_TITLE_CHARS}
        aria-label={t("ai:ask.history.renameLabel")}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        className="min-w-0 flex-1"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("ai:ask.history.saveTitle")}
        title={t("ai:ask.history.saveTitle")}
        disabled={!value.trim()}
        onClick={() => onSave(value.trim())}
      >
        <Check aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("common:actions.cancel")}
        title={t("common:actions.cancel")}
        onClick={onCancel}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}

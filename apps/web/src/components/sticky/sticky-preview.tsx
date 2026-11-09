import {
  type CSSProperties,
  Fragment,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type Ref,
} from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/cn";
import { normalizeCommentMarkdown } from "@/lib/normalize-comment-markdown";

/**
 * A sticky's text before its editor loads. Home shows several stickies, and
 * the comment editor behind each one is the heaviest code on the page, so a
 * sticky renders as static markup until someone works in it. The markup is
 * the editor's own DOM for the same text (same elements, classes and inline
 * styles), so swapping in the editor changes nothing on screen. Only a plain
 * subset is drawn here; anything else (formatting, links, mentions, code,
 * nesting, blank-line runs) returns null and the card loads the editor
 * straight away, as before.
 */
export type StickyPreviewBlock =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "bulletList"; items: string[] }
  | { kind: "orderedList"; start: number; items: string[] }
  | { kind: "taskList"; items: { checked: boolean; text: string }[] };

type ListKind = "bulletList" | "orderedList" | "taskList";

type Line =
  | { type: "blank" }
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | {
      type: "item";
      list: ListKind;
      number: number;
      checked: boolean;
      text: string;
    }
  | { type: "text"; text: string; trailingSpaces: boolean };

// Markdown syntax, autolinks, entities and the custom tags: none of it is drawn
// here, so text holding any of it goes to the editor.
const UNSUPPORTED = /[\\`*_~[\]<>|@]|:\/\/|www\.|&#?[a-z0-9]+;/i;
// Text that would itself open a block (a list, heading, quote, rule).
const BLOCK_START = /^(?:[-+#>=]|\d+[.)](?: |$))/;

/** Plain text, or null when the editor would read markup in it. */
function plainText(text: string, { item = false } = {}): string | null {
  if (UNSUPPORTED.test(text)) return null;
  if (item && (text !== text.trim() || BLOCK_START.test(text))) return null;
  return text;
}

function classify(raw: string): Line | null {
  if (raw === "") return { type: "blank" };
  // Indentation (code, nesting) and whitespace-only lines.
  if (/^\s/.test(raw)) return null;

  const heading = /^(#{1,3}) (\S.*)$/.exec(raw);
  if (heading) {
    const text = plainText(heading[2]);
    if (text === null || text !== text.trimEnd() || text.includes("#")) {
      return null;
    }
    return { type: "heading", level: heading[1].length as 1 | 2 | 3, text };
  }

  const task = /^- \[([ xX])\] (.*)$/.exec(raw);
  if (task) {
    const text = task[2] === "" ? "" : plainText(task[2], { item: true });
    if (text === null) return null;
    return {
      type: "item",
      list: "taskList",
      number: 0,
      checked: task[1] !== " ",
      text,
    };
  }

  const bullet = /^- (.+)$/.exec(raw);
  if (bullet) {
    const text = plainText(bullet[1], { item: true });
    if (text === null) return null;
    return {
      type: "item",
      list: "bulletList",
      number: 0,
      checked: false,
      text,
    };
  }

  const ordered = /^(\d{1,9})\. (.+)$/.exec(raw);
  if (ordered) {
    const text = plainText(ordered[2], { item: true });
    if (text === null) return null;
    return {
      type: "item",
      list: "orderedList",
      number: Number(ordered[1]),
      checked: false,
      text,
    };
  }

  // Anything else that could open a block: headings past h3, rules, setext
  // underlines, other list markers.
  if (BLOCK_START.test(raw)) return null;
  const text = plainText(raw.replace(/ +$/, ""));
  if (text === null) return null;
  return { type: "text", text, trailingSpaces: text !== raw };
}

/**
 * The blocks the comment editor shows for `markdown`, or null when the text
 * uses anything this preview doesn't draw exactly as the editor does.
 */
export function parseStickyPreview(
  markdown: string,
): StickyPreviewBlock[] | null {
  const content = normalizeCommentMarkdown(markdown);
  if (content === "") return [];
  if (/[\t\r]/.test(content)) return null;
  // The editor turns extra blank lines into empty paragraphs by rules of its
  // own; leave all of those to it.
  if (/^\n|\n\n\n|\n\n$/.test(content)) return null;

  const blocks: StickyPreviewBlock[] = [];
  let last: StickyPreviewBlock | null = null;
  let afterBlank = false;
  // A line ending in spaces is a line break: only another line of the same
  // paragraph may follow it.
  let openLineBreak = false;

  for (const raw of content.split("\n")) {
    const line = classify(raw);
    if (!line) return null;
    if (line.type === "blank") {
      if (openLineBreak) return null;
      afterBlank = true;
      continue;
    }
    const adjacent = last !== null && !afterBlank;
    afterBlank = false;
    if (openLineBreak && line.type !== "text") return null;
    openLineBreak = false;

    if (line.type === "text") {
      if (adjacent && last?.kind === "paragraph") {
        last.lines.push(line.text);
      } else if (adjacent && last?.kind !== "heading") {
        // A line right under a list item continues that item.
        return null;
      } else {
        last = { kind: "paragraph", lines: [line.text] };
        blocks.push(last);
      }
      openLineBreak = line.trailingSpaces;
      continue;
    }

    if (line.type === "heading") {
      // A heading may follow another heading on the next line, but not a
      // paragraph or a list item.
      if (adjacent && last?.kind !== "heading") return null;
      last = { kind: "heading", level: line.level, text: line.text };
      blocks.push(last);
      continue;
    }

    if (last?.kind === line.list) {
      // Items of one list sit on consecutive lines; a blank line between
      // them makes a loose list or two lists, depending on the kind.
      if (!adjacent) return null;
      if (last.kind === "taskList") {
        last.items.push({ checked: line.checked, text: line.text });
      } else {
        last.items.push(line.text);
      }
      continue;
    }
    // On the next line, a non-empty bullet or to-do item ends a paragraph or
    // heading, and a bullet starts a list of its own under a to-do or
    // numbered list. The editor reads other kinds of lists that touch in
    // ways of its own.
    if (adjacent) {
      const afterText = last?.kind === "paragraph" || last?.kind === "heading";
      const opens = afterText
        ? line.list !== "orderedList" && line.text !== ""
        : line.list === "bulletList";
      if (!opens) return null;
    }
    last =
      line.list === "taskList"
        ? {
            kind: "taskList",
            items: [{ checked: line.checked, text: line.text }],
          }
        : line.list === "orderedList"
          ? { kind: "orderedList", start: line.number, items: [line.text] }
          : { kind: "bulletList", items: [line.text] };
    blocks.push(last);
  }

  if (openLineBreak) return null;
  return blocks;
}

// The editor injects these for its root (unlayered, so they win over the
// app's layered rules); the preview carries them itself because no editor
// may exist on the page yet.
const ROOT_STYLE: CSSProperties = {
  position: "relative",
  overflowWrap: "break-word",
  whiteSpace: "break-spaces",
  fontVariantLigatures: "none",
  fontFeatureSettings: '"liga" 0',
};

const TRAILING_BREAK = <br className="ProseMirror-trailingBreak" />;

type StickyPreviewProps = {
  blocks: StickyPreviewBlock[];
  placeholder: string;
  /** The editor shell's classes (the card's editor sizing). */
  className?: string;
  /** Checked state per to-do, by its index in the sticky, for clicks not yet applied. */
  checkedOverrides?: ReadonlyMap<number, boolean>;
  onToggleTask?: (index: number, checked: boolean) => void;
  rootRef?: Ref<HTMLDivElement>;
  onRootKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  onRootPointerDown?: PointerEventHandler<HTMLDivElement>;
};

/** The sticky's text as the comment editor draws it, without the editor. */
export function StickyPreview({
  blocks,
  placeholder,
  className,
  checkedOverrides,
  onToggleTask,
  rootRef,
  onRootKeyDown,
  onRootPointerDown,
}: StickyPreviewProps) {
  const { t } = useTranslation();
  let taskIndex = 0;

  const renderBlock = (block: StickyPreviewBlock, key: number) => {
    switch (block.kind) {
      case "paragraph":
        return (
          <p key={key}>
            {block.lines.map((line, index) =>
              index === 0 ? (
                line
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity
                <Fragment key={index}>
                  <br />
                  {line}
                </Fragment>
              ),
            )}
          </p>
        );
      case "heading": {
        const Heading = `h${block.level}` as const;
        return <Heading key={key}>{block.text}</Heading>;
      }
      case "bulletList":
        return (
          <ul key={key}>
            {block.items.map((item, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: items have no identity
              <li key={index}>
                <p>{item}</p>
              </li>
            ))}
          </ul>
        );
      case "orderedList":
        return (
          <ol key={key} start={block.start === 1 ? undefined : block.start}>
            {block.items.map((item, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: items have no identity
              <li key={index}>
                <p>{item}</p>
              </li>
            ))}
          </ol>
        );
      case "taskList":
        return (
          <ul key={key} data-type="taskList">
            {block.items.map((item, index) => {
              const itemIndex = taskIndex;
              taskIndex += 1;
              const checked = checkedOverrides?.get(itemIndex) ?? item.checked;
              return (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: items have no identity
                  key={index}
                  data-type="taskItem"
                  data-checked={checked ? "true" : "false"}
                  data-node-view-wrapper=""
                  style={{ whiteSpace: "normal" }}
                >
                  <div
                    contentEditable={false}
                    className="margaya-task-item-checkbox"
                  >
                    <Checkbox
                      checked={checked}
                      aria-label={
                        checked
                          ? t("tasks:detail.editor.checkbox.markIncomplete")
                          : t("tasks:detail.editor.checkbox.markComplete")
                      }
                      onCheckedChange={(value) =>
                        onToggleTask?.(itemIndex, value === true)
                      }
                    />
                  </div>
                  <div
                    data-node-view-content=""
                    style={{ whiteSpace: "pre-wrap" }}
                  >
                    <div
                      data-node-view-content-react=""
                      data-node-view-wrapper=""
                      style={{ whiteSpace: "inherit" }}
                    >
                      <p>{item.text === "" ? TRAILING_BREAK : item.text}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        );
    }
  };

  return (
    <section
      aria-label={t("activity:comment.editor.ariaCommentEditor")}
      className={cn("margaya-comment-editor-shell", className)}
    >
      <div className="margaya-comment-editor-content">
        {/* biome-ignore lint/a11y/useSemanticElements: stands in for the editor's contenteditable root until it loads */}
        <div
          ref={rootRef}
          role="textbox"
          aria-multiline="true"
          tabIndex={0}
          translate="no"
          data-sticky-preview=""
          className="ProseMirror margaya-comment-editor-prose cursor-text"
          style={ROOT_STYLE}
          onKeyDown={onRootKeyDown}
          onPointerDown={onRootPointerDown}
        >
          {blocks.length === 0 ? (
            <p
              data-placeholder={placeholder}
              className="is-empty is-editor-empty"
            >
              {TRAILING_BREAK}
            </p>
          ) : (
            blocks.map(renderBlock)
          )}
        </div>
      </div>
    </section>
  );
}

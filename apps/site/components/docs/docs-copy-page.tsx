"use client";

import { ArrowUpRight, Check, ChevronDown, Copy, FileText } from "lucide-react";
import { useId, useRef, useState } from "react";

const SITE = "https://margaya.app";

// Assistants offered in the menu. Each link carries only a prompt with the
// page's public Markdown URL; nothing is sent until the reader follows it.
const ASSISTANTS = [
  { label: "Open in ChatGPT", url: "https://chatgpt.com/?q=" },
  { label: "Open in Claude", url: "https://claude.ai/new?q=" },
];

async function copyMarkdown(href: string): Promise<boolean> {
  try {
    const text = fetch(href).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    });
    // A ClipboardItem with a pending blob keeps the click's user activation
    // in browsers that require it (Safari); others take plain text.
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": text.then(
            (value) => new Blob([value], { type: "text/plain" }),
          ),
        }),
      ]);
    } else {
      await navigator.clipboard.writeText(await text);
    }
    return true;
  } catch {
    return false;
  }
}

/** "Copy page": the page as Markdown, to copy, read or hand to an assistant. */
export function DocsCopyPage({ markdownHref }: { markdownHref: string }) {
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    menuRef.current?.hidePopover?.();
    setState((await copyMarkdown(markdownHref)) ? "copied" : "failed");
    window.setTimeout(() => setState("idle"), 1500);
  };

  const prompt = `Read ${SITE}${markdownHref} so I can ask questions about it.`;

  return (
    <div className="docs-copy-page">
      <button type="button" onClick={copy} className="docs-copy-page-main">
        {state === "copied" ? (
          <Check aria-hidden="true" className="size-3.5" />
        ) : (
          <Copy aria-hidden="true" className="size-3.5" />
        )}
        <span className="max-sm:sr-only">
          {state === "copied"
            ? "Copied"
            : state === "failed"
              ? "Copy failed"
              : "Copy page"}
        </span>
      </button>
      <button
        ref={toggleRef}
        type="button"
        popoverTarget={menuId}
        aria-label="More page actions"
        className="docs-copy-page-toggle"
      >
        <ChevronDown aria-hidden="true" className="size-3.5" />
      </button>
      <div
        ref={menuRef}
        id={menuId}
        popover="auto"
        className="docs-copy-page-menu"
        onBeforeToggle={(event) => {
          // The menu sits in the top layer; place it under the split button.
          const toggle = toggleRef.current;
          const menu = menuRef.current;
          if (event.newState !== "open" || !toggle || !menu) return;
          const box = toggle.getBoundingClientRect();
          menu.style.top = `${box.bottom + 6}px`;
          menu.style.right = `${Math.max(document.documentElement.clientWidth - box.right, 8)}px`;
        }}
      >
        <button type="button" onClick={copy} className="docs-menu-item">
          <Copy aria-hidden="true" className="size-4" />
          Copy as Markdown
        </button>
        <a
          href={markdownHref}
          target="_blank"
          rel="noreferrer"
          className="docs-menu-item"
        >
          <FileText aria-hidden="true" className="size-4" />
          View as Markdown
        </a>
        {ASSISTANTS.map((assistant) => (
          <a
            key={assistant.label}
            href={`${assistant.url}${encodeURIComponent(prompt)}`}
            target="_blank"
            rel="noreferrer"
            className="docs-menu-item"
          >
            <ArrowUpRight aria-hidden="true" className="size-4" />
            {assistant.label}
          </a>
        ))}
      </div>
      <span aria-live="polite" className="sr-only">
        {state === "copied" ? "Page copied as Markdown" : ""}
      </span>
    </div>
  );
}

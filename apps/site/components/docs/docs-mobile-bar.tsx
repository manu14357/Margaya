"use client";

import { ArrowUp, ChevronDown, Menu, X } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { revealCurrentLink } from "./docs-enhance";
import { type TocHeading, useActiveHeading } from "./docs-toc";

/**
 * The sticky bar under the docs header on narrow screens: "Menu" opens the
 * sidebar in a drawer, "On this page" opens the outline. The sidebar comes in
 * as server-rendered `children`, so its links are written once.
 */
export function DocsMobileBar({
  headings,
  children,
}: {
  headings: TocHeading[];
  children: ReactNode;
}) {
  const drawerRef = useRef<HTMLDialogElement>(null);
  const outlineRef = useRef<HTMLDivElement>(null);
  const hasOutline = headings.length > 1;
  const active = useActiveHeading(hasOutline ? headings : []);
  const activeText = headings.find((heading) => heading.id === active)?.text;

  const openDrawer = () => {
    const drawer = drawerRef.current;
    if (!drawer || drawer.open) return;
    drawer.showModal();
    revealCurrentLink(drawer);
  };

  return (
    <div className={`docs-mobile-bar${hasOutline ? "" : " lg:hidden"}`}>
      <button
        type="button"
        onClick={openDrawer}
        aria-haspopup="dialog"
        className="docs-mobile-button lg:hidden"
      >
        <Menu aria-hidden="true" className="size-4" />
        Menu
      </button>
      {hasOutline ? (
        <>
          <button
            type="button"
            popoverTarget="docs-outline-popover"
            className="docs-mobile-button ml-auto min-w-0"
          >
            <span className="truncate">{activeText ?? "On this page"}</span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
            <span className="sr-only"> (On this page)</span>
          </button>
          <div
            ref={outlineRef}
            id="docs-outline-popover"
            popover="auto"
            className="docs-outline-popover"
          >
            <p className="docs-toc-label">On this page</p>
            <ul className="mt-2">
              {headings.map((heading) => (
                <li key={heading.id}>
                  <a
                    href={`#${heading.id}`}
                    aria-current={
                      heading.id === active ? "location" : undefined
                    }
                    onClick={() => outlineRef.current?.hidePopover()}
                    className={`docs-outline-link${heading.depth === 3 ? " pl-6" : ""}`}
                  >
                    {heading.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <a href="#docs-main" className="docs-mobile-button ml-auto">
          Back to top
          <ArrowUp aria-hidden="true" className="size-4" />
        </a>
      )}
      <dialog
        ref={drawerRef}
        aria-label="Documentation menu"
        className="docs-drawer"
        onClick={(event) => {
          // A click on the dialog box itself is a click on the scrim.
          if (event.target === event.currentTarget) drawerRef.current?.close();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") drawerRef.current?.close();
        }}
      >
        <div className="docs-drawer-head">
          <span className="font-medium text-sm">Menu</span>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => drawerRef.current?.close()}
            className="docs-icon-button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div className="docs-drawer-body" data-docs-scroll>
          {children}
        </div>
      </dialog>
    </div>
  );
}

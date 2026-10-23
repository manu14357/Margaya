"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// The docs body is build-time HTML, not React, so its interactive parts
// (copy buttons, tabs, image zoom) are wired here once per page through
// event delegation. Without JavaScript the same HTML stays readable: every
// tab panel shows, stacked.

const LANGUAGE_KEY = "margaya-docs-tab";
const COPIED_MS = 1500;

function readStoredTab(): string | null {
  try {
    return window.localStorage.getItem(LANGUAGE_KEY);
  } catch {
    return null;
  }
}

function storeTab(label: string) {
  try {
    window.localStorage.setItem(LANGUAGE_KEY, label);
  } catch {
    // Storage can be unavailable (private mode); the choice just isn't kept.
  }
}

function tabsOf(group: Element): HTMLButtonElement[] {
  return [
    ...group.querySelectorAll<HTMLButtonElement>(
      ":scope > .docs-tabs-bar [role=tab]",
    ),
  ];
}

function selectTab(group: Element, label: string): boolean {
  const tabs = tabsOf(group);
  const index = tabs.findIndex((tab) => tab.dataset.tabLabel === label);
  if (index === -1) return false;
  tabs.forEach((tab, position) => {
    const selected = position === index;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(
      tab.getAttribute("aria-controls") ?? "",
    );
    if (panel) panel.toggleAttribute("data-active", selected);
  });
  return true;
}

/** Selects the tab with this label in every group that has one. */
function syncTabs(label: string) {
  for (const group of document.querySelectorAll("[data-tabs]")) {
    selectTab(group, label);
  }
}

/** Centres the current page's link inside its scrolling sidebar. */
export function revealCurrentLink(container: Element | null) {
  const link = container?.querySelector<HTMLElement>("[aria-current=page]");
  const scroller = link?.closest<HTMLElement>("[data-docs-scroll]");
  if (!link || !scroller) return;
  const offset =
    link.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  scroller.scrollTop +=
    offset - scroller.clientHeight / 2 + link.offsetHeight / 2;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function DocsEnhance() {
  const [announcement, setAnnouncement] = useState("");
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  const zoomRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const stored = readStoredTab();
    if (stored) syncTabs(stored);
    revealCurrentLink(document.querySelector("[data-docs-sidebar]"));

    const timers = new Set<number>();

    const onClick = async (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target) return;

      const copy = target.closest<HTMLButtonElement>(
        "[data-copy], [data-copy-text]",
      );
      if (copy) {
        const text =
          copy.dataset.copyText ??
          copy.closest(".docs-code")?.querySelector("pre")?.innerText ??
          "";
        if (!(await copyText(text.replace(/\n$/, "")))) {
          setAnnouncement("Copy failed");
          return;
        }
        copy.dataset.copied = "";
        setAnnouncement("");
        // A fresh string each time, so a second copy is announced too.
        window.requestAnimationFrame(() => setAnnouncement("Copied"));
        const timer = window.setTimeout(() => {
          delete copy.dataset.copied;
          timers.delete(timer);
        }, COPIED_MS);
        timers.add(timer);
        return;
      }

      const tab = target.closest<HTMLButtonElement>("[data-tabs] [role=tab]");
      if (tab?.dataset.tabLabel) {
        const label = tab.dataset.tabLabel;
        const group = tab.closest("[data-tabs]");
        if (group) selectTab(group, label);
        // Response status tabs are per operation; languages carry across pages.
        if (!group?.matches(".docs-response-group")) {
          syncTabs(label);
          storeTab(label);
        }
        return;
      }

      const image =
        target
          .closest(".docs-shot-zoom")
          ?.querySelector<HTMLImageElement>("img") ??
        target.closest<HTMLImageElement>(".docs-frame img");
      if (image) {
        setZoom({ src: image.currentSrc || image.src, alt: image.alt });
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const tab = (event.target as Element | null)?.closest<HTMLButtonElement>(
        "[data-tabs] [role=tab]",
      );
      const group = tab?.closest("[data-tabs]");
      if (!tab || !group) return;
      const tabs = tabsOf(group);
      const index = tabs.indexOf(tab);
      const next = {
        ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index - 1 + tabs.length) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      const nextTab = tabs[next];
      if (!nextTab?.dataset.tabLabel) return;
      selectTab(group, nextTab.dataset.tabLabel);
      nextTab.focus();
    };

    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const dialog = zoomRef.current;
    if (zoom && dialog && !dialog.open) dialog.showModal();
  }, [zoom]);

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <dialog
        ref={zoomRef}
        aria-label={zoom?.alt || "Image"}
        className="docs-zoom"
        onClose={() => setZoom(null)}
        onClick={() => zoomRef.current?.close()}
        onKeyDown={(event) => {
          if (event.key === "Escape") zoomRef.current?.close();
        }}
      >
        {zoom ? (
          <>
            {/* biome-ignore lint/performance/noImgElement: a full-size copy of an image already on the page, in a static export. */}
            <img src={zoom.src} alt={zoom.alt} />
            <button
              type="button"
              aria-label="Close image"
              className="docs-zoom-close"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </>
        ) : null}
      </dialog>
    </>
  );
}

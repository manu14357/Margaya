import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAppDocumentLock } from "./use-app-document-lock";

const indexCss = readFileSync(
  join(import.meta.dirname, "../index.css"),
  "utf8",
);
const desktopCss = readFileSync(
  join(import.meta.dirname, "../styles/desktop.css"),
  "utf8",
);

afterEach(cleanup);

function Shell() {
  useAppDocumentLock();
  return null;
}

/** The declarations of the first rule whose selector contains `selector`. */
function rule(css: string, selector: string) {
  const start = css.indexOf(selector);
  if (start < 0) return "";
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
}

describe("app document lock", () => {
  it("marks the document while the shell is mounted, and only then", () => {
    const root = document.documentElement;
    expect(root).not.toHaveAttribute("data-app-shell");
    const { unmount } = render(<Shell />);
    expect(root).toHaveAttribute("data-app-shell");
    unmount();
    expect(root).not.toHaveAttribute("data-app-shell");
  });

  it("locks the shell's document and stops overscroll in the shell and the desktop app", () => {
    const overscroll = rule(
      indexCss,
      "html:is([data-app-shell], [data-desktop-app]) body",
    );
    expect(overscroll).toMatch(/overscroll-behavior:\s*none/);
    const lock = rule(indexCss, "html[data-app-shell] body");
    expect(lock).toMatch(/overflow:\s*hidden/);
    expect(lock).toMatch(/height:\s*100%/);
  });

  it("keeps the floating Ask window under the desktop title bar line", () => {
    const css = desktopCss.slice(desktopCss.indexOf("(width >= 40rem)"));
    expect(
      rule(css, 'html[data-desktop-titlebar] [data-slot="ask-panel"]'),
    ).toMatch(
      /max-height:\s*calc\(100dvh - var\(--desktop-frame-top, 0px\) - 1\.5rem\)/,
    );
  });
});

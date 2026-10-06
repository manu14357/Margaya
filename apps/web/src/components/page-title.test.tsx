import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PageTitle from "./page-title";

afterEach(() => cleanup());

function Layout({
  hideAppName,
  showPage = true,
  page = "Drafts",
}: {
  hideAppName: boolean;
  showPage?: boolean;
  page?: string;
}) {
  return (
    <>
      <PageTitle title="Projects" hideAppName={hideAppName} />
      {showPage && <PageTitle title={page} />}
    </>
  );
}

describe("PageTitle", () => {
  it("lets the page's title win over its layout's", () => {
    render(<Layout hideAppName />);
    expect(document.title).toBe("Drafts · Margaya");
  });

  it("keeps the page's title when the layout's props change", () => {
    const view = render(<Layout hideAppName />);
    // The workspace loads: the layout's title re-renders.
    view.rerender(<Layout hideAppName={false} />);
    expect(document.title).toBe("Drafts · Margaya");
  });

  it("follows the page when it changes, and falls back to the layout", () => {
    const view = render(<Layout hideAppName={false} />);
    view.rerender(<Layout hideAppName={false} page="Archives" />);
    expect(document.title).toBe("Archives · Margaya");
    view.rerender(<Layout hideAppName={false} showPage={false} />);
    expect(document.title).toBe("Projects · Margaya");
  });

  it("drops the app name when asked", () => {
    render(<PageTitle title="Board" hideAppName />);
    expect(document.title).toBe("Board");
  });
});

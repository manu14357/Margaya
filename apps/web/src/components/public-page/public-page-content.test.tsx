import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PublicPageContent from "./public-page-content";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

describe("PublicPageContent", () => {
  it("shows a to-do's checkbox beside its text, as the app does", async () => {
    const { container } = render(
      <PublicPageContent
        content={{
          type: "doc",
          content: [
            {
              type: "taskList",
              content: [
                {
                  type: "taskItem",
                  attrs: { checked: true },
                  content: [paragraph("Ship it")],
                },
              ],
            },
          ],
        }}
      />,
    );
    // The app's styles lay out li[data-type="taskItem"] as a row of the
    // checkbox and the text.
    const item = await waitFor(() => {
      const found = container.querySelector('li[data-type="taskItem"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(item.dataset.checked).toBe("true");
    const [checkbox, text] = Array.from(item.children);
    expect(checkbox).toHaveClass("margaya-task-item-checkbox");
    expect(
      checkbox?.querySelector('[data-slot="checkbox"]'),
    ).toBeInTheDocument();
    expect(text).toHaveTextContent("Ship it");
  });

  it("shows a callout's box and icon", async () => {
    const { container } = render(
      <PublicPageContent
        content={{
          type: "doc",
          content: [
            {
              type: "callout",
              attrs: { variant: "warning" },
              content: [paragraph("Careful")],
            },
          ],
        }}
      />,
    );
    const callout = await waitFor(() => {
      const found = container.querySelector(".margaya-callout");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(callout.dataset.variant).toBe("warning");
    expect(callout.querySelector(".margaya-callout-icon svg")).not.toBeNull();
    expect(callout.querySelector(".margaya-callout-content")).toHaveTextContent(
      "Careful",
    );
  });
});

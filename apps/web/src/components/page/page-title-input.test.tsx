import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PageTitleInput, { singleLineTitle } from "./page-title-input";

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("@/lib/i18n", () => ({
  i18n: { t: (key: string) => key, language: "en-US" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/hooks/mutations/page/use-update-page", () => ({
  useUpdatePage: () => ({ mutate: mocks.mutate }),
}));

afterEach(() => {
  cleanup();
  mocks.mutate.mockReset();
});

function renderTitle(props: { canEdit?: boolean; title?: string } = {}) {
  const onEnter = vi.fn();
  render(
    <PageTitleInput
      pageId="page_1"
      projectId="p1"
      title={props.title ?? "Spec"}
      canEdit={props.canEdit ?? true}
      onEnter={onEnter}
    />,
  );
  return {
    onEnter,
    field: screen.getByRole("textbox", {
      name: "pages:editor.titleAria",
    }) as HTMLTextAreaElement,
  };
}

describe("PageTitleInput", () => {
  it("is a one-row textarea that wraps long titles", () => {
    const { field } = renderTitle();
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveAttribute("rows", "1");
  });

  it("saves and moves into the body on Enter, without a newline", () => {
    const { field, onEnter } = renderTitle();
    fireEvent.change(field, { target: { value: "Spec v2" } });
    const enter = fireEvent.keyDown(field, { key: "Enter" });
    expect(enter).toBe(false);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(field.value).toBe("Spec v2");
    expect(mocks.mutate).toHaveBeenCalledWith(
      { pageId: "page_1", projectId: "p1", json: { title: "Spec v2" } },
      expect.anything(),
    );
  });

  it("turns pasted line breaks into spaces", () => {
    const { field } = renderTitle();
    fireEvent.change(field, { target: { value: "Line one\r\n  Line two\n" } });
    expect(field.value).toBe("Line one Line two ");
    expect(singleLineTitle("a\nb")).toBe("a b");
  });

  it("grows with its content", () => {
    const { field } = renderTitle();
    Object.defineProperty(field, "scrollHeight", {
      configurable: true,
      value: 76,
    });
    fireEvent.change(field, { target: { value: "A much longer title" } });
    expect(field.style.height).toBe("76px");
  });

  it("can't be edited without permission", () => {
    const { field } = renderTitle({ canEdit: false });
    expect(field).toHaveAttribute("readonly");
    fireEvent.blur(field);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});

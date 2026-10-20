import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentTranslation } from "@/hooks/queries/ai/use-content-translation";
import TranslatableContent, { TranslationToggle } from "./translatable-content";

const m = vi.hoisted(() => ({
  state: null as unknown as ContentTranslation,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@/hooks/queries/ai/use-content-translation", () => ({
  useContentTranslation: () => m.state,
}));

function state(
  overrides: Partial<ContentTranslation> = {},
): ContentTranslation {
  return {
    offer: true,
    isTranslating: false,
    error: null,
    sourceLanguage: null,
    locale: "en-US",
    text: null,
    hasTranslation: false,
    translate: vi.fn(),
    showOriginal: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  m.state = state();
});
afterEach(cleanup);

describe("TranslationToggle", () => {
  it("renders nothing when the text is in the reader's language", () => {
    const { container } = render(
      <TranslationToggle translation={state({ offer: false })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers Translate, then names the language with Show original", () => {
    const translate = vi.fn();
    const { rerender } = render(
      <TranslationToggle translation={state({ translate })} />,
    );
    fireEvent.click(screen.getByText("ai:translate.action"));
    expect(translate).toHaveBeenCalledOnce();

    const showOriginal = vi.fn();
    rerender(
      <TranslationToggle
        translation={state({
          text: "Sign-in fails.",
          hasTranslation: true,
          sourceLanguage: "de",
          showOriginal,
        })}
      />,
    );
    expect(
      screen.getByText('ai:translate.translatedFrom {"language":"German"}'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("ai:translate.showOriginal"));
    expect(showOriginal).toHaveBeenCalledOnce();
  });

  it("shows progress while translating", () => {
    render(<TranslationToggle translation={state({ isTranslating: true })} />);
    expect(screen.getByText("ai:translate.translating")).toBeInTheDocument();
  });
});

describe("TranslatableContent", () => {
  it("renders the translation in place of the original while it shows", () => {
    m.state = state({ text: "Sign-in fails.", hasTranslation: true });
    render(
      <TranslatableContent
        kind="comment"
        id="c1"
        text="Die Anmeldung schlägt fehl."
      >
        {(text, translated) => <p data-translated={translated}>{text}</p>}
      </TranslatableContent>,
    );
    expect(screen.getByText("Sign-in fails.")).toHaveAttribute(
      "data-translated",
      "true",
    );
  });

  it("keeps the original while editing", () => {
    m.state = state({ text: "Sign-in fails.", hasTranslation: true });
    render(
      <TranslatableContent
        kind="comment"
        id="c1"
        text="Die Anmeldung schlägt fehl."
        hideToggle
      >
        {(text) => <p>{text}</p>}
      </TranslatableContent>,
    );
    expect(screen.getByText("Die Anmeldung schlägt fehl.")).toBeInTheDocument();
    expect(
      screen.queryByText("ai:translate.showOriginal"),
    ).not.toBeInTheDocument();
  });
});

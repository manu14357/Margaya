import { describe, expect, it } from "vitest";
import { mergeLandingCopy } from "./merge";

const english = {
  hero: { title: "Plan the work.", cta: "Get started" },
  faq: [
    { q: "Is it free?", a: "Yes." },
    { q: "Can I self-host?", a: "Yes." },
  ],
};

describe("mergeLandingCopy", () => {
  it("uses translated strings and falls back to English for missing ones", () => {
    expect(
      mergeLandingCopy(english, {
        hero: { title: "Planifiez le travail." },
        faq: [{ q: "C'est gratuit ?", a: "Oui." }],
      }),
    ).toEqual({
      hero: { title: "Planifiez le travail.", cta: "Get started" },
      faq: [
        { q: "C'est gratuit ?", a: "Oui." },
        { q: "Can I self-host?", a: "Yes." },
      ],
    });
  });

  it("keeps English when the bundle is missing or malformed", () => {
    expect(mergeLandingCopy(english, undefined)).toEqual(english);
    expect(
      mergeLandingCopy(english, { hero: "oops", faq: { q: 1 }, extra: "x" }),
    ).toEqual(english);
    expect(mergeLandingCopy(english, { hero: { title: "  " } })).toEqual(
      english,
    );
  });
});

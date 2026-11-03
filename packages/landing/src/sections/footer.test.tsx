import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import messages from "../../../../i18n/en-US.json";
import { LandingProviders } from "../landing-page";
import type { LandingLinks } from "../links";
import { FinalCtaSection } from "./final-cta-section";
import { LandingFooter } from "./footer";

const copy = messages.landing;

const links: LandingLinks = {
  home: "/",
  signUp: "/sign-up",
  selfHost: "https://example.com/install",
  docs: "https://example.com/docs",
  apiReference: "https://example.com/api",
  github: "https://example.com/margaya",
  features: {
    plan: "/features/plan",
    views: "/features/views",
    ai: "/features/ai",
    docs: "/features/docs",
    automate: "/features/automate",
    selfHost: "/features/self-host",
  },
};

const licensing = {
  license: "https://example.com/margaya/LICENSE",
  commercial: "https://example.com/margaya/COMMERCIAL.md",
};

function renderFooter(site?: LandingLinks["site"]) {
  return render(
    <LandingProviders copy={copy} links={{ ...links, site }}>
      <LandingFooter />
    </LandingProviders>,
  );
}

afterEach(cleanup);

describe("landing footer", () => {
  it("links the licence and the commercial licence when given", () => {
    renderFooter(licensing);
    const company = copy.home.footer.company;

    expect(
      screen
        .getByRole("link", { name: new RegExp(`^${company.licence}`) })
        .getAttribute("href"),
    ).toBe(licensing.license);
    expect(
      screen
        .getByRole("link", { name: new RegExp(`^${company.commercial}`) })
        .getAttribute("href"),
    ).toBe(licensing.commercial);
  });

  it("leaves the commercial licence out when the host gives no link", () => {
    renderFooter({ license: licensing.license });

    expect(
      screen.queryByRole("link", {
        name: new RegExp(`^${copy.home.footer.company.commercial}`),
      }),
    ).toBeNull();
  });
});

describe("final call to action", () => {
  it("points to the install guide and the docs", () => {
    render(
      <LandingProviders copy={copy} links={links}>
        <FinalCtaSection />
      </LandingProviders>,
    );
    const cta = copy.home.finalCta;

    expect(
      screen.getByRole("link", { name: cta.primary }).getAttribute("href"),
    ).toBe(links.selfHost);
    expect(
      screen.getByRole("link", { name: cta.secondary }).getAttribute("href"),
    ).toBe(links.docs);
  });
});

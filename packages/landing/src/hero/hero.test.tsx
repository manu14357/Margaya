import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../i18n/en-US.json";
import { LandingProviders } from "../landing-page";
import type { LandingLinks } from "../links";
import { HeroSection } from "../sections/hero-section";

const links: LandingLinks = {
  home: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",
  selfHost: "https://example.com/install",
  docs: "https://example.com/docs",
  apiReference: "https://example.com/api",
  pricing: "/pricing",
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

const hero = messages.landing.home.hero;

/** Answers media queries from a set of the ones that match. */
function mockMedia(matching: string[]) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: matching.includes(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  );
}

const REDUCE = "(prefers-reduced-motion: reduce)";

function renderHero() {
  return render(
    <LandingProviders copy={messages.landing} links={links}>
      <HeroSection />
    </LandingProviders>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("hero section", () => {
  it("has one h1, one line of copy and exactly two calls to action", () => {
    mockMedia([]);
    const { container } = renderHero();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe(`${hero.title} ${hero.titleAccent}`);
    expect(screen.getByText(hero.description).tagName).toBe("P");
    expect(
      screen.getByRole("link", { name: hero.primaryCta }).getAttribute("href"),
    ).toBe(links.signUp);
    expect(
      screen
        .getByRole("link", { name: hero.secondaryCta })
        .getAttribute("href"),
    ).toBe(links.selfHost);
    expect(container.querySelectorAll("a")).toHaveLength(2);
  });

  it("has no version badge above the headline", () => {
    mockMedia([]);
    const { container } = renderHero();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.previousElementSibling).toBeNull();
    expect(container.textContent).not.toMatch(/v\d+\.\d+/);
  });

  it("describes the demo for screen readers before and after it mounts", async () => {
    mockMedia([]);
    const { container } = renderHero();
    expect(
      screen.getAllByText(messages.landing.scenes.hero.description).length,
    ).toBeGreaterThan(0);
    await waitFor(() =>
      expect(
        container.querySelector('[data-demo-stage="hero"]'),
      ).not.toBeNull(),
    );
    expect(
      screen.getByText(messages.landing.scenes.hero.description).className,
    ).toContain("sr-only");
  });

  it("shows one flat screen: no tilt, no floating cards, no backdrop", async () => {
    mockMedia(["(min-width: 1024px)", "(min-width: 768px)"]);
    const { container } = renderHero();
    await waitFor(() =>
      expect(
        container.querySelector('[data-demo-stage="hero"]'),
      ).not.toBeNull(),
    );
    expect(container.querySelectorAll("[data-hero-window]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-demo-stage]")).toHaveLength(1);
    expect(container.querySelector("[data-hero-satellites]")).toBeNull();
    expect(container.querySelector("[data-parallax]")).toBeNull();
    expect(container.querySelector("style")).toBeNull();
    for (const element of container.querySelectorAll<HTMLElement>("*")) {
      const classes = element.getAttribute("class") ?? "";
      expect(classes).not.toMatch(/perspective|rotate-x|preserve-3d|blur-/);
      expect(element.style.transform).not.toMatch(/rotateX|perspective/);
    }
  });

  it("shows the still final frame with reduced motion", async () => {
    mockMedia([REDUCE]);
    const { container } = renderHero();
    const inProgress = await waitFor(() => {
      const column = container.querySelector('[data-demo="column-inProgress"]');
      expect(column?.textContent).toContain("Fix login redirect");
      return column;
    });
    expect(inProgress).not.toBeNull();
    expect(
      container
        .querySelector('[data-demo="task-sheet"]')
        ?.getAttribute("data-open"),
    ).toBe("true");
  });
});

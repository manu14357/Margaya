import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomeGreeting, { dayPeriodOf, greetingName } from "./home-greeting";

const session = vi.hoisted(() => ({
  user: { name: "Ada Lovelace", email: "ada@example.com" } as {
    name: string;
    email: string;
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@/hooks/use-locale", () => ({
  useLocale: () => ({ locale: "en-US" }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: session.user } }) },
}));

function at(hours: number, minutes: number, seconds = 0) {
  return new Date(2026, 8, 26, hours, minutes, seconds);
}

describe("dayPeriodOf", () => {
  it("splits the day at 12:00 and 18:00", () => {
    expect(dayPeriodOf(at(0, 0))).toBe("morning");
    expect(dayPeriodOf(at(11, 59))).toBe("morning");
    expect(dayPeriodOf(at(12, 0))).toBe("afternoon");
    expect(dayPeriodOf(at(17, 59))).toBe("afternoon");
    expect(dayPeriodOf(at(18, 0))).toBe("evening");
    expect(dayPeriodOf(at(23, 59))).toBe("evening");
  });
});

describe("greetingName", () => {
  it("prefers the display name and falls back to the email's local part", () => {
    expect(greetingName({ name: "Ada", email: "a@x.io" })).toBe("Ada");
    expect(greetingName({ name: "  ", email: "grace.h@example.com" })).toBe(
      "grace.h",
    );
    expect(greetingName(null)).toBe("");
  });
});

describe("HomeGreeting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    session.user = { name: "", email: "ada@example.com" };
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("greets by the email's local part and updates after the minute boundary", () => {
    vi.setSystemTime(at(11, 59, 30));
    render(<HomeGreeting />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toContain("home:greeting.morning");
    expect(heading.textContent).toContain('"name":"ada"');

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(heading.textContent).toContain("home:greeting.afternoon");
  });
});

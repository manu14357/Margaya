import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { filterTimeZones, listTimeZones } from "@/lib/timezones";
import TimezoneSelect from "./timezone-select";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function open(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("time zone helpers", () => {
  it("lists UTC first and named IANA zones", () => {
    const zones = listTimeZones();
    expect(zones[0]).toBe("UTC");
    expect(zones).toContain("Europe/Berlin");
  });

  it("matches cities with spaces or underscores", () => {
    const zones = ["UTC", "America/New_York", "Europe/Berlin"];
    expect(filterTimeZones(zones, "new york")).toEqual(["America/New_York"]);
    expect(filterTimeZones(zones, "BERLIN")).toEqual(["Europe/Berlin"]);
    expect(filterTimeZones(zones, "")).toEqual(zones);
  });
});

describe("TimezoneSelect", () => {
  it("shows the current zone and saves a searched one", () => {
    const onChange = vi.fn();
    render(
      <TimezoneSelect label="Time zone" value="UTC" onChange={onChange} />,
    );
    open(/Time zone: UTC/);

    fireEvent.change(screen.getByLabelText("settings:timezone.search"), {
      target: { value: "tokyo" },
    });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    fireEvent.click(options[0] as HTMLElement);
    expect(onChange).toHaveBeenCalledWith("Asia/Tokyo");
  });

  it("does not save the zone that is already selected", () => {
    const onChange = vi.fn();
    render(
      <TimezoneSelect label="Time zone" value="UTC" onChange={onChange} />,
    );
    open(/Time zone/);
    fireEvent.change(screen.getByLabelText("settings:timezone.search"), {
      target: { value: "utc" },
    });
    const utc = screen
      .getAllByRole("option")
      .find((option) => option.textContent === "UTC");
    fireEvent.click(utc as HTMLElement);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers the leading automatic option while nothing is stored", () => {
    const onAutomatic = vi.fn();
    render(
      <TimezoneSelect
        label="Time zone"
        value={null}
        onChange={vi.fn()}
        leading={{ label: "Automatic", onSelect: onAutomatic }}
      />,
    );
    open(/Time zone: Automatic/);
    const automatic = screen.getByRole("option", { name: "Automatic" });
    expect(automatic.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(automatic);
    expect(onAutomatic).toHaveBeenCalledTimes(1);
  });

  it("is read-only when disabled", () => {
    render(
      <TimezoneSelect
        label="Time zone"
        value="Europe/Berlin"
        onChange={vi.fn()}
        disabled
      />,
    );
    const trigger = screen.getByRole("button", {
      name: /Europe\/Berlin|Berlin/,
    });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
  });
});

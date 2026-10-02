import { describe, expect, it, vi } from "vitest";
import { intakeActivityText, isIntakeActivity } from "./intake-activity-text";

vi.mock("@/lib/format", () => ({ formatDate: () => "Mon, Oct 5" }));

const t = (key: string, options?: Record<string, unknown>) => {
  const values = Object.entries(options ?? {})
    .filter(([name]) => name !== "defaultValue")
    .map(([name, value]) => `${name}=${value}`);
  return values.length > 0 ? `${key}(${values.join(",")})` : key;
};

function text(type: string, eventData: Record<string, unknown> = {}) {
  return intakeActivityText({ type, eventData }, t);
}

describe("intakeActivityText", () => {
  it("recognizes intake rows only", () => {
    expect(isIntakeActivity("intake_accepted")).toBe(true);
    expect(isIntakeActivity("status_changed")).toBe(false);
    expect(text("status_changed")).toBeNull();
  });

  it("names the source of submissions from outside the app", () => {
    expect(text("intake_submitted", { source: "in_app" })).toBe(
      "activity:intake.submitted",
    );
    expect(text("intake_submitted", { source: "api" })).toBe(
      "activity:intake.submittedVia(source=intake:source.api)",
    );
  });

  it("says where an accepted request went", () => {
    expect(text("intake_accepted", { columnName: "To Do" })).toBe(
      "activity:intake.accepted(column=To Do)",
    );
    expect(text("intake_accepted", { columnName: null })).toBe(
      "activity:intake.acceptedBacklog",
    );
  });

  it("quotes the decline reason when given", () => {
    expect(text("intake_declined", { note: "Out of scope" })).toBe(
      "activity:intake.declinedWithReason(note=Out of scope)",
    );
    expect(text("intake_declined", { note: null })).toBe(
      "activity:intake.declined",
    );
  });

  it("covers snoozes, duplicates and reopening", () => {
    expect(text("intake_snoozed", { until: "2026-10-05T00:00:00Z" })).toBe(
      "activity:intake.snoozed(date=Mon, Oct 5)",
    );
    expect(text("intake_unsnoozed")).toBe("activity:intake.unsnoozed");
    expect(text("intake_snooze_ended")).toBe("activity:intake.snoozeEnded");
    expect(text("intake_duplicate", { duplicateKey: "web-12" })).toBe(
      "activity:intake.duplicate(key=WEB-12)",
    );
    expect(text("intake_duplicate", {})).toBe(
      "activity:intake.duplicateDeleted",
    );
    expect(text("intake_reopened")).toBe("activity:intake.reopened");
  });
});

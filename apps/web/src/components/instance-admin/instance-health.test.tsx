import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstanceHealth } from "@/types/instance-admin";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));
vi.mock("./instance-page", () => ({
  InstanceSection: ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));

const { formatUptime, HealthChecks, HealthFailures, HealthJobs } = await import(
  "./instance-health"
);

afterEach(() => cleanup());

const t = (key: string, options?: Record<string, unknown>) =>
  `${key}:${JSON.stringify(options ?? {})}`;

describe("formatUptime", () => {
  it("uses days and hours past a day, hours and minutes before", () => {
    expect(formatUptime(90_061, t)).toBe(
      'instanceAdmin:health.uptimeDays:{"days":1,"hours":1}',
    );
    expect(formatUptime(3_720, t)).toBe(
      'instanceAdmin:health.uptimeHours:{"hours":1,"minutes":2}',
    );
  });
});

describe("HealthChecks", () => {
  it("labels every status with text, not colour alone", () => {
    const checks: InstanceHealth["checks"] = [
      { id: "database", status: "ok", code: null, latencyMs: 3, count: null },
      {
        id: "redis",
        status: "off",
        code: "disabled",
        latencyMs: null,
        count: null,
      },
      {
        id: "email",
        status: "error",
        code: "auth",
        latencyMs: null,
        count: null,
      },
      {
        id: "ai",
        status: "warning",
        code: "recent_errors",
        latencyMs: null,
        count: 2,
      },
    ];
    render(<HealthChecks checks={checks} />);
    expect(
      screen.getByText("instanceAdmin:health.checks.database"),
    ).toBeTruthy();
    expect(screen.getByText("instanceAdmin:health.status.ok")).toBeTruthy();
    expect(screen.getByText("instanceAdmin:health.status.off")).toBeTruthy();
    expect(screen.getByText("instanceAdmin:health.status.error")).toBeTruthy();
    expect(
      screen.getByText("instanceAdmin:health.status.warning"),
    ).toBeTruthy();
    expect(
      screen.getByText("instanceAdmin:health.codes.redisDisabled"),
    ).toBeTruthy();
    expect(
      screen.getByText("instanceAdmin:health.codes.smtpAuth"),
    ).toBeTruthy();
    expect(
      screen.getByText("instanceAdmin:health.codes.recentErrors"),
    ).toBeTruthy();
  });
});

describe("HealthJobs and HealthFailures", () => {
  it("show empty states", () => {
    render(
      <>
        <HealthJobs jobs={[]} />
        <HealthFailures failures={[]} />
      </>,
    );
    expect(screen.getByText("instanceAdmin:health.jobs.empty")).toBeTruthy();
    expect(
      screen.getByText("instanceAdmin:health.failures.empty"),
    ).toBeTruthy();
  });

  it("lists jobs not run yet and failures without a message", () => {
    render(
      <>
        <HealthJobs
          jobs={[
            {
              name: "trash-purge",
              running: false,
              lastRunAt: null,
              lastOutcome: null,
              lastDurationMs: null,
              lastSuccessAt: null,
              lastFailureAt: null,
              runs: 0,
              failures: 0,
            },
          ]}
        />
        <HealthFailures
          failures={[
            {
              source: "job",
              name: "notification-digest",
              message: null,
              at: "2026-11-13T10:00:00.000Z",
            },
          ]}
        />
      </>,
    );
    expect(screen.getByText("trash-purge")).toBeTruthy();
    expect(screen.getByText("instanceAdmin:health.jobs.notRun")).toBeTruthy();
    expect(screen.getByText("notification-digest")).toBeTruthy();
    expect(
      screen.getByText("instanceAdmin:health.failures.seeLog"),
    ).toBeTruthy();
  });
});

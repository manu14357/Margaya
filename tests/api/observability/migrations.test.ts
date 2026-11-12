import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/database", () => ({ default: {} }));

const { compareMigrations, readMigrationJournal } = await import(
  "../../../apps/api/src/observability/migrations"
);

const journal = [
  { idx: 0, when: 100, tag: "0000_base" },
  { idx: 1, when: 200, tag: "0001_next" },
  { idx: 2, when: 300, tag: "0002_last" },
];

describe("compareMigrations", () => {
  it("is ok when the database has every shipped migration", () => {
    expect(
      compareMigrations(journal, { count: 3, lastCreatedAt: 300 }),
    ).toMatchObject({
      status: "ok",
      pending: 0,
      available: 3,
      latest: "0002_last",
    });
  });

  it("counts migrations newer than the last one recorded", () => {
    expect(
      compareMigrations(journal, { count: 1, lastCreatedAt: 100 }),
    ).toMatchObject({ status: "pending", pending: 2, latest: "0000_base" });
    expect(
      compareMigrations(journal, { count: 0, lastCreatedAt: null }),
    ).toMatchObject({ status: "pending", pending: 3, latest: null });
  });

  it("is unknown without a journal", () => {
    expect(
      compareMigrations(null, { count: 4, lastCreatedAt: 400 }).status,
    ).toBe("unknown");
  });

  it("finds the journal shipped with the API", () => {
    expect(readMigrationJournal()?.[0]?.tag).toBe("0000_margaya_baseline");
  });
});

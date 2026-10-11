import { describe, expect, it } from "vitest";
import {
  deliverySummary,
  privateData,
  redeliveryBody,
  serializeEnvelope,
} from "../../../apps/api/src/webhook/envelope";

const base = {
  deliveryId: "d1",
  event: "task.created",
  occurredAt: new Date("2026-10-06T12:00:00.000Z"),
  webhookId: "w1",
  workspace: { id: "ws", name: "Acme", slug: "acme" },
  project: { id: "p1", name: "Web", slug: "web" },
  actor: { id: "u1", name: "Ada" },
  data: { id: "t1", projectId: "p1", title: "Fix login" },
  changes: null,
};

describe("serializeEnvelope", () => {
  it("writes the envelope fields in order", () => {
    const { body, truncated } = serializeEnvelope(base);
    expect(truncated).toBe(false);
    const parsed = JSON.parse(body);
    expect(Object.keys(parsed)).toEqual([
      "id",
      "event",
      "version",
      "occurredAt",
      "webhookId",
      "workspace",
      "project",
      "actor",
      "data",
      "changes",
    ]);
    expect(parsed).toMatchObject({
      id: "d1",
      version: 1,
      occurredAt: "2026-10-06T12:00:00.000Z",
      actor: { id: "u1", name: "Ada" },
    });
  });

  it("replaces oversized data by its identifiers", () => {
    const big = {
      ...base,
      data: { ...base.data, description: "x".repeat(300_000) },
    };
    const { body, truncated } = serializeEnvelope(big);
    expect(truncated).toBe(true);
    const parsed = JSON.parse(body);
    expect(parsed.data).toEqual({ id: "t1", projectId: "p1" });
    expect(parsed.dataTruncated).toBe(true);
    expect(Buffer.byteLength(body)).toBeLessThan(256 * 1024);
  });

  it("falls back to the project for the identifier", () => {
    const { body } = serializeEnvelope({ ...base, data: { id: "x" } }, 10);
    expect(JSON.parse(body).data).toEqual({ id: "x", projectId: "p1" });
  });
});

describe("redeliveryBody", () => {
  it("swaps the id and marks the copy", () => {
    const { body } = serializeEnvelope(base);
    const copy = JSON.parse(redeliveryBody(body, "d2"));
    expect(copy.id).toBe("d2");
    expect(copy.redelivery).toBe(true);
    expect(copy.data).toEqual(base.data);
    expect(copy.occurredAt).toBe("2026-10-06T12:00:00.000Z");
  });
});

describe("privateData", () => {
  it("carries ids only", () => {
    expect(privateData("pg", "p1")).toEqual({
      id: "pg",
      projectId: "p1",
      access: "private",
    });
  });
});

describe("deliverySummary", () => {
  it("prefers key and title, then a name, then the event", () => {
    expect(
      deliverySummary("task.created", "t1", { key: "WEB-12", title: "Fix" }),
    ).toBe("WEB-12 · Fix");
    expect(deliverySummary("cycle.created", "c1", { name: "Sprint 4" })).toBe(
      "Sprint 4",
    );
    expect(
      deliverySummary("intake.item_created", "i1", {
        task: { key: "WEB-3", title: "Bug" },
      }),
    ).toBe("WEB-3 · Bug");
    expect(deliverySummary("column.deleted", "col", {})).toBe(
      "column.deleted col",
    );
  });

  it("clips to 200 characters", () => {
    expect(
      deliverySummary("x.y", null, { name: "n".repeat(500) }),
    ).toHaveLength(200);
  });
});

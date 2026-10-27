import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/http-error";
import {
  aiErrorCode,
  aiErrorKey,
  dollarsToMicros,
  formatCostMicros,
  microsToDollarsInput,
  usageRangeDays,
} from "./format";

describe("AI formatting", () => {
  it("reads AI error codes from API errors", () => {
    const error = new HttpError(
      429,
      JSON.stringify({ code: "AI_BUDGET_EXCEEDED", message: "cap" }),
    );
    expect(aiErrorCode(error)).toBe("AI_BUDGET_EXCEEDED");
    expect(aiErrorKey(error)).toBe("ai:errors.AI_BUDGET_EXCEEDED");
    expect(aiErrorKey(new HttpError(403, "Insufficient permissions"))).toBe(
      "ai:errors.unknown",
    );
    expect(aiErrorKey({ code: "AI_REFUSED" })).toBe("ai:errors.AI_REFUSED");
  });

  it("converts dollars and micro-dollars", () => {
    expect(dollarsToMicros("12.5")).toBe(12_500_000);
    expect(dollarsToMicros("3,25")).toBe(3_250_000);
    expect(dollarsToMicros("")).toBeNull();
    expect(dollarsToMicros("-1")).toBeNaN();
    expect(microsToDollarsInput(12_500_000)).toBe("12.5");
    expect(microsToDollarsInput(null)).toBe("");
    expect(formatCostMicros(1_234_567, "en-US")).toBe("$1.23");
    expect(formatCostMicros(1_234, "en-US")).toBe("$0.0012");
  });

  it("computes UTC day ranges", () => {
    const now = new Date("2026-10-21T08:00:00Z");
    expect(usageRangeDays("thisMonth", now)).toEqual({
      from: "2026-10-01",
      to: "2026-10-21",
    });
    expect(usageRangeDays("last30Days", now)).toEqual({
      from: "2026-09-22",
      to: "2026-10-21",
    });
  });
});

import { describe, expect, it } from "vitest";
import { allIntegers, bandScale, linearScale, niceTicks } from "./scale";

describe("niceTicks", () => {
  it("gives a usable axis for an all-zero chart", () => {
    expect(niceTicks(0, { integer: true })).toEqual([0, 1]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });

  it("steps by 1, 2 or 5 from 0 up to at least the maximum", () => {
    expect(niceTicks(1, { integer: true })).toEqual([0, 1]);
    expect(niceTicks(7, { integer: true })).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(10, { integer: true })).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(97, { integer: true })).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(1234, { integer: true })).toEqual([0, 500, 1000, 1500]);
  });

  it("keeps ticks whole when every value is an integer", () => {
    expect(niceTicks(2, { integer: true })).toEqual([0, 1, 2]);
    expect(niceTicks(3, { integer: true })).toEqual([0, 1, 2, 3]);
    for (const max of [1, 2, 3, 4, 7, 13]) {
      expect(niceTicks(max, { integer: true }).every(Number.isInteger)).toBe(
        true,
      );
    }
  });

  it("uses clean decimal steps for point sums", () => {
    expect(niceTicks(1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(2)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(niceTicks(2.5)).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
    expect(niceTicks(0.7)).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
  });

  it("treats negative or invalid maxima as an empty axis", () => {
    expect(niceTicks(-3)).toEqual([0, 1]);
    expect(niceTicks(Number.NaN)).toEqual([0, 1]);
    expect(niceTicks(Number.POSITIVE_INFINITY)).toEqual([0, 1]);
  });
});

describe("allIntegers", () => {
  it("detects fractional values", () => {
    expect(allIntegers([0, 3, 12])).toBe(true);
    expect(allIntegers([])).toBe(true);
    expect(allIntegers([1, 2.5])).toBe(false);
  });
});

describe("linearScale", () => {
  it("maps the domain onto the range, including inverted ranges", () => {
    const y = linearScale([0, 10], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(5)).toBe(100);
    expect(y(10)).toBe(0);
  });

  it("maps a zero-width domain to the start of the range", () => {
    expect(linearScale([4, 4], [10, 90])(4)).toBe(10);
  });
});

describe("bandScale", () => {
  it("splits the range into equal slots with inner padding", () => {
    const bands = bandScale(4, [0, 200], 0.2);
    expect(bands.step).toBe(50);
    expect(bands.bandwidth).toBe(40);
    expect(bands.slotStart(1)).toBe(50);
    expect(bands.start(0)).toBe(5);
    expect(bands.start(3)).toBe(155);
    expect(bands.center(3)).toBe(175);
  });

  it("has no width without bands", () => {
    const bands = bandScale(0, [0, 200]);
    expect(bands.step).toBe(0);
    expect(bands.bandwidth).toBe(0);
  });
});

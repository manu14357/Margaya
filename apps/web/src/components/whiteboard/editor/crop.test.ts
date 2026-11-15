import {
  type BoardElement,
  createElement,
  flipElements,
  type ImageElement,
  rotateElements,
} from "@margaya/whiteboard";
import { describe, expect, it } from "vitest";
import {
  fromPictureFrame,
  moveWindow,
  pictureFrame,
  resizeWindow,
  showWindow,
  toPictureFrame,
  uncropped,
} from "./crop";

// A 400x200 picture shown at half size: 200x100 board units at (100, 100).
const NATURAL = { width: 400, height: 200 };

function picture(props: Partial<ImageElement> = {}): ImageElement {
  return createElement("image", {
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    assetId: "asset",
    ...props,
  } as never) as ImageElement;
}

function frameOf(element: BoardElement) {
  const frame = pictureFrame(element as ImageElement, NATURAL);
  if (!frame) throw new Error("no frame");
  return frame;
}

/** Where a picture pixel lands on the board. */
function pixelOnBoard(element: BoardElement, px: number, py: number) {
  const frame = frameOf(element);
  return fromPictureFrame(frame, {
    x: px * frame.scaleX,
    y: py * frame.scaleY,
  });
}

function expectClose(a: { x: number; y: number }, b: { x: number; y: number }) {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
}

/** Every pixel that stays visible must stay where it was on the board. */
function expectPictureStill(before: BoardElement, after: BoardElement) {
  for (const [px, py] of [
    [0, 0],
    [400, 0],
    [123, 77],
    [400, 200],
  ] as const) {
    expectClose(pixelOnBoard(after, px, py), pixelOnBoard(before, px, py));
  }
}

describe("picture frame", () => {
  it("lays an uncropped image out as the whole picture", () => {
    const frame = frameOf(picture());
    expect(frame.origin).toEqual({ x: 100, y: 100 });
    expect(frame.scaleX).toBe(0.5);
    expect(frame.width).toBe(200);
    expect(frame.window).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it("places a cropped image's whole picture around what it shows", () => {
    // Shows picture pixels 100..300 x 50..150 at 200x100: scale 1.
    const frame = frameOf(
      picture({ crop: { x: 100, y: 50, width: 200, height: 100 } }),
    );
    expect(frame.origin).toEqual({ x: 0, y: 50 });
    expect(frame.scaleX).toBe(1);
    expect(frame.width).toBe(400);
    expect(frame.window).toEqual({ x: 100, y: 50, width: 200, height: 100 });
  });

  it("has no frame without a size", () => {
    expect(pictureFrame(picture(), { width: 0, height: 10 })).toBeNull();
    expect(pictureFrame(picture({ width: 0 }), NATURAL)).toBeNull();
  });

  it("maps board points into the frame and back, turned", () => {
    const frame = frameOf(picture({ angle: 0.7 }));
    const point = { x: 140, y: 175 };
    expectClose(fromPictureFrame(frame, toPictureFrame(frame, point)), point);
  });
});

describe("cropping", () => {
  it("writes the crop in picture pixels and keeps the kept part in place", () => {
    const before = picture();
    const frame = frameOf(before);
    const after = showWindow(before, frame, {
      x: 50,
      y: 25,
      width: 100,
      height: 50,
    }) as ImageElement;
    expect(after).toMatchObject({ x: 150, y: 125, width: 100, height: 50 });
    expect(after.crop).toEqual({ x: 100, y: 50, width: 200, height: 100 });
    expect(after.version).toBe(before.version + 1);
    expectPictureStill(before, after);
  });

  it("stores no crop once the window covers the whole picture again", () => {
    const cropped = picture({ crop: { x: 10, y: 10, width: 100, height: 50 } });
    const whole = uncropped(cropped, frameOf(cropped)) as ImageElement;
    expect(whole.crop).toBeNull();
    expect(whole.width).toBeCloseTo(800);
    expect(whole.height).toBeCloseTo(400);
    expectPictureStill(cropped, whole);
  });

  it("keeps the picture still on a rotated image", () => {
    const before = picture({ angle: Math.PI / 3 });
    const frame = frameOf(before);
    const window = resizeWindow(frame, frame.window, "se", { x: -80, y: -30 });
    const after = showWindow(before, frame, window) as ImageElement;
    expect(after.width).toBeCloseTo(120);
    expect(after.height).toBeCloseTo(70);
    expect(after.crop?.width).toBeCloseTo(240);
    expectPictureStill(before, after);
    // The untouched (north-west) corner of the shown part does not move.
    expectClose(pixelOnBoard(after, 0, 0), pixelOnBoard(before, 0, 0));
  });

  it("keeps the picture still on flipped images", () => {
    for (const axis of ["horizontal", "vertical"] as const) {
      const cropped = showWindow(
        picture({ angle: 0.4 }),
        frameOf(picture({ angle: 0.4 })),
        {
          x: 20,
          y: 10,
          width: 120,
          height: 60,
        },
      );
      const [flipped] = flipElements([cropped], axis);
      if (!flipped) throw new Error("not flipped");
      const frame = frameOf(flipped);
      const moved = moveWindow(frame, frame.window, { x: 30, y: -5 });
      const after = showWindow(flipped as ImageElement, frame, moved);
      expectPictureStill(flipped, after);
      expect((after as ImageElement).crop?.width).toBeCloseTo(240);
    }
  });

  it("keeps the picture still on an image turned with others", () => {
    const [turned] = rotateElements([picture()], { x: 0, y: 0 }, -2.2);
    const frame = frameOf(turned as BoardElement);
    const window = resizeWindow(frame, frame.window, "n", { x: 0, y: 40 });
    const after = showWindow(turned as ImageElement, frame, window);
    expect(after.height).toBeCloseTo(60);
    expectPictureStill(turned as BoardElement, after);
  });
});

describe("resizeWindow", () => {
  const frame = frameOf(picture());
  const start = { x: 40, y: 20, width: 100, height: 50 };

  it("moves only the dragged sides", () => {
    expect(resizeWindow(frame, start, "e", { x: 30, y: 99 })).toEqual({
      x: 40,
      y: 20,
      width: 130,
      height: 50,
    });
    expect(resizeWindow(frame, start, "nw", { x: 10, y: 5 })).toEqual({
      x: 50,
      y: 25,
      width: 90,
      height: 45,
    });
  });

  it("stops at the picture's edges", () => {
    expect(resizeWindow(frame, start, "se", { x: 500, y: 500 })).toEqual({
      x: 40,
      y: 20,
      width: 160,
      height: 80,
    });
    expect(resizeWindow(frame, start, "w", { x: -500, y: 0 })).toMatchObject({
      x: 0,
      width: 140,
    });
  });

  it("never turns inside out", () => {
    const result = resizeWindow(
      frame,
      start,
      "e",
      { x: -400, y: 0 },
      {
        minSize: 10,
      },
    );
    expect(result).toEqual({ x: 40, y: 20, width: 10, height: 50 });
  });

  it("keeps the proportions with Shift, within the picture", () => {
    const corner = resizeWindow(
      frame,
      start,
      "se",
      { x: 20, y: 0 },
      {
        keepAspect: true,
      },
    );
    expect(corner.width / corner.height).toBeCloseTo(2);
    expect(corner).toMatchObject({ x: 40, y: 20, width: 120, height: 60 });
    // A side handle grows the other axis about its centre.
    const side = resizeWindow(
      frame,
      start,
      "e",
      { x: 40, y: 0 },
      {
        keepAspect: true,
      },
    );
    expect(side.width / side.height).toBeCloseTo(2);
    expect(side.y + side.height / 2).toBeCloseTo(45);
    // Capped where the picture ends, still in proportion.
    const capped = resizeWindow(
      frame,
      start,
      "se",
      { x: 900, y: 900 },
      {
        keepAspect: true,
      },
    );
    expect(capped.width / capped.height).toBeCloseTo(2);
    expect(capped.x + capped.width).toBeLessThanOrEqual(200 + 1e-9);
    expect(capped.y + capped.height).toBeLessThanOrEqual(100 + 1e-9);
  });

  it("grows from the centre with Alt", () => {
    const result = resizeWindow(
      frame,
      start,
      "e",
      { x: 10, y: 0 },
      {
        fromCenter: true,
      },
    );
    expect(result).toEqual({ x: 30, y: 20, width: 120, height: 50 });
  });
});

describe("moveWindow", () => {
  it("slides the window over the picture, never past its edges", () => {
    const frame = frameOf(picture());
    const start = { x: 40, y: 20, width: 100, height: 50 };
    expect(moveWindow(frame, start, { x: 10, y: -5 })).toEqual({
      x: 50,
      y: 15,
      width: 100,
      height: 50,
    });
    expect(moveWindow(frame, start, { x: 900, y: -900 })).toEqual({
      x: 100,
      y: 0,
      width: 100,
      height: 50,
    });
  });
});

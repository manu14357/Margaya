import { describe, expect, it } from "vitest";
import {
  addWhiteboardElementsBody,
  createWhiteboardBody,
  finalizeWhiteboardAssetBody,
  listWhiteboardsQuery,
  updateWhiteboardBody,
  whiteboardAssetUploadBody,
} from "../../../apps/api/src/whiteboard/schema";

describe("whiteboard request schemas", () => {
  it("creates with a project and optional title, icon and elements", () => {
    expect(createWhiteboardBody.safeParse({ projectId: "p1" }).success).toBe(
      true,
    );
    expect(
      createWhiteboardBody.safeParse({
        projectId: "p1",
        title: "Retro",
        icon: null,
        elements: [{ id: "a", type: "rectangle" }],
      }).success,
    ).toBe(true);
  });

  it("refuses unknown fields, long titles and no project", () => {
    expect(createWhiteboardBody.safeParse({}).success).toBe(false);
    expect(
      createWhiteboardBody.safeParse({ projectId: "p1", owner: "x" }).success,
    ).toBe(false);
    expect(
      createWhiteboardBody.safeParse({
        projectId: "p1",
        title: "x".repeat(256),
      }).success,
    ).toBe(false);
  });

  it("caps the elements of one request", () => {
    const many = Array.from({ length: 2001 }, (_, index) => ({
      id: `e${index}`,
    }));
    expect(
      addWhiteboardElementsBody.safeParse({ elements: many }).success,
    ).toBe(false);
    expect(addWhiteboardElementsBody.safeParse({ elements: [] }).success).toBe(
      false,
    );
    expect(
      addWhiteboardElementsBody.safeParse({ elements: ["not an object"] })
        .success,
    ).toBe(false);
  });

  it("updates only the title and icon", () => {
    expect(updateWhiteboardBody.safeParse({ title: "New" }).success).toBe(true);
    expect(updateWhiteboardBody.safeParse({ icon: "🎯" }).success).toBe(true);
    expect(
      updateWhiteboardBody.safeParse({ contentText: "sneaky" }).success,
    ).toBe(false);
  });

  it("lists by project with the archived flag as true or false", () => {
    expect(
      listWhiteboardsQuery.safeParse({ projectId: "p1", archived: "true" })
        .success,
    ).toBe(true);
    expect(
      listWhiteboardsQuery.safeParse({ projectId: "p1", archived: "yes" })
        .success,
    ).toBe(false);
    expect(listWhiteboardsQuery.safeParse({}).success).toBe(false);
  });

  it("accepts the four raster image types only, never SVG", () => {
    for (const contentType of [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
    ]) {
      expect(
        whiteboardAssetUploadBody.safeParse({
          filename: "a",
          contentType,
          size: 10,
        }).success,
      ).toBe(true);
    }
    expect(
      whiteboardAssetUploadBody.safeParse({
        filename: "a.svg",
        contentType: "image/svg+xml",
        size: 10,
      }).success,
    ).toBe(false);
    expect(
      finalizeWhiteboardAssetBody.safeParse({
        contentType: "text/html",
        size: 10,
      }).success,
    ).toBe(false);
    expect(
      finalizeWhiteboardAssetBody.safeParse({
        contentType: "image/png",
        size: 0,
      }).success,
    ).toBe(false);
  });
});

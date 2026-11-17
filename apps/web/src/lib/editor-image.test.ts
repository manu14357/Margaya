import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadImage, imageDownloadUrl } from "./editor-image";

afterEach(() => vi.restoreAllMocks());

function clicked() {
  const links: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    links.push(this);
  });
  return links;
}

describe("downloadImage", () => {
  it("downloads this server's image in place, as an attachment", () => {
    const links = clicked();
    downloadImage("http://localhost:1337/api/asset/img1", "Diagram");
    expect(links[0]?.href).toBe(
      "http://localhost:1337/api/asset/img1?download=1",
    );
    expect(links[0]?.download).toBe("Diagram");
    // No new window: the desktop app would open (and close) a bare one.
    expect(links[0]?.target).toBe("");
  });

  it("opens an image elsewhere in a new tab", () => {
    const links = clicked();
    downloadImage("https://images.example.com/cat.png", "Cat");
    expect(links[0]?.href).toBe("https://images.example.com/cat.png");
    expect(links[0]?.target).toBe("_blank");
    expect(links[0]?.rel).toBe("noopener noreferrer");
  });

  it("asks only assets for a download", () => {
    expect(imageDownloadUrl("https://images.example.com/cat.png")).toBe(
      "https://images.example.com/cat.png",
    );
  });
});

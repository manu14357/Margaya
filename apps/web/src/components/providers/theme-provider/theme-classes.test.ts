import { describe, expect, it } from "vitest";
import { themeClasses } from "./index";

describe("themeClasses", () => {
  it("keeps light and dark as they are", () => {
    expect(themeClasses("light", true)).toEqual({
      mode: "light",
      contrast: false,
    });
    expect(themeClasses("system", true)).toEqual({
      mode: "dark",
      contrast: false,
    });
  });

  it("adds contrast to the high-contrast themes", () => {
    expect(themeClasses("light-contrast", true)).toEqual({
      mode: "light",
      contrast: true,
    });
    expect(themeClasses("dark-contrast", false)).toEqual({
      mode: "dark",
      contrast: true,
    });
  });
});

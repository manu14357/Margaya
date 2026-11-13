import { afterEach, describe, expect, it } from "vitest";
import {
  feedbackPageType,
  isQuietMoment,
  isSurveyQuietPath,
  scaleOptions,
} from "./feedback";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("feedbackPageType", () => {
  it("names the kind of page, never ids", () => {
    const project = "/dashboard/workspace/w1/project/p1";
    expect(feedbackPageType(`${project}/board`)).toBe("board");
    expect(feedbackPageType(`${project}/backlog`)).toBe("list");
    expect(feedbackPageType(`${project}/gantt`)).toBe("timeline");
    expect(feedbackPageType(`${project}/task/t1`)).toBe("task");
    expect(feedbackPageType(`${project}/cycles/c1`)).toBe("cycles");
    expect(feedbackPageType(`${project}/unknown`)).toBe("other");
    expect(feedbackPageType("/dashboard/workspace/w1")).toBe("home");
    expect(feedbackPageType("/dashboard/workspace/w1/inbox")).toBe("inbox");
    expect(feedbackPageType("/dashboard/workspace/w1/my-work")).toBe("my-work");
    expect(feedbackPageType("/dashboard/settings/account/preferences")).toBe(
      "settings",
    );
    expect(feedbackPageType("/somewhere")).toBe("other");
  });
});

describe("scaleOptions", () => {
  it("covers each scale, lowest first", () => {
    expect(scaleOptions("faces3").map((option) => option.score)).toEqual([
      1, 2, 3,
    ]);
    expect(scaleOptions("faces5")).toHaveLength(5);
    expect(scaleOptions("stars").map((option) => option.score)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(scaleOptions("nps")[0]?.score).toBe(0);
    expect(scaleOptions("nps")).toHaveLength(11);
    expect(scaleOptions("thumbs").map((option) => option.score)).toEqual([
      0, 1,
    ]);
  });
});

describe("isQuietMoment", () => {
  it("is quiet with nothing focused or open", () => {
    expect(isQuietMoment()).toBe(true);
  });

  it("is not quiet while someone types", () => {
    const input = document.createElement("textarea");
    document.body.append(input);
    input.focus();
    expect(isQuietMoment()).toBe(false);
  });

  it("is not quiet while a dialog or menu is open", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    expect(isQuietMoment()).toBe(false);
  });
});

describe("isSurveyQuietPath", () => {
  it("keeps the survey out of onboarding and invitations", () => {
    expect(isSurveyQuietPath("/onboarding")).toBe(true);
    expect(isSurveyQuietPath("/dashboard/invitations")).toBe(true);
    expect(isSurveyQuietPath("/dashboard/workspace/w1")).toBe(false);
  });
});

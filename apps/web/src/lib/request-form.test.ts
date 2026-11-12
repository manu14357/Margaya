import { describe, expect, it } from "vitest";
import { missingRequestFields } from "./request-form";

const form = {
  fields: {
    description: "required" as const,
    email: "optional" as const,
    name: "off" as const,
  },
  customFields: [{ id: "f1", required: true }],
};

const filled = {
  title: "Broken link",
  description: "On the pricing page",
  email: "",
  name: "",
  custom: { f1: "Web" },
};

describe("missingRequestFields", () => {
  it("passes a complete form", () => {
    expect(missingRequestFields(form, filled)).toEqual([]);
  });

  it("lists empty required fields and a bad email", () => {
    expect(
      missingRequestFields(form, {
        ...filled,
        title: " ",
        description: "",
        email: "not-an-email",
        custom: {},
      }),
    ).toEqual(["title", "description", "email", "f1"]);
  });

  it("ignores fields that are off", () => {
    expect(
      missingRequestFields(
        { ...form, fields: { ...form.fields, email: "off" } },
        { ...filled, email: "garbage" },
      ),
    ).toEqual([]);
  });
});

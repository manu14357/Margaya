import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { createTaskCurl } from "./api-card";

const copy = messages.landing.demo.api;

describe("api snippet", () => {
  const code = createTaskCurl(copy);

  it("posts to the create-task route with a Bearer API key", () => {
    expect(code).toContain(`curl -X POST ${copy.host}/api/task/$PROJECT_ID`);
    expect(code).toContain('-H "Authorization: Bearer $MARGAYA_API_KEY"');
    expect(code).toContain('-H "Content-Type: application/json"');
  });

  it("sends a JSON body with the schema's required fields", () => {
    const body = code.slice(code.indexOf("'") + 1, code.lastIndexOf("'"));
    expect(JSON.parse(body)).toEqual({
      title: copy.taskTitle,
      description: "",
      priority: "high",
      status: "to-do",
    });
  });

  it("keeps an apostrophe in a translated title shell-safe", () => {
    const quoted = createTaskCurl({ ...copy, taskTitle: "Ship it's page" });
    expect(quoted).toContain("it'\\''s");
  });
});

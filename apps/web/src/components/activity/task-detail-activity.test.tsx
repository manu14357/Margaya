import enUS from "@i18n/en-US.json";
import { cleanup, render } from "@testing-library/react";
import i18next from "i18next";
import type { ReactNode } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  getTaskDetailActivityIcon,
  renderTaskDetailActivity,
} from "./task-detail-activity";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    className,
  }: {
    children?: ReactNode;
    params: { workspaceId: string; projectId: string; taskId: string };
    className?: string;
  }) => (
    <a
      href={`/ws/${params.workspaceId}/p/${params.projectId}/t/${params.taskId}`}
      className={className}
    >
      {children}
    </a>
  ),
}));

const i18n = i18next.createInstance();
const t = (key: string, options?: Record<string, unknown>): string =>
  String(i18n.t(key, options as never));

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: "en-US",
    resources: { "en-US": enUS },
    defaultNS: "common",
    interpolation: { escapeValue: false },
  });
});

afterEach(() => cleanup());

function line(type: string, eventData: Record<string, unknown> = {}) {
  const node = renderTaskDetailActivity({ type, eventData }, t, {
    workspaceId: "ws-1",
  });
  const { container } = render(
    <I18nextProvider i18n={i18n}>{node}</I18nextProvider>,
  );
  return container;
}

const other = {
  otherTaskId: "t3",
  otherTaskKey: "WEB-3",
  otherTaskTitle: "Login",
  otherProjectId: "p-web",
};

describe("renderTaskDetailActivity", () => {
  it("describes start date changes", () => {
    const noon = "2026-09-30T12:00:00.000Z";
    expect(
      line("start_date_changed", { oldStartDate: null, newStartDate: noon })
        .textContent,
    ).toMatch(/^set the start date to Sep 30, 2026$/);
    expect(
      line("start_date_changed", {
        oldStartDate: "2026-09-01T12:00:00.000Z",
        newStartDate: noon,
      }).textContent,
    ).toBe("changed the start date from Sep 1, 2026 to Sep 30, 2026");
    expect(
      line("start_date_changed", { oldStartDate: noon, newStartDate: null })
        .textContent,
    ).toBe("cleared the start date");
  });

  it("names labels with their color", () => {
    const added = line("label_added", { name: "Bug", color: "red" });
    expect(added.textContent).toBe("added the label Bug");
    expect(added.querySelector("span[style]")).not.toBeNull();
    expect(line("label_removed", { name: "Bug" }).textContent).toBe(
      "removed the label Bug",
    );
  });

  it("describes description edits without the text", () => {
    expect(line("description_changed").textContent).toBe(
      "updated the description",
    );
  });

  it.each([
    ["related", "marked this task as related to WEB-3 Login"],
    ["blocking", "marked this task as blocking WEB-3 Login"],
    ["blocked_by", "marked this task as blocked by WEB-3 Login"],
    ["duplicate", "marked this task as a duplicate of WEB-3 Login"],
    ["start_before", "set this task to start before WEB-3 Login"],
    ["start_after", "set this task to start after WEB-3 Login"],
    ["finish_before", "set this task to finish before WEB-3 Login"],
    ["finish_after", "set this task to finish after WEB-3 Login"],
  ])("reads an added %s relation from this task's side", (relation, text) => {
    const container = line("relation_added", { relation, ...other });
    expect(container.textContent).toBe(text);
    expect(container.querySelector("a")).toHaveAttribute(
      "href",
      "/ws/ws-1/p/p-web/t/t3",
    );
  });

  it("names the removed relation in lower case", () => {
    expect(
      line("relation_removed", { relation: "blocked_by", ...other })
        .textContent,
    ).toBe("removed the blocked by relation with WEB-3 Login");
  });

  it("describes parent changes", () => {
    const parent = { id: "t2", key: "WEB-2", title: "Epic", projectId: "p" };
    const next = { id: "t5", key: "WEB-5", title: "Auth", projectId: "p" };
    expect(
      line("parent_changed", { oldParent: null, newParent: parent })
        .textContent,
    ).toBe("set the parent to WEB-2 Epic");
    const changed = line("parent_changed", {
      oldParent: parent,
      newParent: next,
    });
    expect(changed.textContent).toBe(
      "changed the parent from WEB-2 Epic to WEB-5 Auth",
    );
    expect(changed.querySelectorAll("a")).toHaveLength(2);
    expect(
      line("parent_changed", { oldParent: parent, newParent: null })
        .textContent,
    ).toBe("removed the parent WEB-2 Epic");
  });

  it("describes sub-tasks, links, attachments and copies", () => {
    expect(line("subtask_added", other).textContent).toBe(
      "added the sub-task WEB-3 Login",
    );
    expect(line("subtask_removed", other).textContent).toBe(
      "removed the sub-task WEB-3 Login",
    );
    expect(
      line("link_added", { title: "Spec", host: "example.com" }).textContent,
    ).toBe("added the link Spec");
    expect(
      line("link_updated", { title: null, host: "example.com" }).textContent,
    ).toBe("updated the link example.com");
    expect(
      line("link_removed", { title: null, host: "docs.example.com" })
        .textContent,
    ).toBe("removed the link docs.example.com");
    expect(line("attachment_added", { filename: "spec.pdf" }).textContent).toBe(
      "attached spec.pdf",
    );
    expect(
      line("attachment_removed", { filename: "spec.pdf" }).textContent,
    ).toBe("removed the attachment spec.pdf");
    expect(
      line("copied_from", {
        sourceTaskId: "t1",
        sourceTaskKey: "WEB-1",
        sourceTaskTitle: "Original",
        sourceProjectId: "p-web",
      }).textContent,
    ).toBe("created this task as a copy of WEB-1 Original");
    expect(
      line("copied_to", {
        copyTaskId: "t9",
        copyTaskKey: "OPS-9",
        copyTaskTitle: "Original (copy)",
        copyProjectId: "p-ops",
      }).textContent,
    ).toBe("made a copy of this task: OPS-9 Original (copy)");
  });

  it("shortens long titles and keeps markup-like titles as text", () => {
    const long = line("subtask_added", {
      ...other,
      otherTaskTitle: "x".repeat(80),
    });
    expect(long.textContent).toBe(
      `added the sub-task WEB-3 ${"x".repeat(59)}…`,
    );

    const tricky = line("subtask_added", {
      ...other,
      otherTaskTitle: "<task>evil</task> <b>bold</b>",
    });
    expect(tricky.textContent).toBe(
      "added the sub-task WEB-3 <task>evil</task> <b>bold</b>",
    );
    expect(tricky.querySelector("b")).toBeNull();
  });

  it("leaves other activity types to the caller", () => {
    expect(renderTaskDetailActivity({ type: "status_changed" }, t)).toBeNull();
    expect(getTaskDetailActivityIcon("status_changed")).toBeNull();
    expect(getTaskDetailActivityIcon("copied_to")).not.toBeNull();
  });
});

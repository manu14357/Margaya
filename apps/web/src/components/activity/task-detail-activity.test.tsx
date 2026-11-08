import deDE from "@i18n/de-DE.json";
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
const german = i18next.createInstance();

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: "en-US",
    resources: { "en-US": enUS },
    defaultNS: "common",
    interpolation: { escapeValue: false },
  });
  await german.use(initReactI18next).init({
    lng: "de-DE",
    resources: { "de-DE": deDE },
    defaultNS: "common",
    interpolation: { escapeValue: false },
  });
});

afterEach(() => cleanup());

function lineIn(
  instance: typeof i18n,
  type: string,
  eventData: Record<string, unknown> = {},
) {
  const translate = (key: string, options?: Record<string, unknown>) =>
    String(instance.t(key, options as never));
  const node = renderTaskDetailActivity({ type, eventData }, translate, {
    workspaceId: "ws-1",
  });
  const { container } = render(
    <I18nextProvider i18n={instance}>{node}</I18nextProvider>,
  );
  return container;
}

function line(type: string, eventData: Record<string, unknown> = {}) {
  return lineIn(i18n, type, eventData);
}

const t = (key: string, options?: Record<string, unknown>): string =>
  String(i18n.t(key, options as never));

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

  it("says a task in another project when the API won't name it, with no link", () => {
    const hidden = {
      otherTaskId: null,
      otherTaskKey: null,
      otherTaskTitle: null,
      otherProjectId: null,
      otherTaskHidden: true,
    };
    const added = line("relation_added", {
      relation: "blocked_by",
      ...hidden,
    });
    expect(added.textContent).toBe(
      "marked this task as blocked by a task in another project",
    );
    expect(added.querySelector("a")).toBeNull();
    expect(
      line("relation_removed", { relation: "blocked_by", ...hidden })
        .textContent,
    ).toBe("removed the blocked by relation with a task in another project");
    expect(line("subtask_added", hidden).textContent).toBe(
      "added a sub-task in another project",
    );
    expect(line("subtask_removed", hidden).textContent).toBe(
      "removed a sub-task in another project",
    );
    const copiedFrom = line("copied_from", {
      sourceTaskHidden: true,
      included: [],
    });
    expect(copiedFrom.textContent).toBe(
      "created this task as a copy of a task in another project",
    );
    expect(copiedFrom.querySelector("a")).toBeNull();
    expect(line("copied_to", { copyTaskHidden: true }).textContent).toBe(
      "made a copy of this task in another project",
    );
    expect(
      line("recurred_from", { sourceTaskHidden: true, reason: "completion" })
        .textContent,
    ).toBe("created this task as the next repeat of a task in another project");
    expect(
      line("recurred_from", { sourceTaskHidden: true, reason: "schedule" })
        .textContent,
    ).toBe(
      "Created on schedule as the next repeat of a task in another project",
    );
    expect(
      line("recurred_to", { nextTaskHidden: true, reason: "completion" })
        .textContent,
    ).toBe(
      "completed this task, which created the next repeat in another project",
    );
    expect(
      line("recurred_to", { nextTaskHidden: true, reason: "schedule" })
        .textContent,
    ).toBe("The next repeat was created on schedule in another project");
  });

  it("keeps the visible parent when only the other one is hidden", () => {
    const hidden = {
      id: null,
      key: null,
      title: null,
      projectId: null,
      hidden: true,
    };
    const next = { id: "t5", key: "WEB-5", title: "Auth", projectId: "p" };
    const changed = line("parent_changed", {
      oldParent: hidden,
      newParent: next,
    });
    expect(changed.textContent).toBe(
      "changed the parent from a task in another project to WEB-5 Auth",
    );
    expect(changed.querySelectorAll("a")).toHaveLength(1);
    const toHidden = line("parent_changed", {
      oldParent: next,
      newParent: hidden,
    });
    expect(toHidden.textContent).toBe(
      "changed the parent from WEB-5 Auth to a task in another project",
    );
    expect(toHidden.querySelectorAll("a")).toHaveLength(1);
    expect(
      line("parent_changed", { oldParent: hidden, newParent: hidden })
        .textContent,
    ).toBe("changed the parent between tasks in other projects");
    expect(
      line("parent_changed", { oldParent: null, newParent: hidden })
        .textContent,
    ).toBe("set the parent to a task in another project");
    expect(
      line("parent_changed", { oldParent: hidden, newParent: null })
        .textContent,
    ).toBe("removed a parent task in another project");
  });

  it("writes each hidden-task line as its own sentence, so languages can decline it", () => {
    const hiddenOther = {
      otherTaskId: null,
      otherTaskKey: null,
      otherTaskTitle: null,
      otherProjectId: null,
      otherTaskHidden: true,
    };
    const hiddenParent = {
      id: null,
      key: null,
      title: null,
      projectId: null,
      hidden: true,
    };
    const next = { id: "t5", key: "WEB-5", title: "Auth", projectId: "p" };
    // German needs the accusative after "durch" and "auf" but the dative after
    // "von": one fixed phrase reads wrong in at least one of these.
    expect(
      lineIn(german, "relation_added", {
        relation: "blocked_by",
        ...hiddenOther,
      }).textContent,
    ).toBe(
      "hat diese Aufgabe als blockiert durch eine Aufgabe in einem anderen Projekt markiert",
    );
    expect(
      lineIn(german, "parent_changed", {
        oldParent: null,
        newParent: hiddenParent,
      }).textContent,
    ).toBe(
      "hat die übergeordnete Aufgabe auf eine Aufgabe in einem anderen Projekt gesetzt",
    );
    expect(
      lineIn(german, "parent_changed", {
        oldParent: next,
        newParent: hiddenParent,
      }).textContent,
    ).toBe(
      "hat die übergeordnete Aufgabe von WEB-5 Auth zu einer Aufgabe in einem anderen Projekt geändert",
    );
    expect(
      lineIn(german, "copied_from", { sourceTaskHidden: true }).textContent,
    ).toBe(
      "hat diese Aufgabe als Kopie einer Aufgabe in einem anderen Projekt erstellt",
    );
    expect(enUS.activity).not.toHaveProperty("hiddenTask");
  });

  it("leaves other activity types to the caller", () => {
    expect(renderTaskDetailActivity({ type: "status_changed" }, t)).toBeNull();
    expect(getTaskDetailActivityIcon("status_changed")).toBeNull();
    expect(getTaskDetailActivityIcon("copied_to")).not.toBeNull();
  });
});

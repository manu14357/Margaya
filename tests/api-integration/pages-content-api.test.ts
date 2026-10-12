import { beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabase } from "./helpers/database";
import {
  clearPageEvents,
  json,
  pageEvents,
  pageRow,
  pageScene,
  recordPageEvents,
} from "./helpers/pages";

/** A table big enough that its Yjs state passes 5 MiB (~120 KB of markdown). */
function hugeTable() {
  const cols = 50;
  const row = `|${"a|".repeat(cols)}\n`;
  return `${row}|${"-|".repeat(cols)}\n${row.repeat(1100)}`;
}

describe("API integration: page content over REST", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    recordPageEvents("page.content_updated");
    clearPageEvents();
  });

  it("round trips every custom tag without loss", async () => {
    const s = await pageScene();
    const target = await s.create(s.ben, { title: "Target" });
    const markdown = [
      `Hi <margaya-mention id="${s.cara.id}" label="Cara"></margaya-mention>, see <margaya-page-link id="${target.id}" title="Target &amp; more"></margaya-page-link>.`,
      '\n<margaya-issue-link url="https://margaya.test/t/1?a=1&amp;b=2" issue-key="WEB-1" task-id="task-1" />\n',
      '\n<margaya-attachment url="https://margaya.test/api/asset/a1" filename="q &quot;3&quot;.pdf" mime-type="application/pdf" size="2048" />\n',
      '\n<margaya-embed url="https://www.youtube.com/watch?v=abc" mode="embed" />\n',
    ].join("\n\n");
    const page = await s.create(s.ben);

    const replaced = await s.ok(
      s.ben,
      `/${page.id}/content`,
      json("PUT", { markdown }),
    );
    expect(replaced.contentMarkdown).toBe(markdown);
    expect(replaced.contentVersion).toBe(2);
    expect(replaced.updatedById).toBe(s.ben.id);

    const again = await s.ok(
      s.ben,
      `/${page.id}/content`,
      json("PUT", {
        markdown: replaced.contentMarkdown,
      }),
    );
    expect(again.contentMarkdown).toBe(markdown);

    const row = await pageRow(page.id);
    expect(row?.contentText).toBe("Hi @Cara, see Target & more.\nWEB-1");
    const events = pageEvents("page.content_updated");
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({
      pageId: page.id,
      userId: s.ben.id,
      contentVersion: 2,
      contributorIds: [s.ben.id],
      newlyMentionedUserIds: [s.cara.id],
    });
  });

  it("round trips callouts and sized, aligned images", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    const markdown = [
      "> [!WARNING]\n> Mind the **gap**.\n>\n> - one\n> - two",
      '<img src="https://margaya.test/api/asset/a1" alt="Plan" width="50%" data-align="center" />',
      "![Plain](https://margaya.test/api/asset/a2)",
      "> just a quote",
    ].join("\n\n");

    const replaced = await s.ok(
      s.ben,
      `/${page.id}/content`,
      json("PUT", { markdown }),
    );
    expect(replaced.contentMarkdown).toBe(markdown);

    const row = await pageRow(page.id);
    expect(row?.contentText).toBe("Mind the gap.\none\ntwo\njust a quote");
  });

  it("answers 413 for markdown over 1 MiB", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben);
    const response = await s.call(
      s.ben,
      `/${page.id}/content`,
      json("PUT", { markdown: "a".repeat(1024 * 1024 + 1) }),
    );
    expect([400, 413]).toContain(response.status);

    const huge = await s.call(
      s.ben,
      `/${page.id}/content`,
      json("PUT", { markdown: "a".repeat(2 * 1024 * 1024) }),
    );
    expect(huge.status).toBe(413);
  });

  it("answers 413 and writes nothing when the document passes 5 MiB", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben, { content: "Keep me" });
    const before = await pageRow(page.id);

    const response = await s.call(
      s.ben,
      `/${page.id}/content`,
      json("PUT", { markdown: hugeTable() }),
    );
    expect(response.status).toBe(413);
    expect(await response.text()).toBe("This page is too large");

    const after = await pageRow(page.id);
    expect(after?.contentVersion).toBe(before?.contentVersion);
    expect(after?.contentMarkdown).toBe("Keep me");
    expect(pageEvents("page.content_updated")).toHaveLength(0);

    const created = await s.call(
      s.ben,
      `/project/${s.project.id}`,
      json("POST", { content: hugeTable() }),
    );
    expect(created.status).toBe(413);
  });

  it("replaces content as a structural diff of the stored document", async () => {
    const s = await pageScene();
    const page = await s.create(s.ben, { content: "First\n\nSecond" });
    const first = await pageRow(page.id);
    const replaced = await s.ok(
      s.ben,
      `/${page.id}/content`,
      json("PUT", {
        markdown: "First\n\nSecond, edited",
      }),
    );
    expect(replaced.contentMarkdown).toBe("First\n\nSecond, edited");
    const second = await pageRow(page.id);
    // The new state builds on the old one rather than replacing it.
    expect(second?.contentYjs?.byteLength).toBeGreaterThan(
      first?.contentYjs?.byteLength ?? 0,
    );
  });
});

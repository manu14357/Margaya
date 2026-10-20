import { and, eq, isNull } from "drizzle-orm";
import db from "../database";
import { taskLinkTable } from "../database/schema";
import { fetchPageTitle } from "../utils/fetch-page-title";
import { MAX_LINK_TITLE_LENGTH } from "../utils/link-url";
import { publishLinkEvent } from "./write";

/**
 * Link title auto-fill (on by default). `MARGAYA_LINK_TITLE_FETCH=false`
 * turns it off, for air-gapped installs or a policy against outbound
 * requests. Tests swap `fetchTitle` and set `enabled`.
 */
export const linkTitleAutofill = {
  enabled:
    !["false", "0", "off"].includes(
      (process.env.MARGAYA_LINK_TITLE_FETCH ?? "").toLowerCase(),
    ) && process.env.NODE_ENV !== "test",
  fetchTitle: fetchPageTitle,
};

function fitTitle(title: string): string {
  return title.length > MAX_LINK_TITLE_LENGTH
    ? `${title.slice(0, MAX_LINK_TITLE_LENGTH - 1).trimEnd()}…`
    : title;
}

/**
 * Fetches the page title of a link added without one and stores it, unless
 * someone titled or changed the link meanwhile. Never throws: a page that
 * can't be read simply keeps showing its URL.
 */
export async function fillLinkTitle(input: {
  linkId: string;
  url: string;
  taskId: string;
  projectId: string;
  userId: string;
}) {
  try {
    const fetched = await linkTitleAutofill.fetchTitle(input.url);
    if (!fetched) return;
    const title = fitTitle(fetched);
    const [updated] = await db
      .update(taskLinkTable)
      .set({ title })
      .where(
        and(
          eq(taskLinkTable.id, input.linkId),
          eq(taskLinkTable.url, input.url),
          isNull(taskLinkTable.title),
        ),
      )
      .returning({
        id: taskLinkTable.id,
        url: taskLinkTable.url,
        title: taskLinkTable.title,
      });
    if (!updated) return;
    await publishLinkEvent("task.link_updated", {
      link: updated,
      previous: { id: updated.id, url: updated.url, title: null },
      taskId: input.taskId,
      projectId: input.projectId,
      userId: input.userId,
    });
  } catch {
    // Refused, unreachable or slow pages keep their URL as the label.
  }
}

/** Starts the fill without holding up the request that added the link. */
export function scheduleLinkTitle(input: Parameters<typeof fillLinkTitle>[0]) {
  if (!linkTitleAutofill.enabled) return null;
  return fillLinkTitle(input);
}

import { Link } from "@tanstack/react-router";
import { mergeAttributes, Node } from "@tiptap/core";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { escapeHtml } from "@/components/task/extensions/url-safety";
import { useGetPage } from "@/hooks/queries/page/use-get-page";
import { useGetPages } from "@/hooks/queries/page/use-get-pages";
import PageLogo from "../../page-logo";

export type PageLinkOptions = {
  /** The workspace and project of the page being edited. */
  workspaceId: string;
  projectId: string;
};

/**
 * A page link chip: the linked page's logo and live title, from the
 * project's page list when the page is there, else from the page itself.
 * A page the viewer can't see (or a deleted one) shows as unavailable.
 */
function PageLinkView({ node, extension }: NodeViewProps) {
  const { t } = useTranslation();
  const options = extension.options as PageLinkOptions;
  const pageId = String(node.attrs.pageId || "");
  const { data: pages, isLoading: isListLoading } = useGetPages(
    options.projectId,
  );
  const listed = pages?.find((page) => page.id === pageId);
  const { data: fetched, isError } = useGetPage(pageId, {
    enabled: Boolean(pageId) && !listed && !isListLoading,
  });
  const page = listed ?? fetched;
  const unavailable = !pageId || (!page && isError);

  if (unavailable || !page?.projectId) {
    return (
      <NodeViewWrapper as="span" className="margaya-page-link-node">
        <span
          className="margaya-page-link-chip is-unavailable"
          aria-disabled="true"
        >
          {unavailable
            ? t("pages:editor.pageLink.unavailable")
            : String(node.attrs.title || "") || t("pages:list.untitled")}
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="span" className="margaya-page-link-node">
      <Link
        to="/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId"
        params={{
          workspaceId: options.workspaceId,
          projectId: page.projectId,
          pageId: page.id,
        }}
        className="margaya-page-link-chip"
        draggable={false}
      >
        <PageLogo
          logoKind={page.logoKind}
          logoValue={page.logoValue}
          className="size-3.5"
        />
        <span className="truncate">
          {page.title.trim() || t("pages:list.untitled")}
        </span>
      </Link>
    </NodeViewWrapper>
  );
}

// Must match the headless node in @margaya/editor-schema: name, group, flags,
// attribute names and defaults, and byte-identical markdown.
export const MargayaPageLink = Node.create<PageLinkOptions>({
  name: "margayaPageLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { workspaceId: "", projectId: "" };
  },

  addAttributes() {
    return {
      pageId: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("id") ||
          element.getAttribute("data-page-id") ||
          "",
        renderHTML: (attributes) => ({ "data-page-id": attributes.pageId }),
      },
      title: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("title") ||
          element.getAttribute("data-title") ||
          "",
        renderHTML: (attributes) => ({ "data-title": attributes.title }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: "margaya-page-link[id]" },
      { tag: "span[data-type='margaya-page-link']" },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-type": "margaya-page-link" }),
      node.attrs.title || "",
    ];
  },

  renderText({ node }) {
    return node.attrs.title || "";
  },

  addNodeView() {
    // The chip's own link navigates in the app. Without this, the editor's
    // link plugin would also open every clicked anchor in a new window.
    return ReactNodeViewRenderer(PageLinkView, {
      stopEvent: ({ event }) =>
        event.type === "mousedown" || event.type === "click",
    });
  },

  renderMarkdown(node: { attrs?: { pageId?: string; title?: string } }) {
    const pageId = String(node.attrs?.pageId || "");
    const title = String(node.attrs?.title || "");
    return `<margaya-page-link id="${escapeHtml(pageId)}" title="${escapeHtml(title)}"></margaya-page-link>`;
  },
});

import { renderDocMarkdown } from "./markdown";
import { findOperation, operationHeadings, schemaFields } from "./openapi";
import { getAllDocPages, getDocPageBody } from "./source";

export type DocsSearchSection = { id: string; text: string };

export type DocsSearchEntry = {
  href: string;
  title: string;
  description: string;
  /** `Tab › Group`. */
  section: string;
  method: string | null;
  path: string | null;
  /** h2/h3 headings with the ids the rendered page uses, for deep links. */
  sections: DocsSearchSection[];
  /** Extra matching terms: an operation's id and parameter names. */
  keywords: string;
};

const DESCRIPTION_LIMIT = 160;

function trim(text: string): string {
  return text.length > DESCRIPTION_LIMIT
    ? `${text.slice(0, DESCRIPTION_LIMIT - 1).trimEnd()}…`
    : text;
}

/** One entry per published page, served as /docs/search-index.json. */
export function buildDocsSearchIndex(): DocsSearchEntry[] {
  return getAllDocPages().map((page) => {
    const operation = page.openapi
      ? findOperation(page.openapi.method, page.openapi.path)
      : null;
    const reserved = operation ? operationHeadings(operation) : [];
    // The same render as the page (minus highlighting), so every id matches.
    const body = renderDocMarkdown(getDocPageBody(page), {
      reservedIds: reserved.map((heading) => heading.id),
      source: page.id,
      highlight: false,
    });
    const keywords = operation
      ? [
          operation.operationId,
          ...operation.parameters.map((parameter) => parameter.name),
          ...(operation.requestBody?.schema
            ? (schemaFields(operation.requestBody.schema) ?? []).map(
                (field) => field.name,
              )
            : []),
        ].join(" ")
      : "";
    return {
      href: page.href,
      title: operation?.summary || page.title,
      description: trim(page.description),
      section: [page.tab, page.group].filter(Boolean).join(" › "),
      method: operation?.method ?? null,
      path: operation?.path ?? null,
      sections: [...body.headings, ...reserved].map(({ id, text }) => ({
        id,
        text,
      })),
      keywords,
    };
  });
}

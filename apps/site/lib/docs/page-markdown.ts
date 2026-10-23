import { curlSample } from "./api-samples";
import {
  findOperation,
  type Operation,
  PARAMETER_LOCATIONS,
  schemaFields,
  schemaTypeLabel,
} from "./openapi";
import { docsShotUrl, readDocsShotManifest } from "./screenshots";
import { type DocPage, getDocPageBody } from "./source";

// Plain Markdown copies of the docs pages, served as /docs/md/<id>.md for
// "Copy page" and for tools that read docs as text (see /docs/llms.txt).

export function docMarkdownHref(page: Pick<DocPage, "id">): string {
  return `/docs/md/${page.id}.md`;
}

function operationMarkdown(operation: Operation): string {
  const lines: string[] = [`\`${operation.method} ${operation.path}\``, ""];
  if (operation.description) lines.push(operation.description, "");
  if (operation.authenticated) {
    lines.push(
      "Requires an API key or session token, sent as `Authorization: Bearer <token>`.",
      "",
    );
  }
  for (const [location, title] of Object.entries(PARAMETER_LOCATIONS)) {
    const parameters = operation.parameters.filter(
      (parameter) => parameter.in === location,
    );
    if (parameters.length === 0) continue;
    lines.push(`## ${title}`, "");
    for (const parameter of parameters) {
      lines.push(
        `- \`${parameter.name}\` (${schemaTypeLabel(parameter.schema)}, ${parameter.required ? "required" : "optional"})${parameter.description ? `: ${parameter.description}` : ""}`,
      );
    }
    lines.push("");
  }
  if (operation.requestBody) {
    lines.push(
      "## Request body",
      "",
      `\`${operation.requestBody.contentType}\``,
      "",
    );
    const fields = operation.requestBody.schema
      ? (schemaFields(operation.requestBody.schema) ?? [])
      : [];
    for (const field of fields) {
      const description = field.schema.description;
      lines.push(
        `- \`${field.name}\` (${schemaTypeLabel(field.schema)}, ${field.required ? "required" : "optional"})${description ? `: ${description}` : ""}`,
      );
    }
    if (fields.length > 0) lines.push("");
  }
  lines.push("## Responses", "");
  for (const response of operation.responses) {
    lines.push(`- \`${response.status}\`: ${response.description}`);
  }
  lines.push(
    "",
    "## Example request",
    "",
    "```bash",
    curlSample(operation),
    "```",
  );
  return lines.join("\n");
}

function attribute(tag: string, name: string): string {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? "";
}

/** `<Screenshot />` becomes a plain Markdown image. */
function screenshotsAsImages(body: string): string {
  const shots = readDocsShotManifest();
  return body.replace(/<Screenshot\s[^>]*\/>/g, (tag) => {
    const name = attribute(tag, "src");
    const shot = shots[name];
    if (!shot) return "";
    const caption = attribute(tag, "caption");
    const image = `![${attribute(tag, "alt")}](${docsShotUrl(name, shot)})`;
    return caption ? `${image}\n\n_${caption}_` : image;
  });
}

/** The page as Markdown: its title, description and MDX body. */
export function docPageMarkdown(page: DocPage): string {
  const operation = page.openapi
    ? findOperation(page.openapi.method, page.openapi.path)
    : null;
  const title = operation?.summary || page.title;
  const parts = [`# ${title}`];
  if (page.description) parts.push(`> ${page.description}`);
  const body = screenshotsAsImages(getDocPageBody(page)).trim();
  if (body) parts.push(body);
  if (operation) parts.push(operationMarkdown(operation));
  return `${parts.join("\n\n")}\n`;
}

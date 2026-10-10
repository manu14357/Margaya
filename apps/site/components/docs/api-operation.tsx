import type { DocHeading } from "@/lib/docs/markdown";
import {
  exampleValue,
  type Operation,
  openApiServerUrl,
} from "@/lib/docs/openapi";
import { FieldList, SchemaBody } from "./schema-fields";

const LOCATION_TITLES: Record<string, string> = {
  path: "Path parameters",
  query: "Query parameters",
  header: "Headers",
  cookie: "Cookies",
};

export function MethodBadge({
  method,
  small = false,
}: {
  method: string;
  small?: boolean;
}) {
  return (
    <span
      className={`docs-method docs-method-${method.toLowerCase()}${small ? " docs-method-small" : ""}`}
    >
      {method}
    </span>
  );
}

/** Section ids the operation renders, in order, for the page outline. */
export function operationHeadings(operation: Operation): DocHeading[] {
  const headings: DocHeading[] = [];
  if (operation.authenticated) {
    headings.push({ id: "authorization", text: "Authorization", depth: 2 });
  }
  for (const location of Object.keys(LOCATION_TITLES)) {
    if (operation.parameters.some((parameter) => parameter.in === location)) {
      headings.push({
        id: `${location}-parameters`,
        text: LOCATION_TITLES[location] ?? location,
        depth: 2,
      });
    }
  }
  if (operation.requestBody) {
    headings.push({ id: "request-body", text: "Request body", depth: 2 });
  }
  headings.push({ id: "responses", text: "Responses", depth: 2 });
  headings.push({ id: "example-request", text: "Example request", depth: 2 });
  if (successSchema(operation)) {
    headings.push({
      id: "example-response",
      text: "Example response",
      depth: 2,
    });
  }
  return headings;
}

function successSchema(operation: Operation) {
  const success = operation.responses.find(
    (response) => response.status.startsWith("2") && response.schema,
  );
  return success?.contentType?.includes("json") ? success : null;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function curlExample(operation: Operation): string {
  const query = operation.parameters
    .filter((parameter) => parameter.in === "query" && parameter.required)
    .map((parameter) => `${parameter.name}=<${parameter.name}>`)
    .join("&");
  const url = `${openApiServerUrl()}${operation.path}${query ? `?${query}` : ""}`;
  const lines = [
    `curl --request ${operation.method}`,
    `  --url ${shellQuote(url)}`,
  ];
  if (operation.authenticated) {
    lines.push(`  --header 'Authorization: Bearer <api-key>'`);
  }
  const body = operation.requestBody;
  if (body?.schema && body.contentType.includes("json")) {
    lines.push(`  --header 'Content-Type: ${body.contentType}'`);
    const example = JSON.stringify(
      exampleValue(body.schema, { requiredOnly: true }),
      null,
      2,
    );
    lines.push(`  --data ${shellQuote(example)}`);
  } else if (body) {
    lines.push(`  --header 'Content-Type: ${body.contentType}'`);
    lines.push("  --data-binary @file");
  }
  return lines.join(" \\\n");
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="docs-code">
      <div className="docs-code-header">
        <span>{label}</span>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** The request line of an operation, shown under the page title. */
export function OperationEndpoint({ operation }: { operation: Operation }) {
  return (
    <div className="docs-endpoint">
      <MethodBadge method={operation.method} />
      <code className="docs-endpoint-path">{operation.path}</code>
      {operation.deprecated ? (
        <span className="docs-field-meta">deprecated</span>
      ) : null}
    </div>
  );
}

/** Parameters, body, responses and examples of an operation. */
export function OperationReference({ operation }: { operation: Operation }) {
  const success = successSchema(operation);
  return (
    <div className="docs-operation">
      {operation.authenticated ? (
        <section aria-labelledby="authorization">
          <h2 id="authorization">Authorization</h2>
          <FieldList
            fields={[
              {
                name: "Authorization",
                location: "header",
                required: true,
                schema: { type: "string" },
                description:
                  "An API key or session token, sent as `Bearer <token>`. See [Authentication](/docs/api-reference/authentication).",
              },
            ]}
          />
        </section>
      ) : null}

      {Object.entries(LOCATION_TITLES).map(([location, title]) => {
        const parameters = operation.parameters.filter(
          (parameter) => parameter.in === location,
        );
        if (parameters.length === 0) return null;
        return (
          <section key={location} aria-labelledby={`${location}-parameters`}>
            <h2 id={`${location}-parameters`}>{title}</h2>
            <FieldList fields={parameters} />
          </section>
        );
      })}

      {operation.requestBody ? (
        <section aria-labelledby="request-body">
          <h2 id="request-body">Request body</h2>
          <p className="docs-schema-note">
            <code>{operation.requestBody.contentType}</code>
            {operation.requestBody.required ? " (required)" : " (optional)"}
          </p>
          {operation.requestBody.schema ? (
            <SchemaBody schema={operation.requestBody.schema} />
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="responses">
        <h2 id="responses">Responses</h2>
        <div className="docs-responses">
          {operation.responses.map((response) => (
            <div key={response.status} className="docs-response">
              <p className="docs-response-head">
                <span
                  className={`docs-status docs-status-${response.status.charAt(0)}xx`}
                >
                  {response.status}
                </span>
                <span>{response.description}</span>
              </p>
              {response.schema && response.contentType?.includes("json") ? (
                <details className="docs-field-children">
                  <summary>Show response fields</summary>
                  <SchemaBody schema={response.schema} />
                </details>
              ) : response.contentType ? (
                <p className="docs-schema-note">
                  <code>{response.contentType}</code>
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="example-request">
        <h2 id="example-request">Example request</h2>
        <CodeBlock label="cURL" code={curlExample(operation)} />
      </section>

      {success?.schema ? (
        <section aria-labelledby="example-response">
          <h2 id="example-response">Example response</h2>
          <CodeBlock
            label={success.status}
            code={JSON.stringify(exampleValue(success.schema), null, 2)}
          />
        </section>
      ) : null}
    </div>
  );
}

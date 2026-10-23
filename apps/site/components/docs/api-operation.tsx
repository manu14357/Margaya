import { Check, Copy } from "lucide-react";
import { requestSamples, responseSamples } from "@/lib/docs/api-samples";
import { codeBlockHtml, codeTabsHtml, tabsHtml } from "@/lib/docs/highlight";
import { type Operation, PARAMETER_LOCATIONS } from "@/lib/docs/openapi";
import { FieldList, SchemaBody } from "./schema-fields";

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

/** The request line of an operation, shown under the page title. */
export function OperationEndpoint({ operation }: { operation: Operation }) {
  return (
    <div className="docs-endpoint">
      <MethodBadge method={operation.method} />
      <code className="docs-endpoint-path">{operation.path}</code>
      <button
        type="button"
        className="docs-copy docs-copy-inline"
        data-copy-text={operation.path}
        aria-label="Copy path"
      >
        <Copy aria-hidden="true" className="docs-icon docs-copy-idle" />
        <Check aria-hidden="true" className="docs-icon docs-copy-done" />
      </button>
      {operation.deprecated ? (
        <span className="docs-field-meta">deprecated</span>
      ) : null}
    </div>
  );
}

function Html({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={className}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: highlighted at build time from the committed OpenAPI document.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * The example panel: request samples in cURL, JavaScript and Python, then
 * example responses by status. Sticky beside the reference on wide screens.
 */
export function OperationExamples({ operation }: { operation: Operation }) {
  const requests = requestSamples(operation);
  const responses = responseSamples(operation);
  return (
    <div className="docs-api-examples">
      <section id="example-request" aria-label="Example request">
        <Html
          html={codeTabsHtml(
            requests.map((sample) => ({
              label: sample.label,
              language: sample.language,
              code: sample.code,
            })),
            { header: "Request" },
          )}
        />
      </section>
      {responses.length > 0 ? (
        <section id="example-response" aria-label="Example response">
          <Html
            html={tabsHtml(
              responses.map((response) => ({
                label: response.status,
                html: codeBlockHtml(response.code, "json"),
              })),
              {
                className: "docs-code-group docs-response-group",
                header: "Response",
              },
            )}
          />
        </section>
      ) : null}
    </div>
  );
}

/** Parameters, body and responses of an operation. */
export function OperationReference({ operation }: { operation: Operation }) {
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

      {Object.entries(PARAMETER_LOCATIONS).map(([location, title]) => {
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
    </div>
  );
}
